// ============ State ============
let baseImageData = null;
const references = []; // [{ image: base64, focuses: string[] }]

const FOCUS_OPTIONS = ['光线', '色调', '材质', '氛围', '配景', '构图', '空气感'];

// ============ Base Image ============
const baseDropZone = document.getElementById('baseDropZone');
const baseInput = document.getElementById('baseInput');

baseDropZone.addEventListener('click', () => baseInput.click());
baseDropZone.addEventListener('dragover', (e) => { e.preventDefault(); baseDropZone.classList.add('dragover'); });
baseDropZone.addEventListener('dragleave', () => baseDropZone.classList.remove('dragover'));
baseDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  baseDropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleBaseFile(e.dataTransfer.files[0]);
});
baseInput.addEventListener('change', (e) => { if (e.target.files[0]) handleBaseFile(e.target.files[0]); });

function handleBaseFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    baseImageData = e.target.result;
    document.getElementById('baseImg').src = baseImageData;
    document.getElementById('basePlaceholder').classList.add('hidden');
    document.getElementById('basePreview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function removeBaseImage(e) {
  e.stopPropagation();
  baseImageData = null;
  baseInput.value = '';
  document.getElementById('basePlaceholder').classList.remove('hidden');
  document.getElementById('basePreview').classList.add('hidden');
}

// ============ Reference Images ============
const refDropZone = document.getElementById('refDropZone');
const refInput = document.getElementById('refInput');

refDropZone.addEventListener('click', () => refInput.click());
refDropZone.addEventListener('dragover', (e) => { e.preventDefault(); refDropZone.classList.add('dragover'); });
refDropZone.addEventListener('dragleave', () => refDropZone.classList.remove('dragover'));
refDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  refDropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleRefFile(e.dataTransfer.files[0]);
});
refInput.addEventListener('change', (e) => { if (e.target.files[0]) handleRefFile(e.target.files[0]); });

function handleRefFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const ref = { image: e.target.result, focuses: [] };
    references.push(ref);
    renderRefList();
  };
  reader.readAsDataURL(file);
}

function removeRef(index) {
  references.splice(index, 1);
  renderRefList();
}

function toggleFocus(refIndex, focus) {
  const ref = references[refIndex];
  const idx = ref.focuses.indexOf(focus);
  if (idx === -1) ref.focuses.push(focus);
  else ref.focuses.splice(idx, 1);
  renderRefList();
}

function renderRefList() {
  const container = document.getElementById('refList');
  container.innerHTML = references.map((ref, i) => `
    <div class="ref-card bg-gray-50 rounded-lg p-3 border border-gray-100 fade-in">
      <div class="flex gap-3">
        <img src="${ref.image}" class="w-20 h-20 object-cover rounded-md flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-gray-500 font-medium">参考图 ${i + 1}</span>
            <button onclick="removeRef(${i})" class="text-xs text-red-400 hover:text-red-600">移除</button>
          </div>
          <p class="text-xs text-gray-400 mb-1.5">从这张图学习：</p>
          <div class="flex flex-wrap gap-1.5">
            ${FOCUS_OPTIONS.map(f => `
              <span class="focus-tag text-xs px-2 py-0.5 rounded-full border border-gray-300 ${ref.focuses.includes(f) ? 'active' : 'text-gray-600'}"
                    onclick="toggleFocus(${i}, '${f}')">${f}</span>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ============ Enhance ============
async function enhance() {
  const intent = document.getElementById('intent').value.trim();
  if (!intent && !baseImageData) {
    alert('请至少填写设计意图或上传基础图');
    return;
  }

  const btn = document.getElementById('enhanceBtn');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> 生成中...';

  const outputSection = document.getElementById('outputSection');
  const outputContent = document.getElementById('outputContent');
  outputSection.classList.remove('hidden');
  outputContent.innerHTML = '';
  outputContent.classList.add('streaming-cursor');

  const params = {
    sceneType: document.getElementById('sceneType').value,
    timeWeather: document.getElementById('timeWeather').value,
    buildingStyle: document.getElementById('buildingStyle').value,
    outputMethod: document.getElementById('outputMethod').value,
  };

  const body = {
    intent,
    params,
    baseImage: baseImageData || null,
    references: references.map(r => ({
      image: r.image,
      focuses: r.focuses,
    })),
  };

  try {
    const resp = await fetch('/api/enhance', {
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
          if (data.error) {
            outputContent.innerHTML += `\n\n[Error: ${data.error}]`;
          } else if (data.content) {
            outputContent.textContent += data.content;
          }
          // auto-scroll
          outputContent.scrollTop = outputContent.scrollHeight;
        } catch {}
      }
    }
  } catch (err) {
    outputContent.innerHTML += `\n\n[网络错误: ${err.message}]`;
  } finally {
    outputContent.classList.remove('streaming-cursor');
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg> 生成 Enhanced Prompt';
  }
}

// ============ Copy ============
function copyOutput() {
  const text = document.getElementById('outputContent').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target.closest('button');
    const original = btn.innerHTML;
    btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> 已复制';
    setTimeout(() => btn.innerHTML = original, 1500);
  });
}
