const OpenAI = require('openai');

module.exports = async function handler(req, res) {
  const apiKey = process.env.TUZI_API_KEY;
  const baseURL = process.env.TUZI_BASE_URL || 'https://llm.ai-nebula.com/v1';
  const model = process.env.MODEL || 'claude-opus-4-6';

  const result = {
    env: {
      TUZI_API_KEY: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'NOT SET',
      TUZI_BASE_URL: baseURL,
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
};
