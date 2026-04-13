-- ============================================
-- arch-prompt-enhancer Supabase 初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================

-- 1. 创建用户 API Key 存储表
CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key    TEXT,           -- AES-256-GCM 加密后的密文
  base_url   TEXT,           -- OpenAI 兼容 endpoint
  enhance_model   TEXT,      -- Prompt 增强模型
  generate_model  TEXT,      -- 图片生成模型
  provider   TEXT DEFAULT 'custom',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 启用 RLS
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略：用户只能访问自己的记录
-- 注意：后端使用 SERVICE_KEY 绕过 RLS，这些策略是额外的安全层
CREATE POLICY "Users can read own keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own keys"
  ON user_api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own keys"
  ON user_api_keys FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own keys"
  ON user_api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- 4. 设置管理员角色
-- ⚠️ 将下方邮箱替换为你的注册邮箱后执行
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
-- WHERE email = 'your-email@example.com';
