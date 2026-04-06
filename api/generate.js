/**
 * 图片生成端点：TAMS API 集成
 * 支持 Gemini (genai) 和 Seedream (volcano) 模型
 * SSE 流式返回生成进度和结果
 *
 * v2: 并行创建+轮询+上传，避免串行超时
 */

const { uploadBase64ToCDN, downloadAndUploadToCDN } = require('../lib/cdn');

const TAMS_BASE = 'https://cn.tensorart.net';

const MODEL_MAP = {
  'nano-banana-pro': { id: 'google/gemini-3-pro-image-preview', provider: 'genai', name: 'Nano Banana Pro' },
  'nano-banana2': { id: 'google/gemini-3.1-flash-image-preview', provider: 'genai', name: 'Nano Banana 2' },
  'seedream-5-lite': { id: 'doubao-seedream-5.0-lite', provider: 'volcano', name: 'Seedream 5 Lite' },
};

const SEEDREAM_SIZES = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '4:3':  { '1K': '1024x768',  '2K': '2048x1536', '4K': '4096x3072' },
  '3:4':  { '1K': '768x1024',  '2K': '1536x2048', '4K': '3072x4096' },
  '3:2':  { '1K': '1024x682',  '2K': '2048x1366', '4K': '4096x2730' },
  '2:3':  { '1K': '682x1024',  '2K': '1366x2048', '4K': '2730x4096' },
  '16:9': { '1K': '1024x576',  '2K': '2048x1152', '4K': '4096x2304' },
  '9:16': { '1K': '576x1024',  '2K': '1152x2048', '4K': '2304x4096' },
};

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function tamsHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Gemini (genai) ───

function buildGeminiPrompt(prompt, hasBase, refCount, refAnalyses) {
  // 无参考图时直接用原始 prompt
  if (refCount === 0) return prompt;

  const imageLabels = [];
  if (hasBase) imageLabels.push('Image 1 is the base architectural rendering to modify.');
  const refStart = hasBase ? 2 : 1;
  const refEnd = refStart + refCount - 1;
  if (refCount === 1) {
    imageLabels.push(`Image ${refStart} is a style reference image.`);
  } else {
    imageLabels.push(`Images ${refStart}-${refEnd} are style reference images.`);
  }

  const lines = [
    ...imageLabels,
    '',
    'You MUST match the visual characteristics of the style reference images:',
    '- Match their color palette: highlight tones, shadow tones, overall warmth/coolness',
    '- Match their lighting: direction, intensity, color temperature, and atmosphere',
    '- Match their vegetation style: tree species, canopy shape, density, and placement',
    '- Match their sky treatment and environmental mood',
    '- Match their material rendering quality and texture style',
    '',
  ];

  if (hasBase) {
    lines.push('Generate a new image based on Image 1, applying the visual style from the reference images.');
  } else {
    lines.push('Generate a new architectural rendering applying the visual style from the reference images.');
  }

  // P1: 注入参考图分析结果作为硬约束
  if (refAnalyses && refAnalyses.length > 0) {
    const validAnalyses = refAnalyses.filter(a => a && a.trim());
    if (validAnalyses.length > 0) {
      lines.push('');
      lines.push('--- Reference Image Visual Analysis (strictly follow these) ---');
      validAnalyses.forEach((analysis, i) => {
        lines.push(`[Reference ${i + 1}] ${analysis}`);
      });
    }
  }

  lines.push('');
  lines.push('Specific instructions:');
  lines.push(prompt);

  return lines.join('\n');
}

