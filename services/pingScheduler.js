const ping = require('ping');
const db   = require('../db/database');
const { sendAlert } = require('./notifier');
const { logAudit } = require('./auditLog');
require('dotenv').config();

const INTERVAL_MS    = parseInt(process.env.PING_INTERVAL_MS) || 30000;
const HISTORY_DAYS   = parseInt(process.env.PING_HISTORY_DAYS) || 7;
const BATCH_SIZE     = 25; // ping max 25 device sekaligus
const FAIL_THRESHOLD = parseInt(process.env.ALERT_FAIL_THRESHOLD) || 3; // Ambang batas retry sebelum kirim alert offline

// State tracking untuk anti-flapping debounce
const failureCounters = new Map();     // deviceId -> counter kegagalan berturut-turut
const confirmedDownAlerted = new Set(); // deviceId -> set perangkat yang sudah dikirimi alert offline

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

/* Sweep otomatis untuk membuka blokir MAC yang sudah melewati batas durasi */
async function sweepExpiredBlocks() {
  try {
    const [expired] = await db.execute(`
      SELECT b.*, r.name as router_name, r.host as router_host, r.port as router_port,
             r.username as router_user, r.password as router_pass, r.router_type
      FROM blocked_devices b
      LEFT JOIN routers r ON b.router_id = r.id
      WHERE b.expires_at IS NOT NULL AND b.expires_at <= NOW()
    `);

    if (!expired || expired.length === 0) return;

    const { unblockDeviceOnRouter } = require('./routerControl');
    for (const item of expired) {
      if (item.router_name) {
        const routerObj = {
          id: item.router_id,
          name: item.router_name,
          host: item.router_host,
          port: item.router_port,
          username: item.router_user,
          password: item.router_pass,
          router_type: item.router_type
        };
        try {
          await unblockDeviceOnRouter(routerObj, item.mac, item.ip);
        } catch (e) {
          console.error(`[AutoUnblock] Gagal membuka blokir di router ${item.router_name}:`, e.message);
        }
      }
      await db.execute('DELETE FROM blocked_devices WHERE id = ?', [item.id]);
      logAudit('system', 'Auto Unblock (Expired)', item.device_name || item.mac, `Durasi isolasi selesai (Kadaluwarsa: ${item.expires_at})`);
      console.log(`[AutoUnblock] Blokir ${item.mac} otomatis dibuka karena durasi telah habis.`);
    }
  } catch (err) {
    // Abaikan jika kolom expires_at belum ada
  }
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

    // Anti-flapping debounce logic untuk notifikasi eksternal (Telegram / Webhook)
    if (isOnline) {
      // Jika perangkat sebelumnya terkonfirmasi offline dan sudah dikirimi alert, kirimkan notifikasi pemulihan
      if (confirmedDownAlerted.has(id)) {
        confirmedDownAlerted.delete(id);
        const msg = `✅ *Pemulihan Perangkat (Recovered)*\n\n*Nama:* ${nama}\n*IP:* ${ip}\n*Status:* Online (${latencyMs !== null ? latencyMs + ' ms' : 'OK'})\n*Waktu:* ${new Date().toLocaleString('id-ID')}`;
        sendAlert(msg);
        logAudit('system', 'Status Recovered', nama, `Perangkat kembali Online (${latencyMs || 0} ms)`);
      }
      failureCounters.set(id, 0);
    } else {
      // Perangkat gagal ping: tingkatkan counter kegagalan
      const currentFails = (failureCounters.get(id) || 0) + 1;
      failureCounters.set(id, currentFails);

      // Hanya kirim alert jika telah gagal mencapai ambang batas FAIL_THRESHOLD (default 3x = ~90s)
      if (currentFails >= FAIL_THRESHOLD && !confirmedDownAlerted.has(id)) {
        confirmedDownAlerted.add(id);
        const msg = `🚨 *Peringatan Perangkat Terputus (Offline)*\n\n*Nama:* ${nama}\n*IP:* ${ip}\n*Status:* Offline (${currentFails}x gagal ping berturut-turut)\n*Waktu:* ${new Date().toLocaleString('id-ID')}`;
        sendAlert(msg);
        logAudit('system', 'Status Offline Confirmed', nama, `Perangkat offline terkonfirmasi (${currentFails}x gagal berturut-turut)`);
      }
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
    // Sweep perangkat terblokir yang durasinya sudah kadaluwarsa
    await sweepExpiredBlocks();

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
