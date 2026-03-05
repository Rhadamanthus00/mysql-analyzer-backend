const express = require('express');
const multer = require('multer');
const { query, getOne, ensureInit } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Use memory storage for Vercel (no disk access)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'));
    }
  }
});

// Safe parse amounts (could be string, array, or object from pg driver)
function parseAmounts(raw) {
  if (!raw) return [5, 10, 20, 50];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return [5, 10, 20, 50]; }
  }
  return [5, 10, 20, 50];
}

// GET /api/donate/config - Public, anyone can read
// Use ?full=1 to include full qrcodeImage base64 data
router.get('/config', async (req, res) => {
  try {
    await ensureInit();
    const includeFull = req.query.full === '1';
    const columns = includeFull
      ? '*'
      : 'id, enabled, title, description, amounts, CASE WHEN qrcode_image IS NOT NULL AND qrcode_image != \'\' THEN \'1\' ELSE \'\' END AS has_qrcode';
    const config = await getOne(`SELECT ${columns} FROM donate_config WHERE id = 1`);
    if (!config) {
      return res.json({
        enabled: false, qrcodeImage: '', title: '请作者喝杯咖啡',
        description: '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！',
        amounts: [5, 10, 20, 50],
      });
    }
    res.json({
      enabled: !!config.enabled,
      qrcodeImage: includeFull ? (config.qrcode_image || '') : (config.has_qrcode === '1' ? '__has_image__' : ''),
      title: config.title || '请作者喝杯咖啡',
      description: config.description || '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！',
      amounts: parseAmounts(config.amounts),
    });
  } catch (err) {
    console.error('Get donate config error:', err);
    res.status(500).json({ error: '服务器内部错误', debug: err.message });
  }
});

// PUT /api/donate/config - Admin only
router.put('/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await ensureInit();
    const { enabled, title, description, amounts } = req.body;
    const current = await getOne('SELECT * FROM donate_config WHERE id = 1');

    if (current) {
      const sets = [];
      const values = [];
      let idx = 1;

      if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); values.push(!!enabled); }
      if (title !== undefined) { sets.push(`title = $${idx++}`); values.push(title); }
      if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
      if (amounts !== undefined) { sets.push(`amounts = $${idx++}`); values.push(JSON.stringify(amounts)); }

      if (sets.length > 0) {
        await query(`UPDATE donate_config SET ${sets.join(', ')} WHERE id = 1`, values);
      }
    } else {
      await query(
        `INSERT INTO donate_config (id, enabled, title, description, amounts) VALUES (1, $1, $2, $3, $4)`,
        [!!enabled || false, title || '', description || '', JSON.stringify(amounts) || '[5,10,20,50]']
      );
    }

    const updated = await getOne('SELECT * FROM donate_config WHERE id = 1');
    res.json({
      enabled: !!updated.enabled,
      qrcodeImage: updated.qrcode_image || '',
      title: updated.title || '请作者喝杯咖啡',
      description: updated.description || '',
      amounts: parseAmounts(updated.amounts),
    });
  } catch (err) {
    console.error('Update donate config error:', err);
    res.status(500).json({ error: '服务器内部错误', debug: err.message });
  }
});

// POST /api/donate/qrcode - Upload QR code image (Admin only)
router.post('/qrcode', authMiddleware, adminMiddleware, upload.single('qrcode'), async (req, res) => {
  try {
    await ensureInit();
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const current = await getOne('SELECT * FROM donate_config WHERE id = 1');
    if (current) {
      await query('UPDATE donate_config SET qrcode_image = $1 WHERE id = 1', [base64]);
    } else {
      await query('INSERT INTO donate_config (id, qrcode_image) VALUES (1, $1)', [base64]);
    }

    res.json({ success: true, qrcodeImage: base64 });
  } catch (err) {
    console.error('Upload qrcode error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/donate/qrcode - Remove QR code (Admin only)
router.delete('/qrcode', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await ensureInit();
    await query("UPDATE donate_config SET qrcode_image = '' WHERE id = 1");
    res.json({ success: true });
  } catch (err) {
    console.error('Delete qrcode error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
