require('dotenv').config();
const express = require('express');
const path = require('path');
const { enhancePromptStream } = require('./lib/enhancer');

const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON body（50MB 限制）
app.use(express.json({ limit: '50mb' }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// SSE 流式增强接口
app.post('/api/enhance', async (req, res) => {
  const { intent, params, baseImage, references } = req.body;

  if (!intent && !baseImage) {
    return res.status(400).json({ error: '请至少提供设计意图或基础图' });
  }

  const imgCount = (baseImage ? 1 : 0) + (references?.length || 0);
  const payloadKB = (JSON.stringify(req.body).length / 1024).toFixed(0);
  console.log(`[enhance] intent="${(intent || '').slice(0, 50)}..." images=${imgCount} payload=${payloadKB}KB`);
  const startTime = Date.now();

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = enhancePromptStream({ intent, params, baseImage, references });
    let firstChunk = true;
    for await (const chunk of stream) {
      if (firstChunk) {
        console.log(`[enhance] first token in ${Date.now() - startTime}ms`);
        firstChunk = false;
      }
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }
    console.log(`[enhance] done in ${Date.now() - startTime}ms`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    console.error(`[enhance] error after ${Date.now() - startTime}ms:`, err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n  建筑 Prompt 增强器已启动`);
  console.log(`  http://localhost:${PORT}\n`);
});
