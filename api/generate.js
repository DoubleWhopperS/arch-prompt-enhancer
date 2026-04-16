/**
 * 图片生成端点
 *
 * 双路径:
 *   管理员 → TAMS 异步 API (Gemini + Seedream)
 *   外部用户 → OpenAI 兼容 chat completions (Gemini 出图)
 *
 * v3: 用户账号系统 + OpenAI 兼容出图路径
 */

const OpenAI = require('openai');
const { uploadBase64ToCDN, downloadAndUploadToCDN } = require('../lib/cdn');
const { withAuth, isAdmin } = require('../lib/auth');

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

// ─── 基础图几何锁定 — 动态语义池 ───
// 目的：避免 LLM 把固定模板末尾约束当作"已知套话"忽略。
// 每次随机选 1 句，让 prompt 末尾的强约束保持新鲜度。
const BASE_IMAGE_GEOMETRY_LOCKS = [
  'CRITICAL: The output MUST depict the same building from Image 1 — same massing, same facade pattern, same window arrangement, same overall geometry. Only lighting, atmosphere, materials and surroundings may differ.',
  'IMPORTANT: Do NOT invent a different building. The architectural form, footprint, proportions and structural language from Image 1 must be preserved exactly as the subject of the output.',
  'CONSTRAINT: This is image-to-image transformation, NOT text-to-image generation. The building in the output must be visually recognizable as the same structure as Image 1, viewed from the same angle.',
  'REMINDER: Image 1 is the architectural subject, not merely a style reference. Generate the same building from approximately the same camera angle, applying only the modifications described in the instructions.',
  'GEOMETRY LOCK: Treat Image 1 as the structural blueprint. Reproduce its geometry faithfully — facade, openings, roofline, materials placement; only photographic style, lighting, weather and ambient elements may change per the prompt above.',
  'STRUCTURAL FIDELITY: The output must be unmistakably the same building shown in Image 1. Do not redesign, restyle the architecture, or generate a similar-looking-but-different structure. Only the photographic treatment changes.',
];

function pickGeometryLock() {
  return BASE_IMAGE_GEOMETRY_LOCKS[Math.floor(Math.random() * BASE_IMAGE_GEOMETRY_LOCKS.length)];
}

