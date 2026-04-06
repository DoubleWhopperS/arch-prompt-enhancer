/**
 * 图库 — Vercel Blob 存储层
 * 复用 ref-store.js 同样的 REST API 模式
 * Blob 路径: gallery/metadata.json
 */

const BLOB_API = 'https://blob.vercel-storage.com';
const BLOB_PATH = 'gallery/metadata.json';

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN 未配置');
  return token;
}

async function getGallery() {
  try {
    const token = getToken();
    const listResp = await fetch(`${BLOB_API}?prefix=${encodeURIComponent(BLOB_PATH)}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResp.ok) return [];

    const { blobs } = await listResp.json();
    if (!blobs || blobs.length === 0) return [];

    const blobUrl = blobs[0].downloadUrl || blobs[0].url;
    const dataResp = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dataResp.ok) return [];
    return await dataResp.json();
  } catch (err) {
    console.error('[gallery-store] read error:', err.message);
    return [];
  }
}

async function setGallery(items) {
  const token = getToken();
  const resp = await fetch(`${BLOB_API}/${BLOB_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': 'false',
      'x-allow-overwrite': '1',
      'x-vercel-blob-access': 'private',
    },
    body: JSON.stringify(items),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Blob write failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

async function addGalleryItems(newItems) {
  const items = await getGallery();
  items.unshift(...newItems);
  await setGallery(items);
  return newItems;
}

async function updateGalleryItem(id, updates) {
  const items = await getGallery();
  const item = items.find(i => i.id === id);
  if (!item) return false;
  Object.assign(item, updates);
  await setGallery(items);
  return true;
}

async function deleteGalleryItems(ids) {
  const idSet = new Set(ids);
  const items = await getGallery();
  const before = items.length;
  const after = items.filter(i => !idSet.has(i.id));
  if (after.length < before) await setGallery(after);
  return before - after.length;
}

module.exports = {
  getGallery,
  setGallery,
  addGalleryItems,
  updateGalleryItem,
  deleteGalleryItems,
};
