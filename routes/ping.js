const express = require('express');
const router  = express.Router();
const ping    = require('ping');
const db      = require('../db/database');

/* ── GET /api/ping/now/:ip — ping on-demand ──────────────────── */
router.get('/now/:ip', async (req, res) => {
  const { ip } = req.params;

  // Validasi format IP sederhana
  if (!ip || !/^[\d.]+$/.test(ip))
    return res.status(400).json({ error: 'Format IP tidak valid' });

  try {
    const cfg = {
      timeout: 3,
      extra: process.platform === 'win32' ? ['-n', '1', '-w', '2000'] : ['-c', '1', '-W', '3']
    };
    const t0 = Date.now();
    const result = await ping.promise.probe(ip, cfg);
    const elapsed = Date.now() - t0;

    const latency = result.alive
      ? (result.time !== 'unknown' ? Math.round(parseFloat(result.time)) : elapsed)
      : null;

    res.json({ ip, online: result.alive, latency_ms: latency, host: result.host });
  } catch (err) {
    res.status(500).json({ error: `Gagal ping: ${err.message}` });
  }
});

/* ── GET /api/ping/history/:deviceId ─────────────────────────── */
router.get('/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // max 7 hari
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);

    const [deviceRows] = await db.execute('SELECT id, nama, ip FROM devices WHERE id = ?', [deviceId]);
    const device = deviceRows[0];
    if (!device) return res.status(404).json({ error: 'Device tidak ditemukan' });

    const [rows] = await db.execute(`
      SELECT is_online, latency_ms, pinged_at
      FROM ping_history
      WHERE device_id = ?
        AND pinged_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY pinged_at ASC
      LIMIT ?
    `, [deviceId, hours, limit]);

    // Statistik
    const total     = rows.length;
    const online    = rows.filter(r => r.is_online).length;
    const latencies = rows.filter(r => r.latency_ms != null).map(r => r.latency_ms);
    const avgLat    = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null;
    const maxLat    = latencies.length ? Math.max(...latencies) : null;
    const minLat    = latencies.length ? Math.min(...latencies) : null;
    const uptime    = total > 0 ? ((online/total)*100).toFixed(1) : null;

    res.json({
      device_id: deviceId,
      device_name: device.nama,
      device_ip: device.ip,
      period_hours: hours,
      stats: {
        total, online, offline: total - online,
        uptime_pct: uptime,
        avg_latency_ms: avgLat,
        max_latency_ms: maxLat,
        min_latency_ms: minLat
      },
      history: rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/ping/summary — ringkasan semua device ──────────── */
router.get('/summary', async (req, res) => {
  try {
    const [devices] = await db.execute(`
      SELECT id, loc_id, nama, ip, status, last_seen, last_ping_ms
      FROM devices
      WHERE ip IS NOT NULL AND ip != ''
      ORDER BY status DESC, nama
    `);

    const total   = devices.length;
    const online  = devices.filter(d => d.status === 'Online').length;
    const offline = devices.filter(d => d.status === 'Offline').length;
    const unknown = devices.filter(d => d.status === 'Unknown').length;

    res.json({ total, online, offline, unknown, devices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/ping/sla-report ───────────────────────────────── */
router.get('/sla-report', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    
    // Compute total pings, online pings, and average latency per device over the last X days
    const sql = `
      SELECT 
        d.id as device_id,
        d.nama as device_name,
        d.loc_id as location,
        d.ip as ip_address,
        COUNT(p.id) as total_samples,
        SUM(CASE WHEN p.is_online = 1 THEN 1 ELSE 0 END) as online_samples,
        SUM(CASE WHEN p.is_online = 0 THEN 1 ELSE 0 END) as offline_samples,
        ROUND(AVG(p.latency_ms), 1) as avg_latency
      FROM devices d
      LEFT JOIN ping_history p ON d.id = p.device_id AND p.pinged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      WHERE d.ip IS NOT NULL AND d.ip != ''
      GROUP BY d.id
      ORDER BY d.loc_id, d.nama
    `;
    
    const [rows] = await db.execute(sql, [days]);
    
    // Calculate uptime percentage and estimate downtime
    const report = rows.map(r => {
      let uptime_percent = 0;
      let downtime_minutes = 0;
      
      if (r.total_samples > 0) {
        uptime_percent = (r.online_samples / r.total_samples) * 100;
        // Ping scheduler runs roughly every 30 seconds (or interval in env)
        const pingIntervalSeconds = parseInt(process.env.PING_INTERVAL_MS || 30000) / 1000;
        downtime_minutes = (r.offline_samples * pingIntervalSeconds) / 60;
      }
      
      return {
        ...r,
        uptime_percent: parseFloat(uptime_percent.toFixed(2)),
        downtime_minutes: Math.round(downtime_minutes)
      };
    });
    
    res.json({ report, period_days: days });
  } catch (err) {
    console.error('[SLA Report Error]', err);
    res.status(500).json({ error: 'Gagal membuat laporan SLA' });
  }
});

module.exports = router;
