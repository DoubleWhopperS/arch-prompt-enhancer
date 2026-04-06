/**
 * 参考图素材库 API
 * GET    — 读取所有素材
 * POST   — 添加素材（base64 图片 → CDN + 元数据）
 * PATCH  — 批量更新标签/描述
 * DELETE — 批量删除
 */

const { getRefLibrary, addRefImages, updateRefImages, deleteRefImages } = require('../lib/ref-store');
const { uploadBufferToCDN } = require('../lib/cdn');

function generateId() {
  return 'ref_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

module.exports = async function handler(req, res) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      case 'PATCH':
        return handlePatch(req, res);
      case 'DELETE':
        return handleDelete(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[ref-library] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function handleGet(req, res) {
  const items = await getRefLibrary();
  return res.json({ items });
}

async function handlePost(req, res) {
  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: '缺少 images 数组' });
  }

  const newItems = [];
  for (const img of images) {
    if (!img.data) continue;

    // 解析 data-URI
    const matches = img.data.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) continue;

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // 上传到 CDN
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

  const added = await addRefImages(newItems);
  return res.json({ added });
}

async function handlePatch(req, res) {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: '缺少 updates 数组' });
  }
  const count = await updateRefImages(updates);
  return res.json({ updated: count });
}

async function handleDelete(req, res) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '缺少 ids 数组' });
  }
  const count = await deleteRefImages(ids);
  return res.json({ deleted: count });
}
