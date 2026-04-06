/**
 * Gallery beacon — 接收 navigator.sendBeacon 的紧急保存
 * 页面关闭前的安全网，防止未同步数据丢失
 */
const { setGallery } = require('../lib/gallery-store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { items } = req.body;
    if (items && Array.isArray(items)) {
      await setGallery(items);
      console.log(`[gallery-beacon] saved ${items.length} items`);
    }
    return res.status(200).end();
  } catch (err) {
    console.error('[gallery-beacon] error:', err.message);
    return res.status(500).end();
  }
};
