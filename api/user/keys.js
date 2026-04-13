const { withAuth } = require('../../lib/auth');
const { getUserKeys, setUserKeys } = require('../../lib/user-keys');

module.exports = withAuth(async function handler(req, res) {
  const userId = req.user.id;

  if (req.method === 'GET') {
    const keys = await getUserKeys(userId);
    if (!keys) return res.json({ configured: false });

    return res.json({
      configured: true,
      provider: keys.provider,
      baseUrl: keys.baseUrl,
      enhanceModel: keys.enhanceModel,
      generateModel: keys.generateModel,
      apiKeyHint: keys.apiKey ? `${keys.apiKey.slice(0, 6)}...${keys.apiKey.slice(-4)}` : null,
    });
  }

  if (req.method === 'PUT') {
    const { apiKey, baseUrl, enhanceModel, generateModel, provider } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: '请提供 API Key' });
    }

    let normalizedUrl = (baseUrl || '').trim().replace(/\/+$/, '');
    if (normalizedUrl && !normalizedUrl.endsWith('/v1') && !normalizedUrl.endsWith('/v1beta')) {
      normalizedUrl += '/v1';
    }

    await setUserKeys(userId, {
      apiKey,
      baseUrl: normalizedUrl || null,
      enhanceModel: enhanceModel || null,
      generateModel: generateModel || null,
      provider: provider || 'custom',
    });

    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
