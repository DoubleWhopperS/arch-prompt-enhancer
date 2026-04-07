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
let currentView = 'generate'; // 'generate' | 'library'

// Library state
let batchMode = false;
let batchSelected = new Set(); // set of library item ids
let lightboxSource = 'generate'; // which view opened the lightbox
let lightboxLibItems = [];      // flat list of lib items for lightbox nav

const FOCUS_OPTIONS = ['光线', '色调', '材质', '建筑特征', '环境配景'];

// 出图风格提示词库 — 选择后自动注入到设计意图中
const RENDER_STYLES = {
  'spring-morning': {
    name: '春日晨景',
    prompt: '春日清晨，低角度侧逆光，柔和散射光，建筑边缘轻微光晕。整体低对比度高调画面(high-key)——高光严格控制不过曝，亮部保留细节层次（天空、白墙、玻璃反光区域均需可见纹理），暗部通透不死黑。自然饱和度，不人为增强。嫩绿通透树冠，斑驳树影落地。建筑玻璃内透出柔和暖白色室内光，与室外冷调形成微妙冷暖对比。水面平静倒影与粼粼光斑。',
  },
  'blue-hour-commercial': {
    name: '蓝调商业夜景',
    prompt: '蓝调时刻(blue hour)，天空均匀深钴蓝。室内透出琥珀金色暖光穿过玻璃立面，建筑边缘线性灯带勾勒轮廓。中高对比度暗调画面(low-key)——室内光是画面最亮元素，暗部深沉不死黑。地面湿润铺装镜面反射，暖光向下延伸。冷暖对比鲜明。饱和度中等偏高。',
  },
  'minimal-gray': {
    name: '极简高级灰',
    prompt: '阴天漫射光，天空微过曝压成纯白高级灰。无锐利阴影，均匀照度(even illumination)展现材质纹理。低饱和度低对比度高调画面(high-key)——中性色为主，建筑浅灰/暖灰，植物莫兰迪绿。明暗过渡平缓，最暗处仅在窗框缝隙（结构锚点）。哑光质感(matte finish)，干净透彻，宁静克制。',
  },
  'blue-hour-gentle': {
    name: '温柔蓝调时刻',
    prompt: '蓝调时刻(blue hour)薄雾环境，弱光漫射柔化建筑细节，仅保留纯粹轮廓。天空深蓝灰渐变，低饱和度低对比度。建筑内部暖光透过半透明表皮形成灯笼效应(lantern effect)——室内光是唯一暖色视觉中心。地面微湿反射冷蓝色调。整体安静克制，带电影感。',
  },
  'urban-rain': {
    name: '都市雨幕风',
    prompt: '阴雨天气，漫射光无硬阴影。建筑表面湿润反光增强材质质感与锐利度。中低饱和度冷灰蓝色调，画面冷峻纯净。地面大面积积水产生镜面反射，拉长建筑倒影。远处元素被雨雾轻微柔化，增加空间层次。整体高冷锐利，"顶级实景感"。',
  },
  'warm-fog': {
    name: '暖调光雾风',
    prompt: '清晨薄雾，低角度暖色光穿透雾气形成柔和体积光(volumetric light)。暖黄琥珀主调，色调高度统一。低对比度——薄雾柔化远景与建筑边缘，近景保持清晰。植被被暖光染色泛金。地面微湿带轻微反射。画面干净、调子统一、氛围感强。',
  },
  'daylight-realism': {
    name: '日光写实风',
    prompt: '晴朗白日，锐利中性白日光，清晰硬阴影与高动态范围。极淡青空，空气通透度高。中高对比度——光影体积感强，阴影边缘清晰。中性自然饱和度，色彩客观真实。画面锐利高保真，冷静克制，"商业大片质感"。',
  },
};
const MAX_IMAGE_DIM = 2048;
const STORAGE_KEY = 'arch_gallery';

// ═══════════════════════════════════════════════════════
// View Navigation
// ═══════════════════════════════════════════════════════

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  document.getElementById('viewGenerate').classList.toggle('hidden', view !== 'generate');
  document.getElementById('viewLibrary').classList.toggle('hidden', view !== 'library');
  document.getElementById('viewRefLibrary').classList.toggle('hidden', view !== 'reflib');

  if (view === 'library') {
    // If dirty, flush first, then reload from cloud to confirm
    const load = galleryDirty ? flushGallery().then(() => loadGallery()) : loadGallery();
    load.then(() => renderLibrary());
  }
  if (view === 'reflib') loadRefLibrary();
}

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
// Image Preview & Download (generate view)
// ═══════════════════════════════════════════════════════

function previewGenerateImage(index, type) {
  let src;
  if (type === 'base') {
    src = baseImageUrl || baseImageData;
  } else {
    const ref = references[index];
    src = ref?.imageUrl || ref?.image;
  }
  if (!src) return;
  document.getElementById('imagePreviewImg').src = src;
  document.getElementById('imagePreviewOverlay').classList.remove('opacity-0', 'pointer-events-none');
}

async function downloadGenerateImage(type) {
  let src, name;
  if (type === 'base') {
    src = baseImageUrl || baseImageData;
    name = 'base_image';
  } else {
    return; // ref download handled via previewGenerateImage context
  }
  if (!src) return;
  try {
    if (src.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = src;
      a.download = `${name}.jpg`;
      a.click();
    } else {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch {
    window.open(src, '_blank');
  }
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
    references.push({ image: await compressImage(e.target.result), focuses: [], analysis: '', supplement: '' });
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

function updateRefSupplement(refIndex, value) {
  references[refIndex].supplement = value;
}

function renderRefList() {
  document.getElementById('refList').innerHTML = references.map((ref, i) => {
    const imgSrc = ref.imageUrl || ref.image || '';
    return `
    <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
      <div class="flex gap-3">
        <div class="relative group flex-shrink-0">
          <img src="${imgSrc}" class="w-16 h-16 object-cover rounded cursor-pointer" onclick="previewGenerateImage(${i}, 'ref')" />
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span class="text-white text-xs">🔍</span>
          </div>
        </div>
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
      <input type="text" placeholder="补充说明（可选，如：参考其暖色调木格栅材质）"
        class="w-full text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        value="${escapeHtml(ref.supplement || '')}" onchange="updateRefSupplement(${i}, this.value)" />
    </div>
  `}).join('');
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

// ─── SSE helper: read stream and call onData for each parsed event ───
async function readSSE(resp, onData) {
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
      try { onData(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ }
    }
  }
}

// ─── Phase A: Analyze reference images ───
async function analyzeRef(imageUrl, dimensions, supplement) {
  const resp = await fetch('/api/analyze-ref', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, dimensions, supplement }),
  });
  let result = '';
  await readSSE(resp, (data) => {
    if (data.content) result += data.content;
    if (data.error) result += `\n[Error: ${data.error}]`;
  });
  return result.trim();
}

