const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

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
    password_changed INTEGER DEFAULT 0,
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

// Add password_changed column if not exists (migration for existing DBs)
try {
  db.exec('ALTER TABLE users ADD COLUMN password_changed INTEGER DEFAULT 0');
} catch {
  // Column already exists, ignore
}

// Seed default admin from environment variables
function seedData() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = process.env.ADMIN_EMAIL || `${adminUsername || 'admin'}@mysqlanalyzer.com`;

  if (!adminUsername || !adminPassword) {
    console.warn('⚠️  ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量未设置，跳过管理员初始化');
    console.warn('   请在 .env 文件中配置这两个变量后重启服务');
    return;
  }

  const adminExists = db.prepare('SELECT id FROM users WHERE role = ? AND username = ?').get('admin', adminUsername);
  if (adminExists) return;

  const now = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0] + ' ' + d.toTimeString().split(' ')[0];

  const adminHash = bcrypt.hashSync(adminPassword, 10);

  db.prepare(`
    INSERT INTO users (id, username, email, display_name, role, provider, password_hash, password_changed, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
    VALUES (?, ?, ?, ?, 'admin', 'local', ?, 0, ?, ?, 0, 0, '[]')
  `).run('admin_001', adminUsername, adminEmail, '系统管理员', adminHash, formatDate(now), formatDate(now));

  // Seed donate config
  db.prepare(`INSERT OR IGNORE INTO donate_config (id, enabled, title, description, amounts) VALUES (1, 0, '请作者喝杯咖啡', '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！', '[5,10,20,50]')`).run();

  console.log(`✅ 管理员账号 "${adminUsername}" 已创建（首次登录需修改密码）`);
}

seedData();

module.exports = db;
