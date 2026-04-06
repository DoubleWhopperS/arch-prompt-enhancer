/**
 * 图片上传模块 v2.0
 *
 * 双通道上传策略（对齐 tams_core/uploader.py v2.0）：
 *
 * 1. 主通道: TAMS 网关 OSS 直传 (cn.tensorart.net → 阿里云 OSS 上海)
 *    - 返回 resource_id，可用于 TAMS 视频/图片 API
 *    - 国内外均可直连，无 GFW 问题
 *    - 使用 TAMS_TOKEN
 *
 * 2. 备用通道: Cloudflare R2 presign (api.tensorart.tech)
 *    - 返回公网 CDN URL (cdn.tensorart.tech)
 *    - 海外稳定，国内需 VPN
 *    - 使用 TENSORART_BEARER_TOKEN
 *
 * 本项目部署在 Vercel（海外），两个通道均可正常访问。
 * 默认策略：TAMS OSS 优先 → R2 presign 降级。
 */

// ============ TAMS 网关 OSS 配置（主通道）============
const TAMS_BASE_URL = 'https://cn.tensorart.net';
const TAMS_RESOURCE_ENDPOINT = '/v1/resource/image';

// ============ Cloudflare R2 配置（备用通道）============
const R2_API_BASE = 'https://api.tensorart.tech';
const R2_PRESIGN_ENDPOINT = `${R2_API_BASE}/om-web/v1/cloudflare/presign`;
const R2_BUCKET = 'tensor-public';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getObjectPath(filename) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `operation/images/${month}/${filename}`;
}

function generateFilename(ext) {
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
}

// ============ 主通道: TAMS 网关 OSS ============

/**
 * 通过 TAMS 网关上传到 OSS
 * @param {Buffer} buffer
 * @param {string} token - TAMS_TOKEN
 * @returns {Promise<{resourceId: string}>}
 */
async function tamsOssUpload(buffer, token) {
  const createUrl = `${TAMS_BASE_URL}${TAMS_RESOURCE_ENDPOINT}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Step 1: 创建上传槽位
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      });

      if (createResp.status === 401) {
        throw new Error('TAMS Token 无效或已过期');
      }
      if (!createResp.ok) {
        const text = await createResp.text().catch(() => '');
        throw new Error(`TAMS create 失败: HTTP ${createResp.status} ${text.slice(0, 100)}`);
      }

      const data = await createResp.json();
      const resourceId = data.resource_id || data.resourceId;
      const putUrl = data.put_url || data.putUrl;
      const extraHeaders = data.headers || {};

      if (!resourceId || !putUrl) {
        throw new Error(`TAMS 响应缺少必要字段: ${JSON.stringify(data).slice(0, 200)}`);
      }

      // Step 2: PUT 上传到 OSS（必须带 X-Oss-Callback 等 headers）
      const putHeaders = {
        ...extraHeaders,
        'Content-Length': String(buffer.length),
      };
      if (!putHeaders['Content-Type']) {
        putHeaders['Content-Type'] = 'application/octet-stream';
      }

      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers: putHeaders,
        body: buffer,
        signal: AbortSignal.timeout(60000),
      });

      if (!putResp.ok) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`OSS 上传失败: HTTP ${putResp.status}`);
      }

      return { resourceId };

    } catch (err) {
      if (err.message.includes('Token 无效')) throw err;
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[cdn] TAMS OSS attempt ${attempt + 1} failed: ${err.message}, retrying...`);
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

// ============ 备用通道: Cloudflare R2 presign ============

/**
 * 通过 R2 presign 上传，返回公网 CDN URL
 * @param {Buffer} buffer
 * @param {string} ext
 * @param {string} token - TENSORART_BEARER_TOKEN
 * @returns {Promise<string>} CDN URL
 */
async function r2PresignUpload(buffer, ext, token) {
  const filename = generateFilename(ext);
  const objectPath = getObjectPath(filename);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://om.tensorart.tech',
    'Referer': 'https://om.tensorart.tech/',
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Step 1: Presign
      const presignResp = await fetch(R2_PRESIGN_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ bucket: R2_BUCKET, objectPath, size: String(buffer.length) }),
        signal: AbortSignal.timeout(15000),
      });

      if (presignResp.status === 401) {
        throw new Error('R2 Token 无效或已过期');
      }
      if (!presignResp.ok) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`R2 Presign 失败: HTTP ${presignResp.status}`);
      }

      const presignData = await presignResp.json();
      if (presignData.code !== '0') {
        throw new Error(`R2 API 错误: ${presignData.message || '未知'}`);
      }

      const { uploadUrl, dbUrl } = presignData.data || {};
      if (!uploadUrl) throw new Error('R2 响应缺少 uploadUrl');

      // Step 2: PUT 上传
      const uploadResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
        signal: AbortSignal.timeout(60000),
      });

      if (!uploadResp.ok) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`R2 上传失败: HTTP ${uploadResp.status}`);
      }

      return dbUrl || `https://cdn.tensorart.tech/${objectPath}`;

    } catch (err) {
      if (err.message.includes('Token 无效')) throw err;
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[cdn] R2 attempt ${attempt + 1} failed: ${err.message}, retrying...`);
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

// ============ 公开 API ============

/**
 * 上传 Buffer 到 CDN，返回公网 URL
 *
 * 策略：TAMS OSS（主）→ R2 presign（降级）
 * TAMS OSS 返回 resource_id 后，构造 TAMS 可解析的 URL。
 * R2 presign 返回直接可访问的 CDN URL。
 *
 * @param {Buffer} buffer - 图片数据
 * @param {string} ext - 文件扩展名 (jpg/png/webp)
 * @returns {Promise<string>} 公网可访问的 URL
 */
async function uploadBufferToCDN(buffer, ext) {
  // 通道 1: TAMS OSS
  const tamsToken = process.env.TAMS_TOKEN || process.env.TAMS_API_TOKEN;
  if (tamsToken) {
    try {
      const { resourceId } = await tamsOssUpload(buffer, tamsToken);
      // TAMS resource_id 可被 TAMS 网关解析为图片 URL
      // 构造公网可访问的代理 URL
      return `${TAMS_BASE_URL}${TAMS_RESOURCE_ENDPOINT}/${resourceId}`;
    } catch (err) {
      console.warn(`[cdn] TAMS OSS 上传失败，降级到 R2: ${err.message}`);
    }
  }

  // 通道 2: R2 presign（降级）
  const r2Token = process.env.TENSORART_BEARER_TOKEN;
  if (r2Token) {
    return r2PresignUpload(buffer, ext, r2Token);
  }

  throw new Error('图片上传不可用：TAMS_TOKEN 和 TENSORART_BEARER_TOKEN 均未配置');
}

/**
 * 上传 base64 图片到 CDN
 */
async function uploadBase64ToCDN(base64Data, mimeType) {
  const ext = mimeType?.includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(base64Data, 'base64');
  return uploadBufferToCDN(buffer, ext);
}

/**
 * 从 URL 下载图片并上传到 CDN
 */
async function downloadAndUploadToCDN(imageUrl) {
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`下载图片失败: HTTP ${resp.status}`);

  const contentType = resp.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
  const buffer = Buffer.from(await resp.arrayBuffer());

  return uploadBufferToCDN(buffer, ext);
}

module.exports = {
  uploadBufferToCDN,
  uploadBase64ToCDN,
  downloadAndUploadToCDN,
};