// ─── Render reference analysis results ───
function renderRefAnalyses() {
  const refsWithAnalysis = references.filter(r => r.analysis);
  const section = document.getElementById('refAnalysisSection');
  const content = document.getElementById('refAnalysisContent');
  if (refsWithAnalysis.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  content.innerHTML = refsWithAnalysis.map((ref, idx) => {
    const refIdx = references.indexOf(ref);
    const dims = ref.focuses.join('、');
    return `
    <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div class="flex items-center gap-2 mb-2">
        <img src="${ref.image}" class="w-10 h-10 object-cover rounded flex-shrink-0" />
        <span class="text-xs text-gray-400">参考图 ${refIdx + 1}（${dims}）</span>
      </div>
      <textarea class="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
        rows="3" oninput="references[${refIdx}].analysis = this.value">${escapeHtml(ref.analysis)}</textarea>
    </div>`;
  }).join('');
}

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

  showPhase('promptPhase');

  try {
    // ─── Upload images ───
    const refsWithFocuses = references.filter(r => r.focuses.length > 0);
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
      if (!references[i].imageUrl) {
        uploadIdx++;
        output.value += `[${uploadIdx}/${totalUploads}] 上传参考图 ${i + 1}...\n`;
        btn.innerHTML = spinnerHTML(`上传 ${uploadIdx}/${totalUploads}...`);
        references[i].imageUrl = await uploadToCDN(references[i].image, `ref_${i + 1}`);
        output.value += `  ✓ 参考图 ${i + 1} 已上传\n`;
      }
      refUrls.push(references[i].imageUrl);
    }

    // ─── Phase A: Analyze reference images (parallel) ───
    if (refsWithFocuses.length > 0) {
      output.value += `\n分析参考图...（${refsWithFocuses.length} 张）\n`;
      btn.innerHTML = spinnerHTML('分析参考图...');

      const analysisTasks = refsWithFocuses.map(async (ref) => {
        const idx = references.indexOf(ref);
        const supplement = ref.supplement ? `\n补充要求：${ref.supplement}` : '';
        output.value += `  ⏳ 参考图 ${idx + 1}（${ref.focuses.join('、')}）分析中...\n`;
        ref.analysis = await analyzeRef(ref.imageUrl || refUrls[idx], ref.focuses, supplement);
        output.value += `  ✓ 参考图 ${idx + 1} 分析完成\n`;
      });
      await Promise.all(analysisTasks);

      renderRefAnalyses();
      output.value += `\n参考图分析完成，生成 Prompt 中...\n\n`;
    } else if (totalUploads > 0) {
      output.value += `\n图片上传完成，生成 Prompt 中...\n\n`;
    }

    // ─── Phase B: Generate enhanced prompt ───
    btn.innerHTML = spinnerHTML('生成中...');

    const params = {
      sceneType: document.getElementById('sceneType').value,
      outputMethod: document.getElementById('outputMethod')?.value || '',
    };

    const renderStyleKey = document.getElementById('renderStyle')?.value || '';
    let finalIntent = intent;
    if (renderStyleKey && RENDER_STYLES[renderStyleKey]) {
      const style = RENDER_STYLES[renderStyleKey];
      const styleSection = `【出图风格：${style.name}】\n${style.prompt}`;
      finalIntent = finalIntent ? `${finalIntent}\n\n${styleSection}` : styleSection;
    }

    // Build reference data with analyses
    const refData = references.map((r, i) => ({
      imageUrl: refUrls[i] || null,
      focuses: r.focuses,
      analysis: r.analysis || '',
    }));

    const body = {
      intent: finalIntent,
      params,
      baseImageUrl: baseImageUrl || null,
      references: refData,
    };

    output.value = '';

    const resp = await fetch('/api/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    await readSSE(resp, (data) => {
      if (data.content) { output.value += data.content; updateWordCount(); }
      if (data.error) output.value += `\n[Error: ${data.error}]`;
    });
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
  // Count CJK characters + English words
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').trim();
  const engWords = nonCjk ? nonCjk.split(/\s+/).filter(w => w.length > 0).length : 0;
  const total = cjk + engWords;
  const el = document.getElementById('wordCount');
  el.textContent = `${total} 字`;
  el.className = `text-xs tabular-nums ${total > 300 ? 'text-red-500' : total > 250 ? 'text-amber-500' : 'text-gray-400'}`;
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

  // Ensure gallery is loaded from cloud before generating (prevents race condition)
  if (galleryLoadPromise) {
    await galleryLoadPromise;
    galleryLoadPromise = null;
  }

  const btn = document.getElementById('generateBtn');
  const moreBtn = document.getElementById('generateMoreBtn');
  btn.disabled = true;
  moreBtn.style.display = 'none';
  btn.innerHTML = spinnerHTML('准备中...');

  const startIdx = generatedImages.length;
  for (let i = 0; i < selectedCount; i++) {
    generatedImages.push({ url: null, status: 'loading', message: 'Waiting...' });
  }
  renderGallery();
  showPhase('galleryPhase');

  let aspectRatio = document.getElementById('genRatio').value;
  if (aspectRatio === 'keep') aspectRatio = baseImageRatio || '4:3';

  const modelValue = document.getElementById('genModel').value;
  const sizeValue = document.getElementById('genSize').value;

  const body = {
    prompt,
    model: modelValue,
    baseImageUrl: baseImageUrl || null,
    referenceUrls: references.map(r => r.imageUrl).filter(Boolean),
    refAnalyses: references.map(r => r.analysis || '').filter(a => a.trim()),
    aspectRatio,
    imageSize: sizeValue,
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
            generatedImages[idx] = { url: data.url, status: 'done', message: '', cdnStatus: 'pending' };
            renderGallery();
            // Save to library with temp URL (will be updated by image_updated)
            saveToLibrary({
              url: data.url,
              prompt,
              baseImageUrl: baseImageUrl || null,
              referenceUrls: references.map(r => r.imageUrl).filter(Boolean),
              model: modelValue,
              ratio: aspectRatio,
              size: sizeValue,
            });
          } else if (data.type === 'image_updated' && generatedImages[idx]) {
            // CDN upload complete — update URL in gallery and library
            const oldUrl = generatedImages[idx].url;
            generatedImages[idx].url = data.url;
            generatedImages[idx].cdnStatus = 'done';
            renderGallery();
            updateLibraryUrl(oldUrl, data.url);
          } else if (data.type === 'error' && generatedImages[idx]) {
            generatedImages[idx] = { url: null, status: 'error', message: data.message };
            renderGallery();
          }
        } catch (e) { /* ignore */ }
      }
    }
  } catch (err) {
    for (let i = startIdx; i < generatedImages.length; i++) {
      if (generatedImages[i].status === 'loading') {
        generatedImages[i] = { url: null, status: 'error', message: err.message };
      }
    }
    renderGallery();
  } finally {
    // Mark images that never got CDN update as failed in both generatedImages and gallery
    for (let i = startIdx; i < generatedImages.length; i++) {
      if (generatedImages[i].cdnStatus === 'pending') {
        generatedImages[i].cdnStatus = 'failed';
        // Also mark in gallery cache so the library view shows retry button
        const tempUrl = generatedImages[i].url;
        if (tempUrl && galleryCache) {
          const item = galleryCache.find(g => g.url === tempUrl);
          if (item) {
            item.cdnStatus = 'failed';
            galleryDirty = true;
          }
        }
      }
    }
    renderGallery();
    // Flush all gallery changes to cloud — always runs, regardless of success/error
    await flushGallery();
    btn.disabled = false;
    btn.innerHTML = generateBtnHTML();
    moreBtn.style.display = '';
    updateLibCount();
  }
}