async function createGeminiTask(token, modelId, prompt, baseImageUrl, referenceUrls, imageConfig) {
  const parts = [];
  if (baseImageUrl) {
    const mime = /\.png$/i.test(baseImageUrl) ? 'image/png' : 'image/jpeg';
    parts.push({ fileData: { mimeType: mime, fileUri: baseImageUrl } });
  }
  if (referenceUrls && referenceUrls.length > 0) {
    for (const refUrl of referenceUrls) {
      const mime = /\.png$/i.test(refUrl) ? 'image/png' : 'image/jpeg';
      parts.push({ fileData: { mimeType: mime, fileUri: refUrl } });
    }
  }
  parts.push({ text: prompt });

  console.log(`[generate] Gemini parts: ${parts.length} (base=${baseImageUrl ? 1 : 0}, refs=${referenceUrls?.length || 0}, text=1)`);

  const resp = await fetch(`${TAMS_BASE}/v2/gcp/genai/models/generate-content/async/create`, {
    method: 'POST',
    headers: tamsHeaders(token),
    body: JSON.stringify({
      model: modelId,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Gemini create failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
  }
  return (await resp.json()).request_id;
}

// ─── Volcano (Seedream) ───

async function createVolcanoTask(token, modelId, prompt, baseImageUrl, size) {
  const body = { model: modelId, prompt };
  if (baseImageUrl) body.image = baseImageUrl;
  if (size) body.size = size;

  const resp = await fetch(`${TAMS_BASE}/v2/gcp/volcano/images/generations/async/create`, {
    method: 'POST',
    headers: tamsHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Volcano create failed: HTTP ${resp.status} — ${text.slice(0, 200)}`);
  }
  return (await resp.json()).request_id;
}

// ─── 轮询 ───

async function pollResult(token, provider, requestId, onProgress) {
  const endpoint = provider === 'genai'
    ? `${TAMS_BASE}/v2/gcp/genai/models/generate-content/async/get`
    : `${TAMS_BASE}/v2/gcp/volcano/images/generations/async/get`;

  const interval = 3000;
  const maxAttempts = 60; // 3min max

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, interval));

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: tamsHeaders(token),
        body: JSON.stringify({ request_id: requestId }),
        signal: AbortSignal.timeout(10000),
      });

      const data = await resp.json();
      const status = data.status || '';

      if (status === 'COMPLETED') return { success: true, data };
      if (status === 'FAILED' || status === 'CANCELLED') {
        return { success: false, error: data.err_message || data.message || 'Generation failed' };
      }
      if (onProgress) onProgress(status, i);
    } catch (e) {
      if (e.name === 'AbortError') continue;
      throw e;
    }
  }
  return { success: false, error: 'Timeout: 3 minutes exceeded' };
}

// ─── 提取图片 ───

function extractImage(provider, data) {
  if (provider === 'volcano') {
    const items = data?.response?.data;
    if (items?.[0]?.url) return { type: 'url', value: items[0].url };
  } else {
    const parts = data?.response?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.fileData?.fileUri) return { type: 'url', value: part.fileData.fileUri };
      if (part.inlineData?.data) return { type: 'base64', value: part.inlineData.data, mime: part.inlineData.mimeType || 'image/png' };
    }
  }
  return null;
}

// ─── Phase 1: 生成单张图片（create + poll），返回原始结果 ───

async function generateOneImage({ index, total, tamsToken, modelInfo, prompt, baseImageUrl, referenceUrls, ratio, size, res }) {
  const label = `${index + 1}/${total}`;

  // 1. Create task
  sendSSE(res, { type: 'progress', message: `Creating task ${label}...`, index });
  let requestId;
  if (modelInfo.provider === 'genai') {
    requestId = await createGeminiTask(tamsToken, modelInfo.id, prompt, baseImageUrl, referenceUrls, { aspectRatio: ratio, imageSize: size });
  } else {
    const sizeStr = SEEDREAM_SIZES[ratio]?.[size] || '2048x1536';
    requestId = await createVolcanoTask(tamsToken, modelInfo.id, prompt, baseImageUrl, sizeStr);
  }

  // 2. Poll
  sendSSE(res, { type: 'progress', message: `Generating ${label}...`, index });
  const result = await pollResult(tamsToken, modelInfo.provider, requestId, (status, attempt) => {
    if (attempt % 3 === 0) {
      sendSSE(res, { type: 'progress', message: `Generating ${label} (${Math.round(attempt * 3)}s)...`, index });
    }
  });

  if (!result.success) throw new Error(result.error);

  // 3. Extract image
  const imageResult = extractImage(modelInfo.provider, result.data);
  if (!imageResult) throw new Error('No image data in response');

  // 4. Immediately show with temporary URL
  const tempUrl = imageResult.type === 'url'
    ? imageResult.value
    : `data:${imageResult.mime};base64,${imageResult.value}`;
  sendSSE(res, { type: 'image', url: tempUrl, index });
  console.log(`[generate] ${label} generated: ${tempUrl.slice(0, 80)}...`);

  return { index, imageResult };
}

// ─── Phase 2: 批量上传 CDN ───

async function uploadOneToCDN({ index, imageResult, cdnToken, res }) {
  try {
    let cdnUrl;
    if (imageResult.type === 'base64') {
      cdnUrl = await uploadBase64ToCDN(imageResult.value, imageResult.mime, cdnToken);
    } else {
      cdnUrl = await downloadAndUploadToCDN(imageResult.value, cdnToken);
    }
    // Update frontend with persistent CDN URL
    sendSSE(res, { type: 'image_updated', url: cdnUrl, index });
    console.log(`[generate] ${index + 1} CDN: ${cdnUrl.slice(0, 80)}...`);
  } catch (err) {
    console.warn(`[generate] CDN upload failed for ${index + 1}: ${err.message}`);
    // Keep the temp URL, no update needed
  }
}

// ─── Handler ───

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, model: modelKey, baseImageUrl, referenceUrls, refAnalyses, aspectRatio, imageSize, count } = req.body;

  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  const tamsToken = process.env.TAMS_TOKEN || process.env.TAMS_API_TOKEN;
  if (!tamsToken) return res.status(500).json({ error: 'TAMS_TOKEN 未配置，请在 .env 中设置' });

  const modelInfo = MODEL_MAP[modelKey || 'nano-banana-pro'];
  if (!modelInfo) return res.status(400).json({ error: `未知模型: ${modelKey}` });

  const imageCount = Math.min(Math.max(parseInt(count, 10) || 2, 1), 4);
  const ratio = aspectRatio || '4:3';
  const size = imageSize || '2K';

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sendSSE(res, { type: 'info', model: modelInfo.name, count: imageCount });
  // P0: 构建结构化参考图指令，让 Gemini 明确每张图的角色
  const structuredPrompt = buildGeminiPrompt(
    prompt,
    !!baseImageUrl,
    (referenceUrls || []).length,
    refAnalyses || []
  );
  console.log(`[generate] model=${modelInfo.name} count=${imageCount} ratio=${ratio} size=${size} refs=${(referenceUrls||[]).length} mode=generate-then-upload`);
  if ((referenceUrls || []).length > 0) {
    console.log(`[generate] structured prompt:\n${structuredPrompt.slice(0, 500)}...`);
  }

  const cdnToken = process.env.TENSORART_BEARER_TOKEN;
  const shared = { tamsToken, modelInfo, prompt: structuredPrompt, baseImageUrl, referenceUrls: referenceUrls || [], ratio, size, res, total: imageCount };

  // Phase 1: Generate all images in parallel (show temp URLs immediately)
  const genTasks = [];
  for (let i = 0; i < imageCount; i++) {
    genTasks.push(
      generateOneImage({ ...shared, index: i }).catch(err => {
        console.error(`[generate] ${i + 1}/${imageCount} error:`, err.message);
        sendSSE(res, { type: 'error', message: err.message, index: i });
        return null;
      })
    );
  }
  const genResults = (await Promise.all(genTasks)).filter(Boolean);

  // Phase 2: Batch upload to CDN (in parallel, non-blocking for user)
  if (genResults.length > 0 && cdnToken) {
    sendSSE(res, { type: 'progress', message: 'Uploading to CDN...', index: -1 });
    await Promise.allSettled(
      genResults.map(r => uploadOneToCDN({ ...r, cdnToken, res }))
    );
  }

  sendSSE(res, { type: 'done' });
  res.end();
};
