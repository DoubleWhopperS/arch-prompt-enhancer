const OpenAI = require('openai');
const { withAuth, isAdmin } = require('../lib/auth');

module.exports = withAuth(async function handler(req, res) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: '仅管理员可访问' });
  }

  const apiKey = process.env.ECHOTECH_API_KEY;
  const baseURL = process.env.ECHOTECH_BASE_URL || 'https://llm.echo.tech/v1';
  const model = process.env.ENHANCE_MODEL || 'claude-sonnet-4-6';

  const result = {
    env: {
      ECHOTECH_API_KEY: apiKey ? 'configured' : 'NOT SET',
      ECHOTECH_BASE_URL: baseURL,
      MODEL: model,
    },
    test: null,
  };

  if (!apiKey) {
    result.test = { error: 'API Key 未配置' };
    return res.json(result);
  }

  try {
    const client = new OpenAI({ apiKey, baseURL, timeout: 20000 });
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    });
    result.test = {
      ok: true,
      response: resp.choices?.[0]?.message?.content,
      model_used: resp.model,
    };
  } catch (err) {
    result.test = {
      ok: false,
      error: err.message,
      status: err.status || 'N/A',
      code: err.code || 'N/A',
    };
  }

  res.json(result);
});
