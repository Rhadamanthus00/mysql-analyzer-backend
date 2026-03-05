const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function formatDate(date) {
  return date.toISOString().split('T')[0] + ' ' + date.toTimeString().split(' ')[0];
}

function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatar: row.avatar || '',
    role: row.role,
    provider: row.provider,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
    totalUsageMinutes: row.total_usage_minutes,
    modulesVisited: JSON.parse(row.modules_visited || '[]'),
  };
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请填写用户名和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(400).json({ success: false, error: '用户名不存在' });
  }

  if (!user.password_hash) {
    return res.status(400).json({ success: false, error: '该账号使用第三方登录，请使用对应方式登录' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ success: false, error: '密码错误' });
  }

  const now = formatDate(new Date());
  db.prepare('UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?').run(now, user.id);

  // Record login
  db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(generateId(), user.id, user.username, '登录', '系统', now, '账号密码登录');

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = generateToken(updatedUser);

  res.json({ success: true, user: formatUser(updatedUser), token });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body;
  if (!username || !email || !password || !displayName) {
    return res.status(400).json({ success: false, error: '请填写所有必填字段' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: '密码至少需要6个字符' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(400).json({ success: false, error: '用户名已存在' });
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) {
    return res.status(400).json({ success: false, error: '邮箱已被注册' });
  }

  const now = formatDate(new Date());
  const id = generateId();
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`INSERT INTO users (id, username, email, display_name, role, provider, password_hash, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
    VALUES (?, ?, ?, ?, 'user', 'local', ?, ?, ?, 0, 0, '[]')`)
    .run(id, username, email, displayName, hash, now, now);

  db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(generateId(), id, username, '注册', '系统', now, '新用户注册');

  res.json({ success: true });
});

// POST /api/auth/oauth
router.post('/oauth', (req, res) => {
  const { provider } = req.body;
  if (!['wechat', 'google', 'github'].includes(provider)) {
    return res.status(400).json({ success: false, error: '不支持的登录方式' });
  }

  const providerNames = { wechat: '微信', google: 'Google', github: 'GitHub' };
  const now = formatDate(new Date());

  // Find existing OAuth user
  let user = db.prepare("SELECT * FROM users WHERE provider = ? AND username LIKE ?").get(provider, `${provider}_%`);

  if (user) {
    db.prepare('UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?').run(now, user.id);
    db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(generateId(), user.id, user.username, '登录', '系统', now, `${providerNames[provider]}登录`);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  } else {
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    const id = generateId();
    const uname = `${provider}_${randomNum}`;
    db.prepare(`INSERT INTO users (id, username, email, display_name, role, provider, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
      VALUES (?, ?, ?, ?, 'user', ?, ?, ?, 1, 0, '[]')`)
      .run(id, uname, `${provider}_${randomNum}@oauth.example.com`, `${providerNames[provider]}用户${randomNum}`, provider, now, now);

    db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(generateId(), id, uname, '注册', '系统', now, `${providerNames[provider]} OAuth 注册`);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const token = generateToken(user);
  res.json({ success: true, user: formatUser(user), token });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json({ user: formatUser(user) });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  const now = formatDate(new Date());
  db.prepare('INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(generateId(), req.user.id, req.user.username, '登出', '系统', now, '用户登出');
  res.json({ success: true });
});

module.exports = router;