function buildGeminiPrompt(prompt, hasBase, refCount, refAnalyses) {
  // 纯 T2I 场景（无基础图无参考图）：保持旧行为，直接 return 原 prompt
  if (!hasBase && refCount === 0) return prompt;

  const lines = [];

  // 1. 基础图角色标签（B-1 修复：之前 refCount===0 时缺失，导致 i2i 退化为 t2i）
  if (hasBase) {
    lines.push('Image 1 is the base architectural rendering to modify.');
    lines.push('MAINTAIN the exact building geometry, structure and spatial layout from Image 1.');
    lines.push('Only modify lighting, atmosphere, materials texture, vegetation and human figures as instructed below.');
  }

  // 2. 参考图角色标签 + 风格匹配指令
  if (refCount > 0) {
    const refStart = hasBase ? 2 : 1;
    const refEnd = refStart + refCount - 1;
    if (refCount === 1) {
      lines.push(`Image ${refStart} is a style reference image.`);
    } else {
      lines.push(`Images ${refStart}-${refEnd} are style reference images.`);
    }
    lines.push('');
    lines.push('You MUST match the visual characteristics of the style reference images:');
    lines.push('- Match their color palette: highlight tones, shadow tones, overall warmth/coolness');
    lines.push('- Match their lighting: direction, intensity, color temperature, and atmosphere');
    lines.push('- Match their vegetation style: tree species, canopy shape, density, and placement');
    lines.push('- Match their sky treatment and environmental mood');
    lines.push('- Match their material rendering quality and texture style');
    lines.push('');
    lines.push(hasBase
      ? 'Generate a new image based on Image 1, applying the visual style from the reference images.'
      : 'Generate a new architectural rendering applying the visual style from the reference images.');

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
  }

  // 3. 用户增强后的 prompt 主体
  lines.push('');
  lines.push('Specific instructions:');
  lines.push(prompt);

  // 4. 末尾动态强调（B-2：仅当 hasBase 时，从语义池随机 pick 一句保持新鲜度）
  if (hasBase) {
    lines.push('');
    lines.push(pickGeometryLock());
  }

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
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
      return; // success
    } catch (err) {
      console.warn(`[generate] CDN upload attempt ${attempt}/${maxRetries} failed for ${index + 1}: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
      }
    }
  }
  console.error(`[generate] CDN upload exhausted all retries for ${index + 1}`);
}

// ─── OpenAI 兼容出图（外部用户路径）───

function extractImageFromChatResponse(message) {
  if (!message) return null;
  const content = message.content;

  // 格式 A: content 是数组，含 image part
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        const url = part.image_url.url;
        const m = url.match(/^data:([^;]+);base64,(.+)$/);
        if (m) return { base64: m[2], mime: m[1] };
      }
      if (part.type === 'image' && part.image?.data) {
        return { base64: part.image.data, mime: part.image.mimeType || 'image/png' };
      }
      // inline_data 格式
      if (part.inline_data?.data) {
        return { base64: part.inline_data.data, mime: part.inline_data.mime_type || 'image/png' };
      }
    }
  }

  // 格式 B: content 是字符串，含 markdown 嵌入的 base64
  if (typeof content === 'string') {
    const m = content.match(/data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)/);
    if (m) return { base64: m[2], mime: m[1] };
  }

  return null;
}

async function generateOneImageOpenAI({ index, total, client, model, prompt, baseImageUrl, referenceUrls, res }) {
  const label = `${index + 1}/${total}`;
  sendSSE(res, { type: 'progress', message: `Generating ${label}...`, index });

  const content = [];
  if (baseImageUrl) {
    content.push({ type: 'image_url', image_url: { url: baseImageUrl } });
  }
  if (referenceUrls?.length) {
    for (const ref of referenceUrls) {
      content.push({ type: 'image_url', image_url: { url: ref } });
    }
  }
  content.push({ type: 'text', text: prompt });

  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
  });

  const imageData = extractImageFromChatResponse(resp.choices?.[0]?.message);
  if (!imageData) throw new Error('模型未返回图片，请确认该模型支持图像生成');

  const tempUrl = `data:${imageData.mime};base64,${imageData.base64}`;
  sendSSE(res, { type: 'image', url: tempUrl, index });
  console.log(`[generate:openai] ${label} generated (${imageData.mime}, ${Math.round(imageData.base64.length / 1024)}KB)`);

  return { index, imageResult: { type: 'base64', value: imageData.base64, mime: imageData.mime } };
}

async function handleOpenAIGeneration(req, res) {
  const { prompt, baseImageUrl, referenceUrls, refAnalyses, count } = req.body;
  const { apiKey, baseUrl, generateModel } = req.userKeys;

  const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 120000 });
  const imageCount = Math.min(Math.max(parseInt(count, 10) || 2, 1), 4);

  const structuredPrompt = buildGeminiPrompt(
    prompt,
    !!baseImageUrl,
    (referenceUrls || []).length,
    refAnalyses || []
  );

  sendSSE(res, { type: 'info', model: generateModel, count: imageCount });
  console.log(`[generate:openai] model=${generateModel} count=${imageCount} refs=${(referenceUrls||[]).length}`);

  const genTasks = [];
  for (let i = 0; i < imageCount; i++) {
    genTasks.push(
      generateOneImageOpenAI({
        index: i, total: imageCount, client, model: generateModel,
        prompt: structuredPrompt, baseImageUrl, referenceUrls: referenceUrls || [], res,
      }).catch(err => {
        console.error(`[generate:openai] ${i + 1}/${imageCount} error:`, err.message);
        sendSSE(res, { type: 'error', message: err.message, index: i });
        return null;
      })
    );
  }
  const genResults = (await Promise.all(genTasks)).filter(Boolean);

  // CDN 上传（平台 Token）
  const cdnToken = process.env.TENSORART_BEARER_TOKEN;
  if (genResults.length > 0 && cdnToken) {
    sendSSE(res, { type: 'progress', message: 'Uploading to CDN...', index: -1 });
    await Promise.allSettled(
      genResults.map(r => uploadOneToCDN({ ...r, cdnToken, res }))
    );
  }
}

// ─── 管理员 TAMS 路径 ───

async function handleTAMSGeneration(req, res) {
  const { prompt, model: modelKey, baseImageUrl, referenceUrls, refAnalyses, aspectRatio, imageSize, count } = req.body;

  const tamsToken = process.env.TAMS_TOKEN || process.env.TAMS_API_TOKEN;
  if (!tamsToken) {
    sendSSE(res, { type: 'error', message: 'TAMS_TOKEN 未配置' });
    return;
  }

  const modelInfo = MODEL_MAP[modelKey || 'nano-banana-pro'];
  if (!modelInfo) {
    sendSSE(res, { type: 'error', message: `未知模型: ${modelKey}` });
    return;
  }

  const imageCount = Math.min(Math.max(parseInt(count, 10) || 2, 1), 4);
  const ratio = aspectRatio || '4:3';
  const size = imageSize || '2K';

  sendSSE(res, { type: 'info', model: modelInfo.name, count: imageCount });
  const structuredPrompt = buildGeminiPrompt(
    prompt,
    !!baseImageUrl,
    (referenceUrls || []).length,
    refAnalyses || []
  );
  console.log(`[generate:tams] model=${modelInfo.name} count=${imageCount} ratio=${ratio} size=${size} refs=${(referenceUrls||[]).length}`);

  const cdnToken = process.env.TENSORART_BEARER_TOKEN;
  const shared = { tamsToken, modelInfo, prompt: structuredPrompt, baseImageUrl, referenceUrls: referenceUrls || [], ratio, size, res, total: imageCount };

  const genTasks = [];
  for (let i = 0; i < imageCount; i++) {
    genTasks.push(
      generateOneImage({ ...shared, index: i }).catch(err => {
        console.error(`[generate:tams] ${i + 1}/${imageCount} error:`, err.message);
        sendSSE(res, { type: 'error', message: err.message, index: i });
        return null;
      })
    );
  }
  const genResults = (await Promise.all(genTasks)).filter(Boolean);

  if (genResults.length > 0 && cdnToken) {
    sendSSE(res, { type: 'progress', message: 'Uploading to CDN...', index: -1 });
    await Promise.allSettled(
      genResults.map(r => uploadOneToCDN({ ...r, cdnToken, res }))
    );
  }
}

// ─── Handler ───

module.exports = withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: '缺少 prompt' });

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (isAdmin(req.user)) {
      await handleTAMSGeneration(req, res);
    } else {
      await handleOpenAIGeneration(req, res);
    }
  } catch (err) {
    console.error('[generate] unexpected error:', err.message);
    sendSSE(res, { type: 'error', message: err.message });
  }

  sendSSE(res, { type: 'done' });
  res.end();
});
