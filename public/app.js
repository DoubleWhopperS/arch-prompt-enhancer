// ═══════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════

let baseImageData = null;   // data:image/... (browser-side)
let baseImageUrl = null;    // CDN URL (after upload)
let baseImageRatio = null;  // e.g. "4:3", detected from base image
const references = [];      // [{ image: data:..., focuses: [] }]
let generatedImages = [];   // [{ url, status: 'loading'|'done'|'error', message }]
let selectedCount = 2;
let lightboxIndex = -1;

const FOCUS_OPTIONS = ['光线', '色调', '材质', '氛围', '配景', '构图', '空气感'];
const MAX_IMAGE_DIM = 2048;

// ═══════════════════════════════════════════════════════
// Image Compression
// ═══════════════════════════════════════════════════════

function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM) { resolve(dataUrl); return; }
      if (width > height) { height = Math.round(height * MAX_IMAGE_DIM / width); width = MAX_IMAGE_DIM; }
      else { width = Math.round(width * MAX_IMAGE_DIM / height); height = MAX_IMAGE_DIM; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.90));
    };
    img.src = dataUrl;
  });
}

// ═══════════════════════════════════════════════════════
// CDN Upload
// ═══════════════════════════════════════════════════════

async function uploadToCDN(dataUrl, name) {
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, name }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) throw new Error(data.error || `Upload failed: HTTP ${resp.status}`);
  return data.url;
}

// ═══════════════════════════════════════════════════════
// Phase Management
// ═══════════════════════════════════════════════════════

function showPhase(id) {
  document.getElementById(id).classList.add('visible');
  // Scroll into view smoothly
  setTimeout(() => {
    document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ═══════════════════════════════════════════════════════
// Base Image
// ═══════════════════════════════════════════════════════

const baseDropZone = document.getElementById('baseDropZone');
const baseInput = document.getElementById('baseInput');

baseDropZone.addEventListener('click', () => baseInput.click());
baseDropZone.addEventListener('dragover', (e) => { e.preventDefault(); baseDropZone.classList.add('dragover'); });
baseDropZone.addEventListener('dragleave', () => baseDropZone.classList.remove('dragover'));
baseDropZone.addEventListener('drop', (e) => {
  e.preventDefault(); baseDropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleBaseFile(e.dataTransfer.files[0]);
});
baseInput.addEventListener('change', (e) => { if (e.target.files[0]) handleBaseFile(e.target.files[0]); });

async function handleBaseFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    baseImageData = await compressImage(e.target.result);
    baseImageUrl = null;
    document.getElementById('baseImg').src = baseImageData;
    document.getElementById('basePlaceholder').classList.add('hidden');
    document.getElementById('basePreview').classList.remove('hidden');

    // Detect aspect ratio from base image
    const img = new Image();
    img.onload = () => {
      baseImageRatio = detectAspectRatio(img.width, img.height);
      updateRatioSelector();
    };
    img.src = baseImageData;
  };
  reader.readAsDataURL(file);
}

function detectAspectRatio(w, h) {
  const r = w / h;
  // Find closest standard ratio
  const ratios = [
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4/3 },
    { label: '3:4', value: 3/4 },
    { label: '16:9', value: 16/9 },
    { label: '9:16', value: 9/16 },
    { label: '3:2', value: 3/2 },
    { label: '2:3', value: 2/3 },
  ];
  let best = ratios[0];
  let bestDiff = Infinity;
  for (const ratio of ratios) {
    const diff = Math.abs(r - ratio.value);
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best.label;
}

function updateRatioSelector() {
  const sel = document.getElementById('genRatio');
  const keepOpt = sel.querySelector('[value="keep"]');
  if (keepOpt) {
    keepOpt.textContent = `原图比例 (${baseImageRatio})`;
  }
}

function removeBaseImage(e) {
  e.stopPropagation();
  baseImageData = null;
  baseImageUrl = null;
  baseImageRatio = null;
  baseInput.value = '';
  document.getElementById('basePlaceholder').classList.remove('hidden');
  document.getElementById('basePreview').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// Reference Images
// ═══════════════════════════════════════════════════════

const refDropZone = document.getElementById('refDropZone');
const refInput = document.getElementById('refInput');

refDropZone.addEventListener('click', () => refInput.click());
refDropZone.addEventListener('dragover', (e) => { e.preventDefault(); refDropZone.classList.add('dragover'); });
refDropZone.addEventListener('dragleave', () => refDropZone.classList.remove('dragover'));
refDropZone.addEventListener('drop', (e) => {
  e.preventDefault(); refDropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleRefFile(e.dataTransfer.files[0]);
});
refInput.addEventListener('change', (e) => { if (e.target.files[0]) handleRefFile(e.target.files[0]); });

async function handleRefFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    references.push({ image: await compressImage(e.target.result), focuses: [] });
    renderRefList();
  };
  reader.readAsDataURL(file);
}

