const { setGallery } = require('../lib/gallery-store');
const { verifyAuth } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).end();

  try {
    const { items } = req.body;
    if (items && Array.isArray(items)) {
      await setGallery(user.id, items);
      console.log(`[gallery-beacon] saved ${items.length} items for ${user.id.slice(0, 8)}`);
    }
    return res.status(200).end();
  } catch (err) {
    console.error('[gallery-beacon] error:', err.message);
    return res.status(500).end();
  }
};
