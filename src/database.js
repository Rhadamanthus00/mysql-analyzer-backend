const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    provider TEXT DEFAULT 'local' CHECK(provider IN ('local', 'wechat', 'google', 'github')),
    password_hash TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL,
    login_count INTEGER DEFAULT 0,
    total_usage_minutes INTEGER DEFAULT 0,
    modules_visited TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    duration INTEGER DEFAULT 0,
    details TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS donate_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    enabled INTEGER DEFAULT 0,
    qrcode_image TEXT DEFAULT '',
    title TEXT DEFAULT '请作者喝杯咖啡',
    description TEXT DEFAULT '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！',
    amounts TEXT DEFAULT '[5,10,20,50]'
  );

  CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_records(user_id);
`);

// Seed default admin if not exists
function seedData() {
  const adminExists = db.prepare('SELECT id FROM users WHERE id = ?').get('admin_001');
  if (adminExists) return;

  const now = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0] + ' ' + d.toTimeString().split(' ')[0];

  const adminHash = bcrypt.hashSync('admin@0305', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, email, display_name, role, provider, password_hash, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRecord = db.prepare(`
    INSERT INTO usage_records (id, user_id, username, action, module, timestamp, duration, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedTransaction = db.transaction(() => {
    // Admin
    insertUser.run('admin_001', 'admin', 'admin@mysqlanalyzer.com', '系统管理员', 'admin', 'local', adminHash,
      formatDate(new Date(now.getTime() - 30*24*60*60*1000)), formatDate(now), 42, 1260,
      JSON.stringify(['analyzer','callchain','gdblab','flamegraph','masterthread']));

    // Demo users
    const demoUsers = [
      { id: 'user_demo_01', username: 'zhang_wei', email: 'zhangwei@example.com', name: '张伟', provider: 'github', daysAgo: 25, lastDaysAgo: 1, logins: 18, minutes: 540, modules: ['analyzer','callchain','gdblab'] },
      { id: 'user_demo_02', username: 'li_na', email: 'lina@example.com', name: '李娜', provider: 'wechat', daysAgo: 20, lastDaysAgo: 2, logins: 12, minutes: 360, modules: ['analyzer','flamegraph'] },
      { id: 'user_demo_03', username: 'wang_ming', email: 'wangming@example.com', name: '王明', provider: 'google', daysAgo: 15, lastDaysAgo: 3, logins: 8, minutes: 180, modules: ['callchain','gdblab','masterthread'] },
      { id: 'user_demo_04', username: 'chen_jie', email: 'chenjie@example.com', name: '陈洁', provider: 'local', daysAgo: 10, lastDaysAgo: 5, logins: 5, minutes: 120, modules: ['analyzer'] },
      { id: 'user_demo_05', username: 'liu_yang', email: 'liuyang@example.com', name: '刘洋', provider: 'github', daysAgo: 7, lastDaysAgo: 1, logins: 15, minutes: 420, modules: ['analyzer','callchain','gdblab','flamegraph'] },
      { id: 'user_demo_06', username: 'zhao_hong', email: 'zhaohong@example.com', name: '赵红', provider: 'wechat', daysAgo: 5, lastDaysAgo: 0, logins: 6, minutes: 90, modules: ['gdblab','flamegraph'] },
    ];

    const demoHash = bcrypt.hashSync('demo123', 10);
    for (const u of demoUsers) {
      insertUser.run(u.id, u.username, u.email, u.name, 'user', u.provider,
        u.provider === 'local' ? demoHash : null,
        formatDate(new Date(now.getTime() - u.daysAgo*24*60*60*1000)),
        formatDate(new Date(now.getTime() - u.lastDaysAgo*24*60*60*1000)),
        u.logins, u.minutes, JSON.stringify(u.modules));
    }

    // Seed usage records
    const modules = ['analyzer','callchain','gdblab','flamegraph','masterthread','versionconfig'];
    const actions = ['页面访问','功能使用','代码浏览','调试操作','分析运行','版本切换'];
    const usernames = ['admin','zhang_wei','li_na','wang_ming','chen_jie','liu_yang','zhao_hong'];
    const userIds = ['admin_001','user_demo_01','user_demo_02','user_demo_03','user_demo_04','user_demo_05','user_demo_06'];
    const detailsList = ['查看 JOIN::optimize 调用链','运行 GDB 实验 #3','分析 OLTP 火焰图','浏览 InnoDB 源码','切换到 MySQL 5.7'];

    for (let i = 0; i < 80; i++) {
      const userIdx = Math.floor(Math.random() * usernames.length);
      const ts = new Date(now.getTime() - Math.random()*30*24*60*60*1000);
      const rid = Math.random().toString(36).substring(2,15) + Date.now().toString(36) + i;
      insertRecord.run(rid, userIds[userIdx], usernames[userIdx],
        actions[Math.floor(Math.random()*actions.length)],
        modules[Math.floor(Math.random()*modules.length)],
        formatDate(ts),
        Math.floor(Math.random()*60)+1,
        detailsList[Math.floor(Math.random()*detailsList.length)]);
    }

    // Seed donate config
    db.prepare(`INSERT OR IGNORE INTO donate_config (id, enabled, title, description, amounts) VALUES (1, 0, '请作者喝杯咖啡', '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！', '[5,10,20,50]')`).run();
  });

  seedTransaction();
}

seedData();

module.exports = db;
