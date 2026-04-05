/**
 * TensorArt CDN 上传共享模块
 * Presign + PUT 上传到 Cloudflare R2
 */

const API_BASE = 'https://api.tensorart.tech';
const PRESIGN_ENDPOINT = `${API_BASE}/om-web/v1/cloudflare/presign`;
const BUCKET = 'tensor-public';

function getObjectPath(filename) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `operation/images/${month}/${filename}`;
}

function getCDNHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://om.tensorart.tech',
    'Referer': 'https://om.tensorart.tech/',
  };
}

/**
 * 上传 Buffer 到 TensorArt CDN
 * @param {Buffer} buffer - 图片数据
 * @param {string} ext - 文件扩展名 (jpg/png/webp)
 * @param {string} [token] - Bearer token，默认从环境变量读取
 * @returns {Promise<string>} CDN URL
 */
async function uploadBufferToCDN(buffer, ext, token) {
  token = token || process.env.TENSORART_BEARER_TOKEN;
  if (!token) throw new Error('TENSORART_BEARER_TOKEN 未配置');

  const filename = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const objectPath = getObjectPath(filename);
  const headers = getCDNHeaders(token);

  // Step 1: Presign
  const presignResp = await fetch(PRESIGN_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ bucket: BUCKET, objectPath, size: String(buffer.length) }),
    signal: AbortSignal.timeout(15000),
  });

  if (!presignResp.ok) {
    const text = await presignResp.text().catch(() => '');
    throw new Error(`Presign 失败: HTTP ${presignResp.status} ${text.slice(0, 100)}`);
  }

  const presignData = await presignResp.json();
  if (presignData.code !== '0') {
    throw new Error(`Presign API 错误: ${presignData.message || '未知'}`);
  }

  const { uploadUrl, dbUrl } = presignData.data || {};
  if (!uploadUrl) throw new Error('Presign 响应缺少 uploadUrl');

  // Step 2: PUT 上传
  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
    signal: AbortSignal.timeout(120000),
  });

  if (!uploadResp.ok) {
    throw new Error(`CDN 上传失败: HTTP ${uploadResp.status}`);
  }

  return dbUrl || `https://cdn.tensorart.tech/${objectPath}`;
}

/**
 * 上传 base64 图片到 CDN
 */
async function uploadBase64ToCDN(base64Data, mimeType, token) {
  const ext = mimeType?.includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(base64Data, 'base64');
  return uploadBufferToCDN(buffer, ext, token);
}

/**
 * 从 URL 下载图片并上传到 CDN
 */
async function downloadAndUploadToCDN(imageUrl, token) {
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`下载图片失败: HTTP ${resp.status}`);

  const contentType = resp.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
  const buffer = Buffer.from(await resp.arrayBuffer());

  return uploadBufferToCDN(buffer, ext, token);
}

module.exports = {
  uploadBufferToCDN,
  uploadBase64ToCDN,
  downloadAndUploadToCDN,
  getObjectPath,
  getCDNHeaders,
  PRESIGN_ENDPOINT,
  BUCKET,
};