function removeRef(index) { references.splice(index, 1); renderRefList(); }

function toggleFocus(refIndex, focus) {
  const ref = references[refIndex];
  const idx = ref.focuses.indexOf(focus);
  if (idx === -1) ref.focuses.push(focus); else ref.focuses.splice(idx, 1);
  renderRefList();
}

function renderRefList() {
  document.getElementById('refList').innerHTML = references.map((ref, i) => `
    <div class="flex gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <img src="${ref.image}" class="w-16 h-16 object-cover rounded flex-shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-gray-400">参考图 ${i + 1}</span>
          <button onclick="removeRef(${i})" class="text-xs text-red-400 hover:text-red-600">移除</button>
        </div>
        <div class="flex flex-wrap gap-1">
          ${FOCUS_OPTIONS.map(f => `<span class="focus-tag text-xs px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 ${ref.focuses.includes(f) ? 'active' : ''}" onclick="toggleFocus(${i},'${f}')">${f}</span>`).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════
// Count Selector
// ═══════════════════════════════════════════════════════

document.getElementById('countSelector').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-count]');
  if (!btn) return;
  selectedCount = parseInt(btn.dataset.count);
  document.querySelectorAll('#countSelector .count-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.count) === selectedCount);
  });
});

// ═══════════════════════════════════════════════════════
// Enhance Prompt
// ═══════════════════════════════════════════════════════

async function enhance() {
  const intent = document.getElementById('intent').value.trim();
  if (!intent && !baseImageData) { alert('请至少填写设计意图或上传基础图'); return; }

  const btn = document.getElementById('enhanceBtn');
  const output = document.getElementById('promptOutput');
  btn.disabled = true;
  btn.innerHTML = spinnerHTML('上传图片...');
  output.value = '';
  output.classList.add('streaming');
  output.readOnly = true;

  // Show prompt phase
  showPhase('promptPhase');

  try {
    // Upload images to CDN with status
    const totalUploads = (baseImageData && !baseImageUrl ? 1 : 0) + references.length;
    let uploadIdx = 0;

    if (baseImageData && !baseImageUrl) {
      uploadIdx++;
      output.value = `[${uploadIdx}/${totalUploads}] 上传基础图到图床...\n`;
      btn.innerHTML = spinnerHTML(`上传 ${uploadIdx}/${totalUploads}...`);
      baseImageUrl = await uploadToCDN(baseImageData, 'base');
      output.value += `  ✓ 基础图已上传\n`;
    }
    const refUrls = [];
    for (let i = 0; i < references.length; i++) {
      uploadIdx++;
      output.value += `[${uploadIdx}/${totalUploads}] 上传参考图 ${i + 1}...\n`;
      btn.innerHTML = spinnerHTML(`上传 ${uploadIdx}/${totalUploads}...`);
      refUrls.push(await uploadToCDN(references[i].image, `ref_${i + 1}`));
      output.value += `  ✓ 参考图 ${i + 1} 已上传\n`;
    }

    if (totalUploads > 0) output.value += `\n图片上传完成，生成 Prompt 中...\n\n`;

    btn.innerHTML = spinnerHTML('生成中...');

    const params = {
      sceneType: document.getElementById('sceneType').value,
      timeWeather: document.getElementById('timeWeather').value,
      buildingStyle: document.getElementById('buildingStyle')?.value || '',
      outputMethod: document.getElementById('outputMethod')?.value || '',
    };

    const body = {
      intent,
      params,
      baseImageUrl: baseImageUrl || null,
      references: references.map((r, i) => ({
        imageUrl: refUrls[i] || null,
        focuses: r.focuses,
      })),
    };

    // Clear upload logs before streaming prompt
    output.value = '';

    // SSE stream
    console.log('[enhance] sending request, baseImageUrl:', baseImageUrl);
    const resp = await fetch('/api/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log('[enhance] response status:', resp.status, resp.headers.get('content-type'));

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.content) { output.value += data.content; updateWordCount(); }
          if (data.error) output.value += `\n[Error: ${data.error}]`;
        } catch (e) { /* ignore parse errors */ }
      }
    }
  } catch (err) {
    output.value = `[Error: ${err.message}]`;
  } finally {
    output.classList.remove('streaming');
    output.readOnly = false;
    btn.disabled = false;
    btn.innerHTML = enhanceBtnHTML();
    updateWordCount();
  }
}

function updateWordCount() {
  const text = document.getElementById('promptOutput').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const el = document.getElementById('wordCount');
  el.textContent = `${words} words`;
  el.className = `text-xs tabular-nums ${words > 150 ? 'text-red-500' : words > 120 ? 'text-amber-500' : 'text-gray-400'}`;
}

function copyPrompt() {
  const text = document.getElementById('promptOutput').value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> OK';
    setTimeout(() => btn.innerHTML = orig, 1200);
  });
}

// ═══════════════════════════════════════════════════════
// Generate Images
// ═══════════════════════════════════════════════════════

async function generateImages() {
  const prompt = document.getElementById('promptOutput').value.trim();
  if (!prompt) { alert('请先生成或填写 Prompt'); return; }

  const btn = document.getElementById('generateBtn');
  const moreBtn = document.getElementById('generateMoreBtn');
  btn.disabled = true;
  moreBtn.style.display = 'none';
  btn.innerHTML = spinnerHTML('准备中...');

  // Initialize gallery slots
  const startIdx = generatedImages.length;
  for (let i = 0; i < selectedCount; i++) {
    generatedImages.push({ url: null, status: 'loading', message: 'Waiting...' });
  }
  renderGallery();
  showPhase('galleryPhase');

  // Resolve "keep" ratio to actual detected ratio
  let aspectRatio = document.getElementById('genRatio').value;
  if (aspectRatio === 'keep') aspectRatio = baseImageRatio || '4:3';

  const body = {
    prompt,
    model: document.getElementById('genModel').value,
    baseImageUrl: baseImageUrl || null,
    aspectRatio,
    imageSize: document.getElementById('genSize').value,
    count: selectedCount,
  };

  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          const idx = startIdx + (data.index ?? 0);

          if (data.type === 'progress' && generatedImages[idx]) {
            generatedImages[idx].message = data.message;
            renderGallery();
          } else if (data.type === 'image' && generatedImages[idx]) {
            generatedImages[idx] = { url: data.url, status: 'done', message: '' };
            renderGallery();
          } else if (data.type === 'error' && generatedImages[idx]) {
            generatedImages[idx] = { url: null, status: 'error', message: data.message };
            renderGallery();
          }
        } catch (e) { /* ignore */ }
      }
    }
  } catch (err) {
    // Mark remaining loading slots as error
    for (let i = startIdx; i < generatedImages.length; i++) {
      if (generatedImages[i].status === 'loading') {
        generatedImages[i] = { url: null, status: 'error', message: err.message };
      }
    }
    renderGallery();
  } finally {
    btn.disabled = false;
    btn.innerHTML = generateBtnHTML();
    moreBtn.style.display = '';
  }
}

// ═══════════════════════════════════════════════════════
// Gallery Rendering
// ═══════════════════════════════════════════════════════

function renderGallery() {
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = generatedImages.map((img, i) => {
    if (img.status === 'loading') {
      return `
        <div class="aspect-[4/3] rounded-lg skeleton flex items-center justify-center">
          <div class="text-center">
            <svg class="w-6 h-6 mx-auto mb-2 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(img.message)}</p>
          </div>
        </div>`;
    }
    if (img.status === 'error') {
      return `
        <div class="aspect-[4/3] rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-center p-4">
          <div class="text-center">
            <svg class="w-6 h-6 mx-auto mb-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
            <p class="text-xs text-red-600 dark:text-red-400 break-all">${escapeHtml(img.message)}</p>
          </div>
        </div>`;
    }
    // done
    return `
      <div class="img-card aspect-[4/3] bg-gray-100 dark:bg-gray-800" onclick="openLightbox(${i})">
        <img src="${img.url}" class="w-full h-full object-cover" loading="lazy" />
        <div class="overlay">
          <button onclick="downloadImage(event, ${i})" class="bg-white/20 hover:bg-white/30 text-white p-2 rounded-lg backdrop-blur" title="下载">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </button>
          <button onclick="openLightbox(${i}); event.stopPropagation();" class="bg-white/20 hover:bg-white/30 text-white p-2 rounded-lg backdrop-blur" title="放大">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════
// Lightbox
// ═══════════════════════════════════════════════════════

function openLightbox(index) {
  const doneImages = generatedImages.filter(img => img.status === 'done');
  const doneIndex = getDoneIndex(index);
  if (doneIndex < 0) return;

  lightboxIndex = index;
  document.getElementById('lbImage').src = generatedImages[index].url;
  document.getElementById('lightbox').classList.add('open');
  updateLightboxNav();
}

function closeLightbox(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest('button')) return;
  document.getElementById('lightbox').classList.remove('open');
  lightboxIndex = -1;
}

function navigateLightbox(e, dir) {
  e.stopPropagation();
  const doneIndices = generatedImages.map((img, i) => img.status === 'done' ? i : -1).filter(i => i >= 0);
  const currentPos = doneIndices.indexOf(lightboxIndex);
  const newPos = currentPos + dir;
  if (newPos >= 0 && newPos < doneIndices.length) {
    lightboxIndex = doneIndices[newPos];
    document.getElementById('lbImage').src = generatedImages[lightboxIndex].url;
    updateLightboxNav();
  }
}

function updateLightboxNav() {
  const doneIndices = generatedImages.map((img, i) => img.status === 'done' ? i : -1).filter(i => i >= 0);
  const pos = doneIndices.indexOf(lightboxIndex);
  document.getElementById('lbPrev').style.visibility = pos > 0 ? 'visible' : 'hidden';
  document.getElementById('lbNext').style.visibility = pos < doneIndices.length - 1 ? 'visible' : 'hidden';
}

function getDoneIndex(globalIndex) {
  return generatedImages[globalIndex]?.status === 'done' ? globalIndex : -1;
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (lightboxIndex < 0) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') navigateLightbox(e, -1);
  if (e.key === 'ArrowRight') navigateLightbox(e, 1);
});

// ═══════════════════════════════════════════════════════
// Download
// ═══════════════════════════════════════════════════════

async function downloadImage(e, index) {
  e.stopPropagation();
  const img = generatedImages[index];
  if (!img?.url) return;

  const filename = `rendering_${index + 1}_${Date.now()}.png`;
  try {
    const resp = await fetch(img.url);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Fallback: open in new tab
    window.open(img.url, '_blank');
  }
}

function downloadLightboxImage(e) {
  e.stopPropagation();
  if (lightboxIndex >= 0) downloadImage(e, lightboxIndex);
}

// ═══════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════

function spinnerHTML(text) {
  return `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> ${text}`;
}

function enhanceBtnHTML() {
  return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg> 生成 Prompt';
}

function generateBtnHTML() {
  return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> 生成效果图';
}
