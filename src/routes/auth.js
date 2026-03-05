const express = require('express');
const bcrypt = require('bcryptjs');
const { query, getOne, ensureInit } = require('../database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function formatDate(date) {
  return date.toISOString().split('T')[0] + ' ' + date.toTimeString().split(' ')[0];
}

function formatUser(row) {
  let modulesVisited = row.modules_visited || [];
  if (typeof modulesVisited === 'string') {
    try { modulesVisited = JSON.parse(modulesVisited); } catch { modulesVisited = []; }
  }
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
    modulesVisited,
    passwordChanged: !!row.password_changed,
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    await ensureInit();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '请填写用户名和密码' });
    }

    const user = await getOne('SELECT * FROM users WHERE username = $1', [username]);
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
    await query('UPDATE users SET last_login_at = $1, login_count = login_count + 1 WHERE id = $2', [now, user.id]);

    await query(
      'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [generateId(), user.id, user.username, '登录', '系统', now, '账号密码登录']
    );

    const updatedUser = await getOne('SELECT * FROM users WHERE id = $1', [user.id]);
    const token = generateToken(updatedUser);

    res.json({
      success: true,
      user: formatUser(updatedUser),
      token,
      requirePasswordChange: !updatedUser.password_changed && updatedUser.role === 'admin',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    await ensureInit();
    const { username, email, password, displayName } = req.body;
    if (!username || !email || !password || !displayName) {
      return res.status(400).json({ success: false, error: '请填写所有必填字段' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码至少需要6个字符' });
    }

    const existingUser = await getOne('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser) {
      return res.status(400).json({ success: false, error: '用户名已存在' });
    }

    const existingEmail = await getOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail) {
      return res.status(400).json({ success: false, error: '邮箱已被注册' });
    }

    const now = formatDate(new Date());
    const id = generateId();
    const hash = bcrypt.hashSync(password, 10);

    await query(
      `INSERT INTO users (id, username, email, display_name, role, provider, password_hash, password_changed, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
       VALUES ($1, $2, $3, $4, 'user', 'local', $5, TRUE, $6, $7, 0, 0, '[]')`,
      [id, username, email, displayName, hash, now, now]
    );

    await query(
      'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [generateId(), id, username, '注册', '系统', now, '新用户注册']
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// POST /api/auth/oauth
router.post('/oauth', async (req, res) => {
  try {
    await ensureInit();
    const { provider } = req.body;
    if (!['wechat', 'google', 'github'].includes(provider)) {
      return res.status(400).json({ success: false, error: '不支持的登录方式' });
    }

    const providerNames = { wechat: '微信', google: 'Google', github: 'GitHub' };
    const now = formatDate(new Date());

    let user = await getOne("SELECT * FROM users WHERE provider = $1 AND username LIKE $2", [provider, `${provider}_%`]);

    if (user) {
      await query('UPDATE users SET last_login_at = $1, login_count = login_count + 1 WHERE id = $2', [now, user.id]);
      await query(
        'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [generateId(), user.id, user.username, '登录', '系统', now, `${providerNames[provider]}登录`]
      );
      user = await getOne('SELECT * FROM users WHERE id = $1', [user.id]);
    } else {
      const randomNum = Math.floor(Math.random() * 9000) + 1000;
      const id = generateId();
      const uname = `${provider}_${randomNum}`;
      await query(
        `INSERT INTO users (id, username, email, display_name, role, provider, password_changed, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
         VALUES ($1, $2, $3, $4, 'user', $5, TRUE, $6, $7, 1, 0, '[]')`,
        [id, uname, `${provider}_${randomNum}@oauth.example.com`, `${providerNames[provider]}用户${randomNum}`, provider, now, now]
      );

      await query(
        'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [generateId(), id, uname, '注册', '系统', now, `${providerNames[provider]} OAuth 注册`]
      );
      user = await getOne('SELECT * FROM users WHERE id = $1', [id]);
    }

    const token = generateToken(user);
    res.json({ success: true, user: formatUser(user), token });
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    await ensureInit();
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码至少需要6个字符' });
    }

    const user = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    if (user.password_changed && user.password_hash) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: '请输入当前密码' });
      }
      if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(400).json({ success: false, error: '当前密码错误' });
      }
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, password_changed = TRUE WHERE id = $2', [newHash, user.id]);

    const now = formatDate(new Date());
    await query(
      'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [generateId(), user.id, user.username, '修改密码', '系统', now, '用户修改密码']
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    await ensureInit();
    const user = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({
      user: formatUser(user),
      requirePasswordChange: !user.password_changed && user.role === 'admin',
    });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await ensureInit();
    const now = formatDate(new Date());
    await query(
      'INSERT INTO usage_records (id, user_id, username, action, module, timestamp, details) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [generateId(), req.user.id, req.user.username, '登出', '系统', now, '用户登出']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
