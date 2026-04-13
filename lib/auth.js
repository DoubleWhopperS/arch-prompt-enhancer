const { getSupabase } = require('./supabase');
const { getUserKeys } = require('./user-keys');

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;

  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

function isAdmin(user) {
  return user?.app_metadata?.role === 'admin';
}

function withAuth(handler) {
  return async (req, res) => {
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: '请先登录' });
    }

    req.user = user;

    if (isAdmin(user)) {
      req.userKeys = {
        apiKey: process.env.ECHOTECH_API_KEY,
        baseUrl: process.env.ECHOTECH_BASE_URL || 'https://llm.echo.tech/v1',
        enhanceModel: process.env.ENHANCE_MODEL || 'claude-sonnet-4-6',
        generateModel: process.env.GENERATE_MODEL || 'gemini-2.0-flash-exp',
        _isAdmin: true,
      };
    } else {
      const keys = await getUserKeys(user.id);
      if (!keys || !keys.apiKey) {
        return res.status(403).json({ error: '请先在设置中配置 API Key', code: 'NO_API_KEY' });
      }
      req.userKeys = keys;
    }

    return handler(req, res);
  };
}

module.exports = { getSupabase, verifyAuth, isAdmin, withAuth };
