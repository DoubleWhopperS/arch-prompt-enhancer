/**
 * 参考图素材库 — Vercel Blob 存储层
 * 元数据以单个 JSON 文件存储在 Vercel Blob
 */

const { put, list } = require('@vercel/blob');

const BLOB_PATH = 'ref-library/metadata.json';

/**
 * 读取素材库元数据
 * @returns {Promise<Array>}
 */
async function getRefLibrary() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
    if (blobs.length === 0) return [];

    const resp = await fetch(blobs[0].url);
    if (!resp.ok) return [];
    return await resp.json();
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
  await put(BLOB_PATH, JSON.stringify(items), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
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