// ═══════════════════════════════════════════════════════
// Gallery Rendering (generate view)
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
    const cdnBadge = img.cdnStatus === 'pending'
      ? `<span class="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/80 text-white backdrop-blur-sm flex items-center gap-1">
           <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
           上传中</span>`
      : img.cdnStatus === 'failed'
      ? `<span class="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/80 text-white backdrop-blur-sm cursor-pointer" onclick="event.stopPropagation(); retryDownload(${i})" title="临时链接可能过期，建议立即下载">
           CDN 失败 - 点击下载</span>`
      : `<span class="absolute bottom-2 right-2 w-5 h-5 rounded-full bg-green-500/90 flex items-center justify-center shadow-sm" title="已保存到云端">
           <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
         </span>`;
    return `
      <div class="img-card group aspect-[4/3] bg-gray-100 dark:bg-gray-800 relative" onclick="lightboxSource='generate'; openLightbox(${i})">
        <img src="${img.url}" class="w-full h-full object-cover" loading="lazy" />
        ${cdnBadge}
        <div class="overlay">
          <button onclick="downloadImage(event, ${i})" class="bg-white/20 hover:bg-white/30 text-white p-2 rounded-lg backdrop-blur" title="下载">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </button>
          <button onclick="lightboxSource='generate'; openLightbox(${i}); event.stopPropagation();" class="bg-white/20 hover:bg-white/30 text-white p-2 rounded-lg backdrop-blur" title="放大">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ═══════════════════════════════════════════════════════
// Lightbox
// ═══════════════════════════════════════════════════════

function openLightbox(index) {
  if (lightboxSource === 'library') {
    // Called from library context
    if (!lightboxLibItems[index]) return;
    lightboxIndex = index;
    document.getElementById('lbImage').src = lightboxLibItems[index].url;
  } else {
    if (!generatedImages[index] || generatedImages[index].status !== 'done') return;
    lightboxIndex = index;
    document.getElementById('lbImage').src = generatedImages[index].url;
  }
  document.getElementById('lightbox').classList.add('open');
  updateLightboxNav();
}

function openLibLightbox(flatIndex) {
  lightboxSource = 'library';
  lightboxIndex = flatIndex;
  document.getElementById('lbImage').src = lightboxLibItems[flatIndex].url;
  document.getElementById('lightbox').classList.add('open');
  updateLightboxNav();
}

function closeLightbox(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest('button')) return;
  document.getElementById('lightbox').classList.remove('open');
  lightboxIndex = -1;
  lightboxSource = 'generate';
}

function navigateLightbox(e, dir) {
  e.stopPropagation();
  if (lightboxSource === 'library') {
    const newIdx = lightboxIndex + dir;
    if (newIdx >= 0 && newIdx < lightboxLibItems.length) {
      lightboxIndex = newIdx;
      document.getElementById('lbImage').src = lightboxLibItems[newIdx].url;
      updateLightboxNav();
    }
    return;
  }
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
  if (lightboxSource === 'library') {
    document.getElementById('lbPrev').style.visibility = lightboxIndex > 0 ? 'visible' : 'hidden';
    document.getElementById('lbNext').style.visibility = lightboxIndex < lightboxLibItems.length - 1 ? 'visible' : 'hidden';
    return;
  }
  const doneIndices = generatedImages.map((img, i) => img.status === 'done' ? i : -1).filter(i => i >= 0);
  const pos = doneIndices.indexOf(lightboxIndex);
  document.getElementById('lbPrev').style.visibility = pos > 0 ? 'visible' : 'hidden';
  document.getElementById('lbNext').style.visibility = pos < doneIndices.length - 1 ? 'visible' : 'hidden';
}

document.addEventListener('keydown', (e) => {
  const detailOpen = document.getElementById('detailModal').classList.contains('detail-open');
  if (e.key === 'Escape' && detailOpen) { closeDetail(); return; }
  if (detailOpen && e.key === 'ArrowLeft') { navigateDetail(-1); return; }
  if (detailOpen && e.key === 'ArrowRight') { navigateDetail(1); return; }
  if (lightboxIndex < 0) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') navigateLightbox(e, -1);
  if (e.key === 'ArrowRight') navigateLightbox(e, 1);
});

// ═══════════════════════════════════════════════════════
// Download
// ═══════════════════════════════════════════════════════

function retryDownload(index) {
  const img = generatedImages[index];
  if (!img?.url) return;
  downloadUrl(img.url, `rendering_${index + 1}_temp_${Date.now()}.png`);
}

async function downloadImage(e, index) {
  e.stopPropagation();
  const img = generatedImages[index];
  if (!img?.url) return;
  await downloadUrl(img.url, `rendering_${index + 1}_${Date.now()}.png`);
}

function downloadLightboxImage(e) {
  e.stopPropagation();
  if (lightboxIndex < 0) return;
  const url = lightboxSource === 'library'
    ? lightboxLibItems[lightboxIndex]?.url
    : generatedImages[lightboxIndex]?.url;
  if (url) downloadUrl(url, `rendering_${Date.now()}.png`);
}

async function downloadUrl(url, filename) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename; a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}

// ═══════════════════════════════════════════════════════
// Library — Cloud Storage (Vercel Blob) + Local Cache
// ═══════════════════════════════════════════════════════

let galleryCache = null; // in-memory cache, loaded once per session
let galleryLoaded = false; // true once initial load completes
let galleryLoadPromise = null; // awaitable promise for initial load

function getLibrary() {
  return galleryCache || [];
}

async function loadGallery() {
  try {
    const resp = await fetch('/api/gallery');
    const data = await resp.json();
    // Only overwrite cache if there are no dirty local changes
    if (!galleryDirty) {
      galleryCache = data.items || [];
    } else {
      // Merge: keep local dirty cache, but log cloud state for debugging
      console.log(`[gallery] cloud has ${(data.items || []).length} items, but local cache is dirty (${galleryCache.length} items) — keeping local`);
    }
  } catch (err) {
    console.warn('[gallery] cloud load failed, falling back to localStorage:', err.message);
    if (!galleryDirty) {
      try { galleryCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { galleryCache = []; }
    }
  }
  galleryLoaded = true;

  // Auto-migrate: localStorage → cloud (one-time)
  const migrated = localStorage.getItem('gallery_migrated');
  const localRaw = localStorage.getItem(STORAGE_KEY);
  console.log(`[gallery] cloud=${galleryCache.length} items, localStorage=${localRaw ? JSON.parse(localRaw).length : 0} items, migrated=${migrated}`);

  if (!migrated && localRaw) {
    try {
      const localItems = JSON.parse(localRaw);
      if (localItems.length > 0) {
        const cloudIds = new Set(galleryCache.map(i => i.id));
        const newItems = localItems.filter(i => i.id && i.url && !cloudIds.has(i.id));
        if (newItems.length > 0) {
          galleryCache = [...newItems, ...galleryCache];
          await syncGalleryToCloud(galleryCache);
          console.log(`[gallery] ✅ migrated ${newItems.length} items from localStorage to cloud`);
        } else {
          console.log('[gallery] all localStorage items already in cloud, skipping');
        }
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[gallery] migration error:', e.message);
    }
    localStorage.setItem('gallery_migrated', '1');
  } else if (migrated && galleryCache.length > 0) {
    console.log(`[gallery] ✅ data loaded from cloud (${galleryCache.length} items)`);
  }

  updateLibCount();
  return galleryCache;
}

async function syncGalleryToCloud(items) {
  galleryCache = items;
  updateLibCount();
  const resp = await fetch('/api/gallery', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PUT /api/gallery failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

let galleryDirty = false; // track if galleryCache has unsaved changes

function saveToLibrary({ url, prompt, baseImageUrl, referenceUrls, model, ratio, size }) {
  // Ensure galleryCache is initialized (avoid writing to empty cache if load hasn't completed)
  if (galleryCache === null) {
    console.warn('[gallery] saveToLibrary called before initial load — initializing empty cache');
    galleryCache = [];
  }
  const items = getLibrary();
  const newItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url,
    prompt: prompt || '',
    baseImageUrl: baseImageUrl || null,
    referenceUrls: referenceUrls || [],
    model: model || '',
    ratio: ratio || '',
    size: size || '',
    cdnStatus: 'pending',
    createdAt: new Date().toISOString(),
  };
  items.unshift(newItem);
  galleryCache = items;
  galleryDirty = true;
  updateLibCount();
  console.log(`[gallery] saved item ${newItem.id}, cache now has ${galleryCache.length} items`);
  // No individual POST — will be synced in batch via flushGallery()
}

function updateLibraryUrl(oldUrl, newUrl) {
  const items = getLibrary();
  const item = items.find(i => i.url === oldUrl);
  if (!item) return;
  item.url = newUrl;
  item.cdnStatus = 'done';
  galleryCache = items;
  galleryDirty = true;
  // No individual PATCH — will be synced in batch via flushGallery()
}

// Flush all pending gallery changes to cloud in one PUT
async function flushGallery() {
  if (!galleryDirty) {
    console.log('[gallery] flushGallery: nothing dirty, skipping');
    return;
  }
  console.log(`[gallery] flushing ${galleryCache.length} items to cloud...`);
  try {
    await syncGalleryToCloud(galleryCache);
    galleryDirty = false;
    console.log(`[gallery] ✅ cloud sync complete (${galleryCache.length} items)`);
  } catch (err) {
    // galleryDirty stays true — will retry next time
    console.error('[gallery] ❌ cloud sync FAILED:', err.message);
    // Notify user so they don't close the page
    try {
      const toast = document.createElement('div');
      toast.className = 'fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-[9999] text-sm';
      toast.textContent = '⚠️ 图库同步失败，请勿关闭页面，稍后自动重试';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 8000);
    } catch (_) {}
    // Schedule automatic retry with exponential backoff
    scheduleGalleryRetry();
  }
}

let galleryRetryTimer = null;
let galleryRetryCount = 0;
function scheduleGalleryRetry() {
  if (galleryRetryTimer) return; // already scheduled
  galleryRetryCount++;
  const delay = Math.min(5000 * Math.pow(2, galleryRetryCount - 1), 60000); // 5s, 10s, 20s, 40s, 60s max
  console.log(`[gallery] retry #${galleryRetryCount} scheduled in ${delay / 1000}s`);
  galleryRetryTimer = setTimeout(async () => {
    galleryRetryTimer = null;
    if (!galleryDirty) { galleryRetryCount = 0; return; }
    console.log(`[gallery] retry #${galleryRetryCount} executing...`);
    await flushGallery();
    if (!galleryDirty) {
      galleryRetryCount = 0;
      // Success toast
      try {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-[9999] text-sm';
        toast.textContent = '✅ 图库同步重试成功';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
      } catch (_) {}
    }
  }, delay);
}

