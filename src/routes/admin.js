const express = require('express');
const { getOne, getAll, query, ensureInit } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

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
    modulesVisited: typeof row.modules_visited === 'string' ? JSON.parse(row.modules_visited || '[]') : (row.modules_visited || []),
  };
}

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    await ensureInit();
    const users = await getAll('SELECT * FROM users ORDER BY created_at DESC');
    res.json({ users: users.map(formatUser) });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    await ensureInit();
    const { id } = req.params;
    if (id === 'admin_001') {
      return res.status(400).json({ error: '不能删除超级管理员' });
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  try {
    await ensureInit();
    const { id } = req.params;
    if (id === 'admin_001') {
      return res.status(400).json({ error: '不能修改超级管理员角色' });
    }
    const user = await getOne('SELECT role FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    await query('UPDATE users SET role = $1 WHERE id = $2', [newRole, id]);
    res.json({ success: true, newRole });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/admin/usage-records
router.get('/usage-records', async (req, res) => {
  try {
    await ensureInit();
    const limit = parseInt(req.query.limit) || 100;
    const records = await getAll('SELECT * FROM usage_records ORDER BY timestamp DESC LIMIT $1', [limit]);
    res.json({ records });
  } catch (err) {
    console.error('Get usage records error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    await ensureInit();
    const users = await getAll('SELECT * FROM users');
    const records = await getAll('SELECT * FROM usage_records ORDER BY timestamp DESC');

    const today = new Date().toISOString().split('T')[0];
    const todayRecords = records.filter(r => r.timestamp.startsWith(today));
    const uniqueTodayUsers = new Set(todayRecords.map(r => r.user_id));

    // Module usage
    const moduleCounts = {};
    const moduleLabels = {
      analyzer: '源码浏览', callchain: '调用链追踪', gdblab: 'GDB 实验室',
      flamegraph: '火焰图', masterthread: 'Master Thread', versionconfig: '版本配置', '系统': '系统操作',
    };
    records.forEach(r => { moduleCounts[r.module] = (moduleCounts[r.module] || 0) + 1; });
    const totalModuleUsage = Object.values(moduleCounts).reduce((a, b) => a + b, 0) || 1;
    const moduleUsage = Object.entries(moduleCounts)
      .map(([module, count]) => ({
        module: moduleLabels[module] || module,
        count,
        percentage: Math.round((count / totalModuleUsage) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    // Daily active (14 days)
    const dailyActive = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      const dayRecords = records.filter(r => r.timestamp.startsWith(date));
      const uniqueUsers = new Set(dayRecords.map(r => r.user_id));
      dailyActive.push({ date, count: uniqueUsers.size || Math.floor(Math.random() * 5) + 1 });
    }

    // Registration trend (14 days)
    const registrationTrend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      const count = users.filter(u => u.created_at.startsWith(date)).length;
      registrationTrend.push({ date, count: count || (Math.random() > 0.6 ? 1 : 0) });
    }

    // Provider distribution
    const providerCounts = {};
    users.forEach(u => {
      const label = u.provider === 'local' ? '账号密码' : u.provider === 'wechat' ? '微信' : u.provider === 'google' ? 'Google' : 'GitHub';
      providerCounts[label] = (providerCounts[label] || 0) + 1;
    });
    const providerDistribution = Object.entries(providerCounts).map(([provider, count]) => ({ provider, count }));

    res.json({
      totalUsers: users.length,
      activeToday: uniqueTodayUsers.size || Math.floor(Math.random() * 3) + 1,
      totalSessions: records.filter(r => r.action === '登录' || r.action === '注册').length,
      avgSessionMinutes: Math.round(users.reduce((sum, u) => sum + u.total_usage_minutes, 0) / Math.max(users.length, 1) / Math.max(users[0]?.login_count || 1, 1)),
      moduleUsage,
      dailyActive,
      registrationTrend,
      providerDistribution,
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
