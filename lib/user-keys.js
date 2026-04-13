const { getSupabase } = require('./supabase');
const { decrypt, encrypt } = require('./crypto');

const cache = new Map();
const CACHE_TTL = 60_000;

async function getUserKeys(userId) {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('api_key, base_url, enhance_model, generate_model, provider')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    cache.set(userId, { data: null, ts: Date.now() });
    return null;
  }

  const keys = {
    apiKey: data.api_key ? decrypt(data.api_key) : null,
    baseUrl: data.base_url || 'https://llm.echo.tech/v1',
    enhanceModel: data.enhance_model || 'claude-sonnet-4-6',
    generateModel: data.generate_model || 'gemini-2.0-flash-exp',
    provider: data.provider || 'custom',
  };

  cache.set(userId, { data: keys, ts: Date.now() });
  return keys;
}

async function setUserKeys(userId, { apiKey, baseUrl, enhanceModel, generateModel, provider }) {
  const supabase = getSupabase();
  const row = {
    user_id: userId,
    api_key: apiKey ? encrypt(apiKey) : null,
    base_url: baseUrl || null,
    enhance_model: enhanceModel || null,
    generate_model: generateModel || null,
    provider: provider || 'custom',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_api_keys')
    .upsert(row, { onConflict: 'user_id' });

  if (error) throw new Error(`保存 API Key 失败: ${error.message}`);

  cache.delete(userId);
}

module.exports = { getUserKeys, setUserKeys };
