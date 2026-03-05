require('dotenv').config();
const { ensureInit, pool } = require('./database');

async function main() {
  try {
    console.log('🔄 正在初始化数据库...');
    await ensureInit();
    console.log('✅ 数据库初始化完成！');
  } catch (err) {
    console.error('❌ 初始化失败:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