// Retry CDN upload for a gallery item with failed/expired temp URL
async function retryGalleryCdn(itemId) {
  const item = getLibrary().find(i => i.id === itemId);
  if (!item) return;

  // Show loading state
  const btn = event?.target?.closest?.('button');
  if (btn) { btn.disabled = true; btn.textContent = '上传中...'; }

  try {
    // Step 1: Try to fetch the image from temp URL
    const resp = await fetch(item.url);
    if (!resp.ok) throw new Error('临时链接已过期，无法恢复此图片');

    const blob = await resp.blob();
    // Convert to base64 data URI
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Step 2: Upload to CDN via /api/upload
    const uploadResp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    });
    if (!uploadResp.ok) throw new Error('CDN 上传失败');
    const { url: cdnUrl } = await uploadResp.json();

    // Step 3: Update gallery item
    item.url = cdnUrl;
    item.cdnStatus = 'done';
    galleryDirty = true;
    await flushGallery();
    renderLibrary();

    // Success toast
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-[9999] text-sm';
    toast.textContent = '✅ CDN 上传成功';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  } catch (err) {
    console.error('[gallery] CDN retry failed:', err.message);
    if (btn) { btn.disabled = false; btn.textContent = '重新上传'; }

    // Check if it's an expired URL — offer to delete
    if (err.message.includes('过期') || err.message.includes('Failed to fetch')) {
      if (confirm(`该图片的临时链接已过期，无法恢复。\n是否从图库中删除此记录？`)) {
        deleteFromLibrary(itemId);
        renderLibrary();
      }
    } else {
      alert(`上传失败: ${err.message}`);
    }
  }
}

function deleteFromLibrary(ids) {
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  galleryCache = getLibrary().filter(item => !idSet.has(item.id));
  updateLibCount();
  galleryDirty = true;
  flushGallery();
}

function updateLibCount() {
  const count = getLibrary().length;
  const el = document.getElementById('libCount');
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

// ═══════════════════════════════════════════════════════
// Library — Export / Import
// ═══════════════════════════════════════════════════════

function exportLibrary() {
  const items = getLibrary();
  if (items.length === 0) { alert('图库为空'); return; }
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arch-gallery-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importLibrary(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) { alert('无效的图库文件'); return; }
    const existing = getLibrary();
    const existingIds = new Set(existing.map(item => item.id));
    const newItems = imported.filter(item => item.id && item.url && !existingIds.has(item.id));
    if (newItems.length === 0) { alert('没有新图片需要导入（全部已存在）'); return; }
    galleryCache = [...newItems, ...existing];
    updateLibCount();
    renderLibrary();
    // Sync full list to cloud
    await syncGalleryToCloud(galleryCache);
    alert(`成功导入 ${newItems.length} 张图片（跳过 ${imported.length - newItems.length} 张已存在）`);
  } catch (err) {
    alert('文件解析失败：' + err.message);
  }
  event.target.value = '';
}

// ═══════════════════════════════════════════════════════
// Library — Rendering
// ═══════════════════════════════════════════════════════

