const express = require('express');
const { query, getOne, ensureInit } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function formatDate(date) {
  return date.toISOString().split('T')[0] + ' ' + date.toTimeString().split(' ')[0];
}

// POST /api/usage/record
router.post('/record', authMiddleware, async (req, res) => {
  try {
    await ensureInit();
    const { module, action, details } = req.body;
    if (!module || !action) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const now = formatDate(new Date());
    await query(
      'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [generateId(), req.user.id, req.user.username, action, module, now, details || '']
    );

    // Update user's modules_visited
    const user = await getOne('SELECT modules_visited FROM users WHERE id = $1', [req.user.id]);
    if (user) {
      const visited = JSON.parse(user.modules_visited || '[]');
      if (!visited.includes(module)) {
        visited.push(module);
        await query('UPDATE users SET modules_visited = $1 WHERE id = $2', [JSON.stringify(visited), req.user.id]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Record usage error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
