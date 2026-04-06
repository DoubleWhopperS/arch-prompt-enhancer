/**
 * 参考图素材库 — Vercel Blob 存储层
 * 使用 REST API 直接操作（避免 @vercel/blob SDK 在 serverless 中 bundling 问题）
 */

const BLOB_API = 'https://blob.vercel-storage.com';
const BLOB_PATH = 'ref-library/metadata.json';

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN 未配置');
  return token;
}

/**
 * 读取素材库元数据
 * @returns {Promise<Array>}
 */
async function getRefLibrary() {
  try {
    const token = getToken();
    // List blobs matching the path
    const listResp = await fetch(`${BLOB_API}?prefix=${encodeURIComponent(BLOB_PATH)}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResp.ok) return [];

    const { blobs } = await listResp.json();
    if (!blobs || blobs.length === 0) return [];

    // Fetch the actual blob content（private store 需要 token）
    const blobUrl = blobs[0].downloadUrl || blobs[0].url;
    const dataResp = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dataResp.ok) return [];
    return await dataResp.json();
  } catch (err) {
    console.error('[ref-store] read error:', err.message);
    return [];
  }
}

/**
 * 写入素材库元数据（整体替换）
 * @param {Array} items
 */
async function setRefLibrary(items) {
  const token = getToken();
  const resp = await fetch(`${BLOB_API}/${BLOB_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-version': '7',
      'x-add-random-suffix': 'false',
    },
    body: JSON.stringify(items),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Blob write failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

/**
 * 添加素材（prepend 到头部）
 * @param {Array} newItems
 * @returns {Promise<Array>} 添加的 items
 */
async function addRefImages(newItems) {
  const items = await getRefLibrary();
  items.unshift(...newItems);
  await setRefLibrary(items);
  return newItems;
}

/**
 * 批量更新素材标签/描述
 * @param {Array<{id, tags?, description?}>} updates
 * @returns {Promise<number>} 更新数量
 */
async function updateRefImages(updates) {
  const items = await getRefLibrary();
  let count = 0;
  for (const upd of updates) {
    const item = items.find(i => i.id === upd.id);
    if (!item) continue;
    if (upd.tags !== undefined) item.tags = upd.tags;
    if (upd.description !== undefined) item.description = upd.description;
    count++;
  }
  if (count > 0) await setRefLibrary(items);
  return count;
}

/**
 * 批量删除素材（仅删元数据，不删 CDN 文件）
 * @param {string[]} ids
 * @returns {Promise<number>} 删除数量
 */
async function deleteRefImages(ids) {
  const idSet = new Set(ids);
  const items = await getRefLibrary();
  const before = items.length;
  const after = items.filter(i => !idSet.has(i.id));
  if (after.length < before) await setRefLibrary(after);
  return before - after.length;
}

module.exports = {
  getRefLibrary,
  setRefLibrary,
  addRefImages,
  updateRefImages,
  deleteRefImages,
};
