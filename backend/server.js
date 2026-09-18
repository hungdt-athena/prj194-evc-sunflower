require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── SSE (Server-Sent Events) ───────────────────────────
const sseClients = [];
app.locals.sseClients = sseClients;

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial heartbeat
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Add to clients
  sseClients.push(res);
  console.log(`[SSE] Client connected (${sseClients.length} total)`);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', time: new Date().toISOString() })}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log(`[SSE] Client disconnected (${sseClients.length} total)`);
  });
});

// ─── Auth middleware ────────────────────────────────────
const { requireApiKey } = require('./middleware/auth');

// ─── Đồng bộ định kỳ từ Google Sheets ───────────────────
const { startSyncLoop, runSync } = require('./sync');
startSyncLoop(app);

app.post('/api/sync/manual', requireApiKey, async (req, res) => {
  const result = await runSync({ sseClients: app.locals.sseClients || [] });
  res.status(result.ok ? 200 : 500).json(result);
});

// Nút Refresh trên dashboard gọi endpoint này. Không đòi API key vì bản thân
// /api/data đã công khai, nên nó không mở thêm dữ liệu nào; rủi ro duy nhất là
// bị bấm liên tục làm cạn quota Sheets, nên chặn bằng cooldown.
const REFRESH_COOLDOWN_MS = Number(process.env.REFRESH_COOLDOWN_SECONDS || 20) * 1000;
let lastRefreshAt = 0;

app.post('/api/sync/refresh', async (req, res) => {
  const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - lastRefreshAt);
  if (waitMs > 0) {
    return res.status(429).json({ ok: false, cooldown: true, retryInSeconds: Math.ceil(waitMs / 1000) });
  }
  lastRefreshAt = Date.now();
  const result = await runSync({ sseClients: app.locals.sseClients || [] });
  res.status(result.ok ? 200 : 500).json(result);
});

// ─── API Routes ─────────────────────────────────────────
app.use('/api/meta', require('./routes/meta'));
app.use('/api/data', require('./routes/data'));

// ─── Catchall: serve frontend ───────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🌻 EVC Sunflower Dashboard Backend`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api/meta`);
  console.log(`  SSE:     http://localhost:${PORT}/events`);
  console.log(`  Sync:    POST http://localhost:${PORT}/api/sync/manual`);
  console.log(`  ─────────────────────────────\n`);
});
