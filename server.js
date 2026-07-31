require('dotenv').config();
const express        = require('express');
const http           = require('http');
const WebSocket      = require('ws');
const path           = require('path');
const jwt            = require('jsonwebtoken');

// Inisialisasi database (buat tabel + seed admin)
const db = require('./db/database');

// Routes
const authRoutes    = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const pingRoutes    = require('./routes/ping');
const controlRoutes = require('./routes/control');
const authMW        = require('./middleware/auth');

// Services
const pingScheduler = require('./services/pingScheduler');

/* ─── Express App ─────────────────────────────────────── */
const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ─── REST API Routes ─────────────────────────────────── */
app.use('/api/auth',    authRoutes);
app.use('/api/devices', authMW, devicesRoutes);
app.use('/api/ping',    authMW, pingRoutes);
app.use('/api/control', authMW, controlRoutes);

/* ─── Health check ────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status : 'ok',
    uptime : Math.round(process.uptime()),
    time   : new Date().toISOString()
  });
});

/* ─── SPA fallback ────────────────────────────────────── */
app.get('*', (req, res) => {
  // Jangan serve index.html untuk request /api
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── WebSocket Server ────────────────────────────────── */
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Baca token dari query string: /ws?token=xxx
  try {
    const urlObj   = new URL(req.url, 'http://localhost');
    const token    = urlObj.searchParams.get('token');
    if (!token) { ws.close(4001, 'Unauthorized'); return; }

    const user = jwt.verify(token, process.env.JWT_SECRET);
    ws._user   = user;

    console.log(`[WS] Client terhubung: ${user.username} (${req.socket.remoteAddress})`);

    ws.on('close', () => {
      console.log(`[WS] Client putus: ${user.username}`);
    });

    ws.on('error', err => console.error('[WS] Error:', err.message));

    // Sambut client dengan status koneksi
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket aktif' }));

  } catch (err) {
    ws.close(4001, 'Token tidak valid');
  }
});

/* ─── Start Ping Scheduler ────────────────────────────── */
pingScheduler.start(wss);

/* ─── Listen ──────────────────────────────────────────────────────────────── */
const PORT = parseInt(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   FACTORY NETWORK CONTROL SYSTEM           ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   HTTP  → http://0.0.0.0:${PORT}              ║`);
  console.log(`║   LAN   → http://<ip-server>:${PORT}          ║`);
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} sudah digunakan oleh proses lain.`);
    console.error(`        Jalankan perintah berikut untuk menghentikannya:`);
    console.error(`        Get-Process node | Stop-Process -Force\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

/* ─── Graceful shutdown ───────────────────────────────── */
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
