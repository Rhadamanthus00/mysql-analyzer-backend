const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configure multer for qrcode upload
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `qrcode_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'));
    }
  }
});

// GET /api/donate/config - Public, anyone can read
router.get('/config', (req, res) => {
  const config = db.prepare('SELECT * FROM donate_config WHERE id = 1').get();
  if (!config) {
    return res.json({
      enabled: false, qrcodeImage: '', title: '请作者喝杯咖啡',
      description: '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！',
      amounts: [5, 10, 20, 50],
    });
  }
  res.json({
    enabled: !!config.enabled,
    qrcodeImage: config.qrcode_image,
    title: config.title,
    description: config.description,
    amounts: JSON.parse(config.amounts || '[5,10,20,50]'),
  });
});

// PUT /api/donate/config - Admin only
router.put('/config', authMiddleware, adminMiddleware, (req, res) => {
  const { enabled, title, description, amounts } = req.body;
  const current = db.prepare('SELECT * FROM donate_config WHERE id = 1').get();

  const updates = {};
  if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (amounts !== undefined) updates.amounts = JSON.stringify(amounts);

  if (current) {
    const setClauses = Object.keys(updates).map(k => {
      const col = k === 'enabled' ? 'enabled' : k === 'qrcodeImage' ? 'qrcode_image' : k;
      return `${col} = @${k}`;
    }).join(', ');
    if (setClauses) {
      db.prepare(`UPDATE donate_config SET ${setClauses} WHERE id = 1`).run(updates);
    }
  } else {
    db.prepare(`INSERT INTO donate_config (id, enabled, title, description, amounts) VALUES (1, @enabled, @title, @description, @amounts)`)
      .run({ enabled: updates.enabled || 0, title: updates.title || '', description: updates.description || '', amounts: updates.amounts || '[5,10,20,50]' });
  }

  const updated = db.prepare('SELECT * FROM donate_config WHERE id = 1').get();
  res.json({
    enabled: !!updated.enabled,
    qrcodeImage: updated.qrcode_image,
    title: updated.title,
    description: updated.description,
    amounts: JSON.parse(updated.amounts || '[5,10,20,50]'),
  });
});

// POST /api/donate/qrcode - Upload QR code image (Admin only)
router.post('/qrcode', authMiddleware, adminMiddleware, upload.single('qrcode'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择图片文件' });
  }

  // Read file as base64
  const filePath = req.file.path;
  const fileData = fs.readFileSync(filePath);
  const base64 = `data:${req.file.mimetype};base64,${fileData.toString('base64')}`;

  // Update database
  const current = db.prepare('SELECT * FROM donate_config WHERE id = 1').get();
  if (current) {
    db.prepare('UPDATE donate_config SET qrcode_image = ? WHERE id = 1').run(base64);
  } else {
    db.prepare('INSERT INTO donate_config (id, qrcode_image) VALUES (1, ?)').run(base64);
  }

  // Clean up file (stored in DB as base64)
  fs.unlinkSync(filePath);

  res.json({ success: true, qrcodeImage: base64 });
});

// DELETE /api/donate/qrcode - Remove QR code (Admin only)
router.delete('/qrcode', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('UPDATE donate_config SET qrcode_image = ? WHERE id = 1').run('');
  res.json({ success: true });
});

module.exports = router;
