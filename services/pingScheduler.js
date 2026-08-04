const ping = require('ping');
const db   = require('../db/database');
const { sendAlert } = require('./notifier');
const { logAudit } = require('./auditLog');
require('dotenv').config();

const INTERVAL_MS    = parseInt(process.env.PING_INTERVAL_MS) || 30000;
const HISTORY_DAYS   = parseInt(process.env.PING_HISTORY_DAYS) || 7;
const BATCH_SIZE     = 25; // ping max 25 device sekaligus

let wsServer  = null;
let isCycling = false;

/* Kirim pesan ke semua WebSocket client yang terhubung */
function broadcast(data) {
  if (!wsServer) return;
  const payload = JSON.stringify(data);
  wsServer.clients.forEach(client => {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(payload); } catch (_) {}
    }
  });
}

/* Ping satu device dan simpan hasilnya */
async function pingOne(device) {
  const { id, nama, ip, status: oldStatus } = device;
  try {
    const cfg = {
      timeout: 3,
      extra: process.platform === 'win32'
        ? ['-n', '1', '-w', '2000']
        : ['-c', '1', '-W', '3']
    };
    const result = await ping.promise.probe(ip, cfg);
    const isOnline  = result.alive;
    const latencyMs = isOnline && result.time !== 'unknown'
      ? Math.round(parseFloat(result.time))
      : null;
    const status = isOnline ? 'Online' : 'Offline';

    // Simpan ke history
    await db.execute(`
      INSERT INTO ping_history (device_id, ip, is_online, latency_ms, pinged_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [id, ip, isOnline ? 1 : 0, latencyMs]);

    // Update status device
    await db.execute(`
      UPDATE devices SET
        status     = ?,
        last_ping_ms = ?,
        last_seen  = CASE WHEN ? THEN NOW() ELSE last_seen END
      WHERE id = ?
    `, [status, latencyMs, isOnline ? 1 : 0, id]);

    // Check state transition for notification
    if (oldStatus && oldStatus !== 'Unknown' && oldStatus !== status) {
      const icon = isOnline ? '✅' : '🚨';
      const msg = `${icon} *Perubahan Status Perangkat*\n\n*Nama:* ${nama}\n*IP:* ${ip}\n*Status Baru:* ${status}\n*Waktu:* ${new Date().toLocaleString('id-ID')}`;
      
      sendAlert(msg);
      logAudit('system', 'Status Changed', nama, `Status berubah dari ${oldStatus} menjadi ${status}`);
    }

    return { device_id: id, ip, online: isOnline, latency_ms: latencyMs, status };
  } catch (err) {
    console.error(`[Ping] Error ${ip}:`, err.message);
    return { device_id: id, ip, online: false, latency_ms: null, status: 'Offline' };
  }
}

/* Jalankan satu siklus ping untuk semua device ber-IP */
async function runCycle() {
  if (isCycling) return; // hindari overlap
  isCycling = true;

  try {
    const [devices] = await db.execute(`
      SELECT id, nama, ip, status FROM devices
      WHERE ip IS NOT NULL AND ip != ''
    `);

    if (devices.length === 0) { isCycling = false; return; }

    console.log(`[Ping] Mulai siklus: ${devices.length} device`);
    const results = [];

    // Ping dalam batch
    for (let i = 0; i < devices.length; i += BATCH_SIZE) {
      const batch = devices.slice(i, i + BATCH_SIZE);
      const batchRes = await Promise.all(batch.map(pingOne));
      results.push(...batchRes);
    }

    // Broadcast ke semua WebSocket client
    broadcast({ type: 'ping_update', results, timestamp: new Date().toISOString() });

    const onlineCount = results.filter(r => r.online).length;
    console.log(`[Ping] Selesai: ${onlineCount}/${results.length} online`);

    // Bersihkan history lama
    await db.execute(`
      DELETE FROM ping_history
      WHERE pinged_at < DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [HISTORY_DAYS]);

    // Bersihkan audit logs yang lebih dari 30 hari
    await db.execute(`
      DELETE FROM audit_logs
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

  } catch (err) {
    console.error('[Ping] Error siklus:', err.message);
  }

  isCycling = false;
}

/* Mulai scheduler */
function start(wss) {
  wsServer = wss;
  console.log(`[Ping] Scheduler aktif. Interval: ${INTERVAL_MS / 1000} detik`);

  // Jalankan langsung saat server start (delay 3 detik agar server siap)
  setTimeout(runCycle, 3000);
  setInterval(runCycle, INTERVAL_MS);
}

module.exports = { start, runCycle };
