/**
 * 图片上传端点：接收单张 base64 图片，上传到 TensorArt CDN，返回 URL
 */

const { uploadBufferToCDN } = require('../lib/cdn');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, name } = req.body;
  if (!image) {
    return res.status(400).json({ error: '缺少 image 字段' });
  }

  const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: '无效的图片数据格式，需要 data:image/xxx;base64,...' });
  }

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');

  try {
    const url = await uploadBufferToCDN(buffer, ext);
    return res.json({ success: true, url });
  } catch (err) {
    return res.status(500).json({ error: `上传失败: ${err.message}` });
  }
};
