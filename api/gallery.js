/**
 * 图库 API — 云端同步
 * GET    — 读取所有图库项
 * POST   — 添加图库项（生成完成时调用，图片已在 CDN）
 * PATCH  — 更新单项（URL 更新等）
 * DELETE — 批量删除
 */

const { getGallery, setGallery, addGalleryItems, updateGalleryItem, deleteGalleryItems } = require('../lib/gallery-store');

module.exports = async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'PUT':
        return await handlePut(req, res);
      case 'PATCH':
        return await handlePatch(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[gallery] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function handleGet(req, res) {
  const items = await getGallery();
  return res.json({ items });
}

async function handlePut(req, res) {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: '缺少 items 数组' });
  }
  await setGallery(items);
  return res.json({ ok: true, count: items.length });
}

async function handlePost(req, res) {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '缺少 items 数组' });
  }
  const added = await addGalleryItems(items);
  return res.json({ added });
}

async function handlePatch(req, res) {
  const { id, updates } = req.body;
  if (!id || !updates) {
    return res.status(400).json({ error: '缺少 id 或 updates' });
  }
  const ok = await updateGalleryItem(id, updates);
  return res.json({ updated: ok ? 1 : 0 });
}

async function handleDelete(req, res) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '缺少 ids 数组' });
  }
  const count = await deleteGalleryItems(ids);
  return res.json({ deleted: count });
}
