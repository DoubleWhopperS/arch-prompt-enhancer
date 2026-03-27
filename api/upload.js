/**
 * 图片上传端点：接收单张 base64 图片，上传到 TensorArt CDN，返回 URL
 * 每次只传一张，避免触发 Vercel 4.5MB body 限制
 */

const API_BASE = 'https://api.tensorart.tech';
const PRESIGN_ENDPOINT = `${API_BASE}/om-web/v1/cloudflare/presign`;
const BUCKET = 'tensor-public';

function getObjectPath(filename) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `operation/images/${month}/${filename}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, name } = req.body;
  if (!image) {
    return res.status(400).json({ error: '缺少 image 字段' });
  }

  const token = process.env.TENSORART_BEARER_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TENSORART_BEARER_TOKEN 未配置' });
  }

  // 解析 base64
  const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: '无效的图片数据格式，需要 data:image/xxx;base64,...' });
  }

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `${name || 'img'}_${Date.now()}.${ext}`;
  const objectPath = getObjectPath(filename);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://om.tensorart.tech',
    'Referer': 'https://om.tensorart.tech/',
  };

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

    if (!presignResp.ok) {
      const text = await presignResp.text().catch(() => '');
      return res.status(502).json({ error: `Presign 失败: HTTP ${presignResp.status}`, detail: text });
    }

    const presignData = await presignResp.json();
    if (presignData.code !== '0') {
      return res.status(502).json({ error: `Presign API 错误: ${presignData.message || '未知'}` });
    }

    const { uploadUrl, dbUrl } = presignData.data || {};
    if (!uploadUrl) {
      return res.status(502).json({ error: 'Presign 响应缺少 uploadUrl' });
    }

    // Step 2: PUT 上传到 CDN
    const uploadResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
      signal: AbortSignal.timeout(60000),
    });

    if (!uploadResp.ok) {
      return res.status(502).json({ error: `CDN 上传失败: HTTP ${uploadResp.status}` });
    }

    const finalUrl = dbUrl || `https://cdn.tensorart.tech/${objectPath}`;
    return res.json({ success: true, url: finalUrl });

  } catch (err) {
    return res.status(500).json({ error: `上传异常: ${err.message}` });
  }
};
