require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware - CORS 优化：支持手机微信浏览器
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400, // 预检请求缓存24小时，减少OPTIONS请求
}));

// 显式处理 OPTIONS 预检请求（快速响应）
app.options('*', (req, res) => {
  res.status(204).end();
});

app.use(express.json({ limit: '5mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/donate', require('./routes/donate'));
app.use('/api/usage', require('./routes/usage'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Only listen in non-serverless environment
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`MySQL Analyzer Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
