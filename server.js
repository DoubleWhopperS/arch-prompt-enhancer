require('dotenv').config();
const express = require('express');
const path = require('path');
const { enhancePromptStream } = require('./lib/enhancer');
const uploadHandler = require('./api/upload');
const generateHandler = require('./api/generate');
const analyzeRefHandler = require('./api/analyze-ref');
const refLibraryHandler = require('./api/ref-library');
const galleryHandler = require('./api/gallery');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE: Prompt 增强 ───
app.post('/api/enhance', async (req, res) => {
  const { intent, params, baseImage, baseImageUrl, references } = req.body;

  if (!intent && !baseImage && !baseImageUrl) {
    return res.status(400).json({ error: '请至少提供设计意图或基础图' });
  }

  const imgCount = (baseImage || baseImageUrl ? 1 : 0) + (references?.length || 0);
  console.log(`[enhance] intent="${(intent || '').slice(0, 50)}..." images=${imgCount}`);
  const startTime = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = enhancePromptStream({ intent, params, baseImage, baseImageUrl, references });
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }
    console.log(`[enhance] done in ${Date.now() - startTime}ms`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    console.error(`[enhance] error:`, err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── CDN 图片上传 ───
app.post('/api/upload', uploadHandler);

// ─── SSE: 参考图分析 ───
app.post('/api/analyze-ref', analyzeRefHandler);

// ─── 参考图素材库 ───
app.all('/api/ref-library', refLibraryHandler);

// ─── 图库（云端同步）───
app.all('/api/gallery', galleryHandler);

// ─── SSE: 图片生成 ───
app.post('/api/generate', generateHandler);

app.listen(PORT, () => {
  console.log(`\n  建筑效果图工作台已启动`);
  console.log(`  http://localhost:${PORT}\n`);

  // 环境检查
  const checks = [
    ['ECHOTECH_API_KEY', !!process.env.ECHOTECH_API_KEY, 'Prompt 增强'],
    ['TAMS_TOKEN', !!(process.env.TAMS_TOKEN || process.env.TAMS_API_TOKEN), '图片生成'],
    ['TENSORART_BEARER_TOKEN', !!process.env.TENSORART_BEARER_TOKEN, 'CDN 上传'],
    ['BLOB_READ_WRITE_TOKEN', !!process.env.BLOB_READ_WRITE_TOKEN, '素材库'],
  ];
  for (const [key, ok, feature] of checks) {
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${key} ${ok ? '' : `(未设置 — ${feature}不可用)`}`);
  }
  console.log('');
});
