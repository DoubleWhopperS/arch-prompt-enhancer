const BLOB_API = 'https://blob.vercel-storage.com';

function getBlobPath(userId) {
  return `gallery/${userId}/metadata.json`;
}

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN 未配置');
  return token;
}

async function getGallery(userId) {
  try {
    const token = getToken();
    const blobPath = getBlobPath(userId);
    const listResp = await fetch(`${BLOB_API}?prefix=${encodeURIComponent(blobPath)}&limit=1`, {
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

async function setGallery(userId, items) {
  const token = getToken();
  const blobPath = getBlobPath(userId);
  const resp = await fetch(`${BLOB_API}/${blobPath}`, {
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

async function addGalleryItems(userId, newItems) {
  const items = await getGallery(userId);
  items.unshift(...newItems);
  await setGallery(userId, items);
  return newItems;
}

async function updateGalleryItem(userId, id, updates) {
  const items = await getGallery(userId);
  const item = items.find(i => i.id === id);
  if (!item) return false;
  Object.assign(item, updates);
  await setGallery(userId, items);
  return true;
}

async function deleteGalleryItems(userId, ids) {
  const idSet = new Set(ids);
  const items = await getGallery(userId);
  const before = items.length;
  const after = items.filter(i => !idSet.has(i.id));
  if (after.length < before) await setGallery(userId, after);
  return before - after.length;
}

module.exports = {
  getGallery,
  setGallery,
  addGalleryItems,
  updateGalleryItem,
  deleteGalleryItems,
};
