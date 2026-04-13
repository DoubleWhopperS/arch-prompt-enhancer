const { getRefLibrary, addRefImages, updateRefImages, deleteRefImages } = require('../lib/ref-store');
const { uploadBufferToCDN } = require('../lib/cdn');
const { withAuth } = require('../lib/auth');

function generateId() {
  return 'ref_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

module.exports = withAuth(async function handler(req, res) {
  const userId = req.user.id;

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res, userId);
      case 'POST':
        return await handlePost(req, res, userId);
      case 'PATCH':
        return await handlePatch(req, res, userId);
      case 'DELETE':
        return await handleDelete(req, res, userId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[ref-library] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

async function handleGet(req, res, userId) {
  const items = await getRefLibrary(userId);
  return res.json({ items });
}

async function handlePost(req, res, userId) {
  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: '缺少 images 数组' });
  }

  const newItems = [];
  for (const img of images) {
    if (!img.data) continue;

    const matches = img.data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) continue;

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    const url = await uploadBufferToCDN(buffer, ext);

    newItems.push({
      id: generateId(),
      url,
      tags: img.tags || { style: '', dimensions: [], scene: '', custom: [] },
      description: img.description || '',
      addedAt: new Date().toISOString(),
    });
  }

  if (newItems.length === 0) {
    return res.status(400).json({ error: '没有有效的图片数据' });
  }

  const added = await addRefImages(userId, newItems);
  return res.json({ added });
}

async function handlePatch(req, res, userId) {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: '缺少 updates 数组' });
  }
  const count = await updateRefImages(userId, updates);
  return res.json({ updated: count });
}

async function handleDelete(req, res, userId) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '缺少 ids 数组' });
  }
  const count = await deleteRefImages(userId, ids);
  return res.json({ deleted: count });
}
