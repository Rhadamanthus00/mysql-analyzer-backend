const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Helper: run a query
async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// Helper: get one row
async function getOne(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

// Helper: get all rows
async function getAll(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Initialize tables
async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      provider TEXT DEFAULT 'local' CHECK(provider IN ('local', 'wechat', 'google', 'github')),
      password_hash TEXT,
      password_changed BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL,
      login_count INTEGER DEFAULT 0,
      total_usage_minutes INTEGER DEFAULT 0,
      modules_visited TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      details TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS donate_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled BOOLEAN DEFAULT FALSE,
      qrcode_image TEXT DEFAULT '',
      title TEXT DEFAULT '请作者喝杯咖啡',
      description TEXT DEFAULT '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！',
      amounts TEXT DEFAULT '[5,10,20,50]'
    );
  `);

  // Create indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_records(user_id)`);
}

// Seed default admin from environment variables
async function seedData() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = process.env.ADMIN_EMAIL || `${adminUsername || 'admin'}@mysqlanalyzer.com`;

  if (!adminUsername || !adminPassword) {
    console.warn('⚠️  ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量未设置，跳过管理员初始化');
    return;
  }

  const adminExists = await getOne('SELECT id FROM users WHERE role = $1 AND username = $2', ['admin', adminUsername]);
  if (adminExists) return;

  const now = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0] + ' ' + d.toTimeString().split(' ')[0];
  const adminHash = bcrypt.hashSync(adminPassword, 10);

  await query(
    `INSERT INTO users (id, username, email, display_name, role, provider, password_hash, password_changed, created_at, last_login_at, login_count, total_usage_minutes, modules_visited)
     VALUES ($1, $2, $3, $4, 'admin', 'local', $5, FALSE, $6, $7, 0, 0, '[]')`,
    ['admin_001', adminUsername, adminEmail, '系统管理员', adminHash, formatDate(now), formatDate(now)]
  );

  // Seed donate config
  await query(
    `INSERT INTO donate_config (id, enabled, title, description, amounts) VALUES (1, FALSE, '请作者喝杯咖啡', '如果这个项目对您有帮助，可以请作者喝杯咖啡，感谢您的支持！', '[5,10,20,50]') ON CONFLICT (id) DO NOTHING`
  );

  console.log(`✅ 管理员账号 "${adminUsername}" 已创建（首次登录需修改密码）`);
}

// Init on first import
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) {
    _initPromise = initDatabase().then(() => seedData()).catch(err => {
      console.error('❌ 数据库初始化失败:', err);
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

module.exports = { pool, query, getOne, getAll, ensureInit };
