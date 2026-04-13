const BLOB_API = 'https://blob.vercel-storage.com';

function getBlobPath(userId) {
  return `ref-library/${userId}/metadata.json`;
}

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN 未配置');
  return token;
}

async function getRefLibrary(userId) {
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
    console.error('[ref-store] read error:', err.message);
    return [];
  }
}

async function setRefLibrary(userId, items) {
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

async function addRefImages(userId, newItems) {
  const items = await getRefLibrary(userId);
  items.unshift(...newItems);
  await setRefLibrary(userId, items);
  return newItems;
}

async function updateRefImages(userId, updates) {
  const items = await getRefLibrary(userId);
  let count = 0;
  for (const upd of updates) {
    const item = items.find(i => i.id === upd.id);
    if (!item) continue;
    if (upd.tags !== undefined) item.tags = upd.tags;
    if (upd.description !== undefined) item.description = upd.description;
    count++;
  }
  if (count > 0) await setRefLibrary(userId, items);
  return count;
}

async function deleteRefImages(userId, ids) {
  const idSet = new Set(ids);
  const items = await getRefLibrary(userId);
  const before = items.length;
  const after = items.filter(i => !idSet.has(i.id));
  if (after.length < before) await setRefLibrary(userId, after);
  return before - after.length;
}

module.exports = {
  getRefLibrary,
  setRefLibrary,
  addRefImages,
  updateRefImages,
  deleteRefImages,
};
