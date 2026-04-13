const { getGallery, setGallery, addGalleryItems, updateGalleryItem, deleteGalleryItems } = require('../lib/gallery-store');
const { withAuth } = require('../lib/auth');

module.exports = withAuth(async function handler(req, res) {
  const userId = req.user.id;

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, userId);
      case 'POST':
        return await handlePost(req, res, userId);
      case 'PUT':
        return await handlePut(req, res, userId);
      case 'PATCH':
        return await handlePatch(req, res, userId);
      case 'DELETE':
        return await handleDelete(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[gallery] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

async function handleGet(req, res, userId) {
  const items = await getGallery(userId);
  return res.json({ items });
}

async function handlePut(req, res, userId) {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: '缺少 items 数组' });
  }
  await setGallery(userId, items);
  return res.json({ ok: true, count: items.length });
}

async function handlePost(req, res, userId) {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '缺少 items 数组' });
  }
  const added = await addGalleryItems(userId, items);
  return res.json({ added });
}

async function handlePatch(req, res, userId) {
  const { id, updates } = req.body;
  if (!id || !updates) {
    return res.status(400).json({ error: '缺少 id 或 updates' });
  }
  const ok = await updateGalleryItem(userId, id, updates);
  return res.json({ updated: ok ? 1 : 0 });
}

async function handleDelete(req, res, userId) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '缺少 ids 数组' });
  }
  const count = await deleteGalleryItems(userId, ids);
  return res.json({ deleted: count });
}
