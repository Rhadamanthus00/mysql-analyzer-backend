const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function formatDate(date) {
  return date.toISOString().split('T')[0] + ' ' + date.toTimeString().split(' ')[0];
}

// POST /api/usage/record
router.post('/record', authMiddleware, (req, res) => {
  const { module, action, details } = req.body;
  if (!module || !action) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const now = formatDate(new Date());
  db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(generateId(), req.user.id, req.user.username, action, module, now, details || '');

  // Update user's modules_visited
  const user = db.prepare('SELECT modules_visited FROM users WHERE id = ?').get(req.user.id);
  if (user) {
    const visited = JSON.parse(user.modules_visited || '[]');
    if (!visited.includes(module)) {
      visited.push(module);
      db.prepare('UPDATE users SET modules_visited = ? WHERE id = ?').run(JSON.stringify(visited), req.user.id);
    }
  }

  res.json({ success: true });
});

module.exports = router;