function renderLibrary() {
  const items = getLibrary();
  const content = document.getElementById('libraryContent');
  const empty = document.getElementById('libraryEmpty');
  const totalEl = document.getElementById('libTotalCount');

  totalEl.textContent = `${items.length} 张`;

  if (items.length === 0) {
    content.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group by date
  const groups = {};
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = formatDateGroup(date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // Build flat list for lightbox navigation
  lightboxLibItems = items;

  // Render date groups with masonry
  const batchClass = batchMode ? 'batch-mode' : '';
  let html = '';
  for (const [dateLabel, groupItems] of Object.entries(groups)) {
    html += `
      <div class="mb-8">
        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">${dateLabel} <span class="text-gray-300 dark:text-gray-600">(${groupItems.length})</span></h3>
        <div class="masonry ${batchClass}">
          ${groupItems.map(item => {
            const flatIdx = items.indexOf(item);
            const checked = batchSelected.has(item.id) ? 'checked' : '';
            return `
              <div class="masonry-item">
                <div class="lib-card" onclick="${batchMode ? `toggleBatchItem('${item.id}')` : `openDetailModal('${item.id}')`}">
                  <div class="batch-check ${checked}" onclick="event.stopPropagation(); toggleBatchItem('${item.id}')">
                    <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
                  </div>
                  <img src="${item.url}" loading="lazy" onerror="this.style.display='none'" />
                  ${item.cdnStatus === 'failed' ? `
                    <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
                      <svg class="w-8 h-8 text-amber-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                      <p class="text-amber-300 text-xs mb-2">CDN 上传失败</p>
                      <button onclick="event.stopPropagation(); retryGalleryCdn('${item.id}')" class="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white text-xs rounded-lg transition">重新上传</button>
                    </div>
                  ` : ''}
                  <div class="lib-overlay">
                    <div class="flex-1 min-w-0">
                      <p class="text-white text-xs truncate">${escapeHtml(item.model || '')}</p>
                      <p class="text-white/60 text-xs">${formatTime(new Date(item.createdAt))}</p>
                    </div>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  content.innerHTML = html;
}

function formatDateGroup(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today - target) / 86400000);

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y === now.getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════
// Library — Detail Modal
// ═══════════════════════════════════════════════════════

let detailItemId = null;

function openDetailModal(id) {
  const items = getLibrary();
  const item = items.find(i => i.id === id);
  if (!item) return;
  detailItemId = id;

  // Image
  document.getElementById('detailImage').innerHTML = `<img src="${item.url}" class="w-full rounded-lg" onclick="openLibLightboxById('${id}')" />`;

  // Meta
  const modelNames = {
    'nano-banana-pro': 'Nano Banana Pro',
    'nano-banana2': 'Nano Banana 2',
    'seedream-5-lite': 'Seedream 5 Lite',
  };
  document.getElementById('detailModel').textContent = modelNames[item.model] || item.model || '-';
  document.getElementById('detailRatio').textContent = item.ratio || '-';
  document.getElementById('detailSize').textContent = item.size || '-';
  const d = new Date(item.createdAt);
  document.getElementById('detailDate').textContent = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // Prompt
  document.getElementById('detailPrompt').textContent = item.prompt || '(无)';

  // Base image
  const baseWrap = document.getElementById('detailBaseWrap');
  if (item.baseImageUrl) {
    document.getElementById('detailBaseImg').src = item.baseImageUrl;
    baseWrap.classList.remove('hidden');
  } else {
    baseWrap.classList.add('hidden');
  }

  // Reference images
  const refWrap = document.getElementById('detailRefWrap');
  const refContainer = document.getElementById('detailRefImages');
  if (item.referenceUrls && item.referenceUrls.length > 0) {
    refContainer.innerHTML = item.referenceUrls.map((url, i) =>
      `<img src="${url}" class="w-16 h-16 object-cover rounded cursor-pointer" onclick="document.getElementById('imagePreviewImg').src='${url}';document.getElementById('imagePreviewOverlay').classList.remove('opacity-0','pointer-events-none')" title="参考图 ${i+1}" />`
    ).join('');
    refWrap.classList.remove('hidden');
  } else {
    refWrap.classList.add('hidden');
  }

  // Actions
  document.getElementById('detailDownloadBtn').onclick = () => downloadUrl(item.url, `rendering_${item.id}.png`);
  document.getElementById('detailDeleteBtn').onclick = () => {
    if (confirm('确定从图库中删除这张图片？')) {
      deleteFromLibrary(item.id);
      closeDetail();
      renderLibrary();
    }
  };

  const modal = document.getElementById('detailModal');
  modal.classList.add('detail-open');
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';
}

function openLibLightboxById(id) {
  const items = getLibrary();
  lightboxLibItems = items;
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return;
  lightboxSource = 'library';
  lightboxIndex = idx;
  document.getElementById('lbImage').src = items[idx].url;
  document.getElementById('lightbox').classList.add('open');
  updateLightboxNav();
}

function navigateDetail(dir) {
  if (!detailItemId) return;
  const items = getLibrary();
  const idx = items.findIndex(i => i.id === detailItemId);
  if (idx < 0) return;
  const next = idx + dir;
  if (next < 0 || next >= items.length) return;
  openDetailModal(items[next].id);
}

function closeDetail(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('detailModal');
  modal.classList.remove('detail-open');
  modal.style.opacity = '0';
  modal.style.pointerEvents = 'none';
  detailItemId = null;
}

// ═══════════════════════════════════════════════════════
// Library — Batch Operations
// ═══════════════════════════════════════════════════════

function toggleBatchMode() {
  batchMode = !batchMode;
  batchSelected.clear();
  const btn = document.getElementById('batchToggleBtn');
  const bar = document.getElementById('batchBar');

  if (batchMode) {
    btn.textContent = '退出批量';
    btn.classList.add('bg-brand-50', 'dark:bg-brand-500/10', 'border-brand-300', 'dark:border-brand-500/30', 'text-brand-600');
    bar.classList.remove('hidden');
  } else {
    btn.textContent = '批量操作';
    btn.classList.remove('bg-brand-50', 'dark:bg-brand-500/10', 'border-brand-300', 'dark:border-brand-500/30', 'text-brand-600');
    bar.classList.add('hidden');
  }
  updateBatchUI();
  renderLibrary();
}

function toggleBatchItem(id) {
  if (!batchMode) {
    // Auto-enter batch mode on first check
    batchMode = true;
    document.getElementById('batchToggleBtn').textContent = '退出批量';
    document.getElementById('batchToggleBtn').classList.add('bg-brand-50', 'dark:bg-brand-500/10', 'border-brand-300', 'dark:border-brand-500/30', 'text-brand-600');
    document.getElementById('batchBar').classList.remove('hidden');
  }
  if (batchSelected.has(id)) batchSelected.delete(id);
  else batchSelected.add(id);
  updateBatchUI();
  renderLibrary();
}

function selectAllVisible() {
  const items = getLibrary();
  items.forEach(i => batchSelected.add(i.id));
  updateBatchUI();
  renderLibrary();
}

function deselectAll() {
  batchSelected.clear();
  updateBatchUI();
  renderLibrary();
}

function updateBatchUI() {
  const count = batchSelected.size;
  document.getElementById('batchSelectedCount').textContent = `已选 ${count} 张`;
  document.getElementById('batchDownloadBtn').disabled = count === 0;
  document.getElementById('batchDeleteBtn').disabled = count === 0;
}

async function batchDownload() {
  const items = getLibrary();
  const selected = items.filter(i => batchSelected.has(i.id));
  if (selected.length === 0) return;

  const btn = document.getElementById('batchDownloadBtn');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 打包中...`;

  try {
    const zip = new JSZip();
    const results = await Promise.allSettled(selected.map(async (item, i) => {
      const resp = await fetch(item.url);
      const blob = await resp.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      const date = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : '';
      zip.file(`${date ? date + '_' : ''}rendering_${i + 1}.${ext}`, blob);
    }));

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) console.warn(`[batch] ${failed}/${selected.length} images failed to fetch`);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `renderings_${new Date().toISOString().slice(0, 10)}_${selected.length}张.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(`打包下载失败: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

function batchDelete() {
  const count = batchSelected.size;
  if (count === 0) return;
  if (!confirm(`确定从图库中删除选中的 ${count} 张图片？`)) return;

  deleteFromLibrary([...batchSelected]);
  batchSelected.clear();
  updateBatchUI();
  renderLibrary();
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

// ═══════════════════════════════════════════════════════
// Reference Library — Cloud Storage (Vercel Blob)
// ═══════════════════════════════════════════════════════

let refLibItems = [];
let refBatchMode = false;
let refBatchSelected = new Set();
let refFilterDims = [];
let refUploadFiles = [];
let refDetailItemId = null;
let refLibLoaded = false;

const STYLE_LABELS = {
  'spring-morning': '春日晨景',
  'blue-hour-commercial': '蓝调商业夜景',
  'minimal-gray': '极简高级灰',
  'blue-hour-gentle': '温柔蓝调时刻',
  'urban-rain': '都市雨幕风',
  'warm-fog': '暖调光雾风',
  'daylight-realism': '日光写实风',
};

async function loadRefLibrary() {
  if (refLibLoaded && refLibItems.length > 0) {
    renderRefLibrary();
    return;
  }

  const loading = document.getElementById('refLibLoading');
  const content = document.getElementById('refLibContent');
  const empty = document.getElementById('refLibEmpty');
  loading.classList.remove('hidden');
  content.innerHTML = '';
  empty.classList.add('hidden');

  try {
    const resp = await fetch('/api/ref-library');
    const data = await resp.json();
    refLibItems = data.items || [];
    refLibLoaded = true;
  } catch (err) {
    console.error('[reflib] load error:', err);
    refLibItems = [];
  }

  loading.classList.add('hidden');
  renderRefLibrary();
  updateRefLibCount();
}

function renderRefLibrary() {
  const content = document.getElementById('refLibContent');
  const empty = document.getElementById('refLibEmpty');
  const totalEl = document.getElementById('refLibTotalCount');

  const filtered = getFilteredRefItems();
  totalEl.textContent = `${filtered.length}${filtered.length !== refLibItems.length ? ' / ' + refLibItems.length : ''} 张`;

  if (filtered.length === 0) {
    content.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  let html = '<div class="masonry">';
  for (const item of filtered) {
    const chips = renderTagChips(item.tags);
    const checked = refBatchSelected.has(item.id) ? 'checked' : '';
    html += `
      <div class="masonry-item">
        <div class="lib-card" onclick="${refBatchMode ? `toggleRefBatchItem('${item.id}')` : `openRefDetailModal('${item.id}')`}">
          <div class="batch-check ${checked}" onclick="event.stopPropagation(); toggleRefBatchItem('${item.id}')">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
          </div>
          <img src="${item.url}" loading="lazy" />
          <div class="lib-overlay">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap gap-1 mb-1">${chips}</div>
              <p class="text-white/60 text-xs truncate">${escapeHtml(item.description || '')}</p>
            </div>
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

function renderTagChips(tags) {
  if (!tags) return '';
  const chips = [];
  if (tags.style && STYLE_LABELS[tags.style]) {
    chips.push(`<span class="ref-tag ref-tag-style">${STYLE_LABELS[tags.style]}</span>`);
  }
  if (tags.dimensions) {
    for (const d of tags.dimensions) {
      chips.push(`<span class="ref-tag ref-tag-dim">${d}</span>`);
    }
  }
  if (tags.scene) {
    chips.push(`<span class="ref-tag ref-tag-scene">${tags.scene}</span>`);
  }
  if (tags.custom) {
    for (const c of tags.custom) {
      chips.push(`<span class="ref-tag ref-tag-custom">${escapeHtml(c)}</span>`);
    }
  }
  return chips.slice(0, 5).join('');
}

function getFilteredRefItems() {
  const styleFilter = document.getElementById('refFilterStyle')?.value || '';
  const sceneFilter = document.getElementById('refFilterScene')?.value || '';
  const customFilter = (document.getElementById('refFilterCustom')?.value || '').trim().toLowerCase();

  return refLibItems.filter(item => {
    const tags = item.tags || {};
    if (styleFilter && tags.style !== styleFilter) return false;
    if (sceneFilter && tags.scene !== sceneFilter) return false;
    if (refFilterDims.length > 0) {
      const dims = tags.dimensions || [];
      if (!refFilterDims.some(d => dims.includes(d))) return false;
    }
    if (customFilter) {
      const customs = (tags.custom || []).map(c => c.toLowerCase());
      const desc = (item.description || '').toLowerCase();
      if (!customs.some(c => c.includes(customFilter)) && !desc.includes(customFilter)) return false;
    }
    return true;
  });
}

function filterRefLibrary() {
  renderRefLibrary();
}

function toggleRefDimFilter(dim) {
  const idx = refFilterDims.indexOf(dim);
  if (idx >= 0) refFilterDims.splice(idx, 1);
  else refFilterDims.push(dim);

  document.querySelectorAll('.ref-dim-filter').forEach(btn => {
    btn.classList.toggle('active', refFilterDims.includes(btn.dataset.dim));
  });
  renderRefLibrary();
}

function updateRefLibCount() {
  const el = document.getElementById('refLibCount');
  const count = refLibItems.length;
  el.textContent = count;
  el.style.display = count > 0 ? '' : 'none';
}

// ─── Batch Mode ───

function toggleRefBatchMode() {
  refBatchMode = !refBatchMode;
  refBatchSelected.clear();
  document.getElementById('refBatchBar').classList.toggle('hidden', !refBatchMode);
  document.getElementById('refBatchToggleBtn').textContent = refBatchMode ? '退出批量' : '批量操作';
  updateRefBatchCount();
  renderRefLibrary();
}

function toggleRefBatchItem(id) {
  if (refBatchSelected.has(id)) refBatchSelected.delete(id);
  else refBatchSelected.add(id);
  updateRefBatchCount();
  renderRefLibrary();
}

function refSelectAll() {
  for (const item of getFilteredRefItems()) refBatchSelected.add(item.id);
  updateRefBatchCount();
  renderRefLibrary();
}

function refDeselectAll() {
  refBatchSelected.clear();
  updateRefBatchCount();
  renderRefLibrary();
}

function updateRefBatchCount() {
  const n = refBatchSelected.size;
  document.getElementById('refBatchSelectedCount').textContent = `已选 ${n} 张`;
  document.getElementById('refBatchDownloadBtn').disabled = n === 0;
  document.getElementById('refBatchEditBtn').disabled = n === 0;
  document.getElementById('refBatchDeleteBtn').disabled = n === 0;
}

async function refBatchDownload() {
  const selected = refLibItems.filter(i => refBatchSelected.has(i.id));
  if (selected.length === 0) return;

  const btn = document.getElementById('refBatchDownloadBtn');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 打包中...`;

  try {
    const zip = new JSZip();
    const results = await Promise.allSettled(selected.map(async (item, i) => {
      const resp = await fetch(item.url);
      const blob = await resp.blob();
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      zip.file(`ref_${i + 1}.${ext}`, blob);
    }));

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) console.warn(`[ref-batch] ${failed}/${selected.length} images failed to fetch`);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = `references_${new Date().toISOString().slice(0, 10)}_${selected.length}张.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(`打包下载失败: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

async function refBatchDelete() {
  const n = refBatchSelected.size;
  if (n === 0) return;
  if (!confirm(`确定删除 ${n} 张素材？`)) return;

  try {
    const resp = await fetch('/api/ref-library', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...refBatchSelected] }),
    });
    const data = await resp.json();
    if (data.deleted > 0) {
      refLibItems = refLibItems.filter(i => !refBatchSelected.has(i.id));
      refBatchSelected.clear();
      updateRefBatchCount();
      updateRefLibCount();
      renderRefLibrary();
    }
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

// ─── Upload Modal ───

function openRefUploadModal() {
  refUploadFiles = [];
  document.getElementById('refUploadPreview').innerHTML = '';
  document.getElementById('refUploadPreview').classList.add('hidden');
  document.getElementById('refUploadFileInput').value = '';
  document.getElementById('refUploadStyle').value = '';
  document.getElementById('refUploadScene').value = '';
  document.getElementById('refUploadCustomTags').value = '';
  document.getElementById('refUploadDesc').value = '';
  document.querySelectorAll('#refUploadDims .focus-tag').forEach(b => b.classList.remove('active'));
  document.getElementById('refUploadSubmitBtn').disabled = true;
  document.getElementById('refUploadSubmitBtn').textContent = '上传并保存';

  const modal = document.getElementById('refUploadModal');
  modal.classList.remove('opacity-0', 'pointer-events-none');

  // Setup drag-drop
  const dz = document.getElementById('refUploadDropZone');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    addRefUploadFiles(e.dataTransfer.files);
  };
}

function closeRefUploadModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('refUploadModal').classList.add('opacity-0', 'pointer-events-none');
}

function handleRefUploadFiles(event) {
  addRefUploadFiles(event.target.files);
}

function addRefUploadFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue;
    refUploadFiles.push(file);
  }
  renderRefUploadPreview();
}

let refUploadObjectUrls = [];

function renderRefUploadPreview() {
  const preview = document.getElementById('refUploadPreview');

  // 释放上一轮的 Object URLs
  for (const u of refUploadObjectUrls) URL.revokeObjectURL(u);
  refUploadObjectUrls = [];

  if (refUploadFiles.length === 0) {
    preview.classList.add('hidden');
    document.getElementById('refUploadSubmitBtn').disabled = true;
    return;
  }
  preview.classList.remove('hidden');
  document.getElementById('refUploadSubmitBtn').disabled = false;

  preview.innerHTML = refUploadFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    refUploadObjectUrls.push(url);
    return `<div class="relative group">
      <img src="${url}" class="w-full aspect-square object-cover rounded-lg" />
      <button onclick="removeRefUploadFile(${i})" class="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
    </div>`;
  }).join('');
}

function removeRefUploadFile(idx) {
  refUploadFiles.splice(idx, 1);
  renderRefUploadPreview();
}

function toggleRefUploadDim(btn) {
  btn.classList.toggle('active');
}

function getSelectedDims(containerId) {
  const dims = [];
  document.querySelectorAll(`#${containerId} .focus-tag.active`).forEach(b => {
    dims.push(b.dataset.dim);
  });
  return dims;
}

async function submitRefUpload() {
  if (refUploadFiles.length === 0) return;

  const btn = document.getElementById('refUploadSubmitBtn');
  btn.disabled = true;
  btn.textContent = '上传中...';

  const tags = {
    style: document.getElementById('refUploadStyle').value,
    dimensions: getSelectedDims('refUploadDims'),
    scene: document.getElementById('refUploadScene').value,
    custom: document.getElementById('refUploadCustomTags').value
      .split(/[,，]/).map(s => s.trim()).filter(Boolean),
  };
  const description = document.getElementById('refUploadDesc').value.trim();

  try {
    // Convert files to data URIs
    const images = [];
    for (const file of refUploadFiles) {
      const dataUrl = await fileToDataUrl(file);
      images.push({ data: dataUrl, tags: { ...tags }, description });
    }

    const resp = await fetch('/api/ref-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    if (data.added) {
      refLibItems.unshift(...data.added);
      updateRefLibCount();
      renderRefLibrary();
    }

    closeRefUploadModal();
  } catch (err) {
    alert('上传失败：' + err.message);
    btn.disabled = false;
    btn.textContent = '上传并保存';
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// ─── Inline Drop Zone (quick upload) ───

function initRefInlineDropZone() {
  const dz = document.getElementById('refInlineDropZone');
  if (!dz) return;
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    handleInlineRefUploadFiles(e.dataTransfer.files);
  });
}

function handleInlineRefUpload(event) {
  handleInlineRefUploadFiles(event.target.files);
  event.target.value = '';
}

async function handleInlineRefUploadFiles(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;

  const progress = document.getElementById('refInlineUploadProgress');
  const progressText = document.getElementById('refInlineUploadText');
  progress.classList.remove('hidden');

  try {
    const images = [];
    for (let i = 0; i < files.length; i++) {
      progressText.textContent = `读取图片 ${i + 1}/${files.length}...`;
      const dataUrl = await fileToDataUrl(files[i]);
      images.push({
        data: dataUrl,
        tags: { style: '', dimensions: [], scene: '', custom: [] },
        description: '',
      });
    }

    progressText.textContent = `上传 ${images.length} 张图片...`;
    const resp = await fetch('/api/ref-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    if (data.added) {
      refLibItems.unshift(...data.added);
      updateRefLibCount();
      renderRefLibrary();
    }
  } catch (err) {
    alert('上传失败：' + err.message);
  } finally {
    progress.classList.add('hidden');
  }
}

// ─── Detail Modal ───

function openRefDetailModal(id) {
  const item = refLibItems.find(i => i.id === id);
  if (!item) return;
  refDetailItemId = id;

  document.getElementById('refDetailImage').innerHTML = `<img src="${item.url}" class="w-full rounded-lg" />`;

  // Populate tag editors
  document.getElementById('refDetailStyle').value = item.tags?.style || '';
  document.getElementById('refDetailScene').value = item.tags?.scene || '';
  document.getElementById('refDetailCustomTags').value = (item.tags?.custom || []).join(', ');
  document.getElementById('refDetailDesc').value = item.description || '';

  // Render dimension chips
  const dims = item.tags?.dimensions || [];
  const dimContainer = document.getElementById('refDetailDims');
  dimContainer.innerHTML = ['光线', '色调', '材质', '建筑特征', '环境配景'].map(d =>
    `<button type="button" onclick="toggleRefUploadDim(this)" data-dim="${d}" class="focus-tag text-xs px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 ${dims.includes(d) ? 'active' : ''}">${d}</button>`
  ).join('');

  // Date
  const date = new Date(item.addedAt);
  document.getElementById('refDetailDate').textContent = `添加于 ${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

  document.getElementById('refDetailModal').classList.remove('opacity-0', 'pointer-events-none');
}

function closeRefDetail(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('refDetailModal').classList.add('opacity-0', 'pointer-events-none');
  refDetailItemId = null;
}

function previewRefImage() {
  const item = refLibItems.find(i => i.id === refDetailItemId);
  if (!item) return;
  document.getElementById('imagePreviewImg').src = item.url;
  document.getElementById('imagePreviewOverlay').classList.remove('opacity-0', 'pointer-events-none');
}

function closeImagePreview() {
  document.getElementById('imagePreviewOverlay').classList.add('opacity-0', 'pointer-events-none');
}

async function downloadRefImage() {
  const item = refLibItems.find(i => i.id === refDetailItemId);
  if (!item) return;
  try {
    const resp = await fetch(item.url);
    const blob = await resp.blob();
    const ext = blob.type.includes('png') ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ref_${item.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    // Fallback: open in new tab
    window.open(item.url, '_blank');
  }
}

async function saveRefDetail() {
  if (!refDetailItemId) return;

  const tags = {
    style: document.getElementById('refDetailStyle').value,
    dimensions: getSelectedDims('refDetailDims'),
    scene: document.getElementById('refDetailScene').value,
    custom: document.getElementById('refDetailCustomTags').value
      .split(/[,，]/).map(s => s.trim()).filter(Boolean),
  };
  const description = document.getElementById('refDetailDesc').value.trim();

  try {
    const resp = await fetch('/api/ref-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: refDetailItemId, tags, description }] }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    // Update local cache
    const item = refLibItems.find(i => i.id === refDetailItemId);
    if (item) {
      item.tags = tags;
      item.description = description;
    }
    renderRefLibrary();
    closeRefDetail();
  } catch (err) {
    alert('保存失败：' + err.message);
  }
}

async function deleteRefDetail() {
  if (!refDetailItemId) return;
  if (!confirm('确定删除这张素材？')) return;

  try {
    await fetch('/api/ref-library', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [refDetailItemId] }),
    });
    refLibItems = refLibItems.filter(i => i.id !== refDetailItemId);
    updateRefLibCount();
    renderRefLibrary();
    closeRefDetail();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

function useAsReference() {
  const item = refLibItems.find(i => i.id === refDetailItemId);
  if (!item) return;

  closeRefDetail();
  switchView('generate');

  // Add to references in generate view
  const refIndex = references.length;
  references.push({
    imageUrl: item.url,
    image: null,
    focuses: item.tags?.dimensions || [],
    supplement: '',
    analysis: '',
  });
  renderRefList();
}

// ─── Ref Library Picker (import to generate view) ───

let pickerSelected = new Set();

async function openRefLibPicker() {
  pickerSelected = new Set();
  // Load ref library if not already loaded
  if (!refLibLoaded) {
    try {
      const resp = await fetch('/api/ref-library');
      const data = await resp.json();
      refLibItems = data.items || [];
      refLibLoaded = true;
    } catch (err) {
      alert('加载素材库失败: ' + err.message);
      return;
    }
  }
  renderPickerGrid();
  document.getElementById('refLibPickerModal').classList.remove('opacity-0', 'pointer-events-none');
}

function closeRefLibPicker(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('refLibPickerModal').classList.add('opacity-0', 'pointer-events-none');
}

function filterPickerItems() {
  renderPickerGrid();
}

function getFilteredPickerItems() {
  const style = document.getElementById('pickerStyleFilter').value;
  const scene = document.getElementById('pickerSceneFilter').value;
  return refLibItems.filter(item => {
    if (style && item.tags?.style !== style) return false;
    if (scene && item.tags?.scene !== scene) return false;
    return true;
  });
}

function renderPickerGrid() {
  const items = getFilteredPickerItems();
  const grid = document.getElementById('pickerGrid');
  const countEl = document.getElementById('pickerCount');

  countEl.textContent = `${items.length} 张素材`;

  if (items.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-center text-sm text-gray-400 py-8">素材库为空，请先添加素材</p>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const selected = pickerSelected.has(item.id);
    const dims = (item.tags?.dimensions || []).join('·');
    return `<div class="relative cursor-pointer rounded-lg overflow-hidden border-2 ${selected ? 'border-brand-500 ring-2 ring-brand-300' : 'border-transparent hover:border-gray-300'} transition-all" onclick="togglePickerItem('${item.id}')">
      <img src="${item.url}" class="w-full aspect-square object-cover" loading="lazy" />
      ${selected ? '<div class="absolute top-1 right-1 w-5 h-5 bg-brand-500 text-white rounded-full text-xs flex items-center justify-center">✓</div>' : ''}
      ${dims ? `<div class="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5"><span class="text-[10px] text-white/80">${dims}</span></div>` : ''}
    </div>`;
  }).join('');

  updatePickerCount();
}

function togglePickerItem(id) {
  if (pickerSelected.has(id)) {
    pickerSelected.delete(id);
  } else {
    pickerSelected.add(id);
  }
  renderPickerGrid();
}

function updatePickerCount() {
  const count = pickerSelected.size;
  document.getElementById('pickerSelectedCount').textContent = `已选 ${count} 张`;
  document.getElementById('pickerImportBtn').disabled = count === 0;
}

function importFromRefLib() {
  if (pickerSelected.size === 0) return;
  for (const id of pickerSelected) {
    const item = refLibItems.find(i => i.id === id);
    if (!item) continue;
    // Avoid duplicate imports
    if (references.some(r => r.imageUrl === item.url)) continue;
    references.push({
      imageUrl: item.url,
      image: null,
      focuses: item.tags?.dimensions || [],
      supplement: '',
      analysis: '',
    });
  }
  renderRefList();
  closeRefLibPicker();
}

// ─── Batch Edit Modal ───

function openRefBatchEditModal() {
  if (refBatchSelected.size === 0) return;
  document.getElementById('refBatchStyle').value = '';
  document.getElementById('refBatchScene').value = '';
  document.getElementById('refBatchCustomTags').value = '';
  document.querySelectorAll('#refBatchDims .focus-tag').forEach(b => b.classList.remove('active'));
  document.querySelector('input[name="refBatchMode"][value="replace"]').checked = true;
  document.getElementById('refBatchEditModal').classList.remove('opacity-0', 'pointer-events-none');
}

function closeRefBatchEdit(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('refBatchEditModal').classList.add('opacity-0', 'pointer-events-none');
}

async function submitRefBatchEdit() {
  const mode = document.querySelector('input[name="refBatchMode"]:checked')?.value || 'replace';
  const newStyle = document.getElementById('refBatchStyle').value;
  const newScene = document.getElementById('refBatchScene').value;
  const newDims = getSelectedDims('refBatchDims');
  const newCustom = document.getElementById('refBatchCustomTags').value
    .split(/[,，]/).map(s => s.trim()).filter(Boolean);

  const updates = [];
  for (const id of refBatchSelected) {
    const item = refLibItems.find(i => i.id === id);
    if (!item) continue;

    const currentTags = item.tags || { style: '', dimensions: [], scene: '', custom: [] };
    const tags = { ...currentTags };

    if (newStyle) tags.style = newStyle;
    if (newScene) tags.scene = newScene;

    if (newDims.length > 0) {
      tags.dimensions = mode === 'merge'
        ? [...new Set([...(currentTags.dimensions || []), ...newDims])]
        : newDims;
    }

    if (newCustom.length > 0) {
      tags.custom = mode === 'merge'
        ? [...new Set([...(currentTags.custom || []), ...newCustom])]
        : newCustom;
    }

    updates.push({ id, tags });
  }

  if (updates.length === 0) { closeRefBatchEdit(); return; }

  try {
    const resp = await fetch('/api/ref-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    // Update local cache
    for (const upd of updates) {
      const item = refLibItems.find(i => i.id === upd.id);
      if (item) item.tags = upd.tags;
    }
    renderRefLibrary();
    closeRefBatchEdit();
  } catch (err) {
    alert('批量编辑失败：' + err.message);
  }
}

// ═══════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════

galleryLoadPromise = loadGallery(); // async — loads cloud gallery, updates count
initRefInlineDropZone();

// Safety net: flush unsaved gallery data before page unload
window.addEventListener('beforeunload', () => {
  if (galleryDirty && galleryCache.length > 0) {
    navigator.sendBeacon('/api/gallery-beacon', JSON.stringify({ items: galleryCache }));
  }
});
