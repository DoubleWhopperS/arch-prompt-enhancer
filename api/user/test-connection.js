const OpenAI = require('openai');
const { withAuth } = require('../../lib/auth');

module.exports = withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, baseUrl, enhanceModel, generateModel } = req.body;
  const key = apiKey || req.userKeys?.apiKey;
  const url = baseUrl || req.userKeys?.baseUrl;
  const eModel = enhanceModel || req.userKeys?.enhanceModel || 'claude-sonnet-4-6';
  const gModel = generateModel || req.userKeys?.generateModel || 'gemini-2.0-flash-exp';

  if (!key || !url) {
    return res.status(400).json({ error: '请提供 API Key 和 Base URL' });
  }

  const client = new OpenAI({ apiKey: key, baseURL: url, timeout: 20000 });
  const results = { text: null, image: null };

  // 1. 文本能力测试
  try {
    const resp = await client.chat.completions.create({
      model: eModel,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    });
    results.text = { ok: true, model: resp.model };
  } catch (err) {
    results.text = { ok: false, error: err.message, status: err.status };
  }

  // 2. 图像生成能力测试（用最小 prompt 测试模型是否可用）
  try {
    const resp = await client.chat.completions.create({
      model: gModel,
      messages: [{ role: 'user', content: 'Generate a tiny 64x64 white square on black background.' }],
      max_tokens: 1024,
    });
    const message = resp.choices?.[0]?.message;
    const hasImage = detectImageInResponse(message);
    results.image = { ok: hasImage, model: resp.model };
    if (!hasImage) {
      results.image.warning = '模型响应中未检测到图片，可能不支持图像生成';
    }
  } catch (err) {
    results.image = { ok: false, error: err.message, status: err.status };
  }

  return res.json(results);
});

function detectImageInResponse(message) {
  if (!message) return false;
  const content = message.content;

  // 格式 A: content 是数组，含 image 类型
  if (Array.isArray(content)) {
    return content.some(p =>
      p.type === 'image' ||
      p.type === 'image_url' ||
      (p.type === 'text' && p.text?.includes('data:image/'))
    );
  }

  // 格式 B: content 是字符串，含 base64 图片
  if (typeof content === 'string') {
    return content.includes('data:image/') || /!\[.*?\]\(data:image\//.test(content);
  }

  return false;
}
