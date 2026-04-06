/**
 * TensorArt 图床上传模块
 * 流程：presign → PUT 上传 → 返回 CDN URL
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.tensorart.tech';
const PRESIGN_ENDPOINT = `${API_BASE}/om-web/v1/cloudflare/presign`;
const BUCKET = 'tensor-public';
const TOKEN_PATH = path.join(process.env.HOME, '.config', 'tensorart', 'token.json');

function loadToken() {
  // 优先环境变量
  if (process.env.TENSORART_BEARER_TOKEN) {
    return process.env.TENSORART_BEARER_TOKEN;
  }
  try {
    const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    return config.bearer_token || null;
  } catch {
    return null;
  }
}

function getObjectPath(filename) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `operation/images/${month}/${filename}`;
}

/**
 * 上传 base64 图片到 TensorArt 图床
 * @param {string} base64Data - data:image/xxx;base64,... 格式
 * @param {string} filename - 文件名
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadImage(base64Data, filename) {
  const token = loadToken();
  if (!token) {
    return { success: false, error: 'TensorArt Token 未配置，请检查 ~/.config/tensorart/token.json' };
  }

  // 解析 base64
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    return { success: false, error: '无效的图片数据格式' };
  }

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const objectPath = getObjectPath(`${filename}.${ext}`);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://om.tensorart.tech',
    'Referer': 'https://om.tensorart.tech/',
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Step 1: Presign
      const presignResp = await fetch(PRESIGN_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bucket: BUCKET,
          objectPath,
          size: String(buffer.length),
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (presignResp.status === 401) {
        return { success: false, error: 'TensorArt Token 无效或已过期，请更新 ~/.config/tensorart/token.json' };
      }

      if (!presignResp.ok) {
        if (attempt < 2) continue;
        return { success: false, error: `Presign 失败: HTTP ${presignResp.status}` };
      }

      const presignData = await presignResp.json();
      if (presignData.code !== '0') {
        return { success: false, error: `API 错误: ${presignData.message || '未知'}` };
      }

      const { uploadUrl, dbUrl } = presignData.data || {};
      if (!uploadUrl) {
        return { success: false, error: 'Presign 响应缺少 uploadUrl' };
      }

      // Step 2: PUT 上传
      const uploadResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
        signal: AbortSignal.timeout(60000),
      });

      if (!uploadResp.ok) {
        if (attempt < 2) continue;
        return { success: false, error: `上传失败: HTTP ${uploadResp.status}` };
      }

      const finalUrl = dbUrl || `https://cdn.tensorart.tech/${objectPath}`;
      return { success: true, url: finalUrl };

    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        if (attempt < 2) continue;
        return { success: false, error: '上传超时' };
      }
      if (attempt < 2) continue;
      return { success: false, error: `网络错误: ${err.message}` };
    }
  }

  return { success: false, error: '重试次数已用完' };
}

/**
 * 批量上传图片
 * @param {Array<{data: string, name: string}>} images
 * @returns {Promise<Array<{success: boolean, name: string, url?: string, error?: string}>>}
 */
async function uploadImages(images) {
  const results = await Promise.all(
    images.map(async (img, i) => {
      const result = await uploadImage(img.data, img.name || `img_${i}_${Date.now()}`);
      return { ...result, name: img.name || `img_${i}` };
    })
  );
  return results;
}

module.exports = { uploadImage, uploadImages };
