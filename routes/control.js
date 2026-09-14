const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { rebootDevice, testSSH } = require('../services/sshControl');
const { logAudit } = require('../services/auditLog');
const { wake } = require('../services/wol');

/* ── POST /api/control/reboot ────────────────────────────────── */
router.post('/reboot', async (req, res) => {
  try {
    // Hanya admin yang bisa reboot
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat melakukan reboot device' });

    const { device_id, ssh_user, ssh_pass, ssh_port } = req.body;
    if (!device_id)
      return res.status(400).json({ error: 'device_id wajib diisi' });

    const [rows] = await db.execute('SELECT * FROM devices WHERE id = ?', [device_id]);
    const device = rows[0];

    if (!device)     return res.status(404).json({ error: 'Device tidak ditemukan' });
    if (!device.ip)  return res.status(400).json({ error: 'Device belum memiliki IP Address' });

    // Gunakan kredensial yang dikirim, atau fallback ke yang tersimpan
    const creds = {
      host      : device.ip,
      port      : parseInt(ssh_port) || device.ssh_port || 22,
      username  : ssh_user  || device.ssh_user,
      password  : ssh_pass  || device.ssh_pass,
      device_os : device.device_os || 'generic'
    };

    if (!creds.username || !creds.password)
      return res.status(400).json({ error: 'Kredensial SSH (username & password) diperlukan' });

    const result = await rebootDevice(creds);
    logAudit(req.user.username, 'Reboot Device', device.nama, `IP: ${device.ip}`);
    res.json({ success: true, message: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── POST /api/control/ssh-test ──────────────────────────────── */
router.post('/ssh-test', async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat menguji koneksi SSH' });

    const { device_id, ssh_user, ssh_pass, ssh_port } = req.body;
    if (!device_id)
      return res.status(400).json({ error: 'device_id wajib diisi' });

    const [rows] = await db.execute('SELECT * FROM devices WHERE id = ?', [device_id]);
    const device = rows[0];
    if (!device) return res.status(404).json({ error: 'Device tidak ditemukan' });

    const creds = {
      host    : device.ip,
      port    : parseInt(ssh_port) || device.ssh_port || 22,
      username: ssh_user || device.ssh_user,
      password: ssh_pass || device.ssh_pass
    };

    if (!creds.username || !creds.password)
      return res.status(400).json({ error: 'Username dan password SSH diperlukan' });

    await testSSH(creds);
    logAudit(req.user.username, 'Test SSH', device.nama, `IP: ${device.ip} - Success`);
    res.json({ success: true, message: `Koneksi SSH ke ${device.ip} berhasil` });
  } catch (err) {
    res.status(500).json({ success: false, error: `Koneksi SSH gagal: ${err.message}` });
  }
});

/* ── POST /api/control/save-ssh — simpan kredensial SSH ─────── */
router.post('/save-ssh', async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat menyimpan kredensial SSH' });

    const { device_id, ssh_user, ssh_pass, ssh_port, device_os } = req.body;
    if (!device_id)
      return res.status(400).json({ error: 'device_id wajib diisi' });

    await db.execute(`
      UPDATE devices SET ssh_user=?, ssh_pass=?, ssh_port=?, device_os=?,
        updated_at=NOW()
      WHERE id=?
    `, [ssh_user||'', ssh_pass||'', ssh_port||22, device_os||'generic', device_id]);

    logAudit(req.user.username, 'Update SSH Creds', device_id, 'Kredensial SSH diperbarui');
    res.json({ success: true, message: 'Kredensial SSH disimpan' });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── POST /api/control/wake — Wake-on-LAN ───────────────────── */
router.post('/wake', async (req, res) => {
  try {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id wajib diisi' });

    const [rows] = await db.execute('SELECT * FROM devices WHERE id = ?', [device_id]);
    const device = rows[0];
    if (!device) return res.status(404).json({ error: 'Device tidak ditemukan' });
    if (!device.mac) return res.status(400).json({ error: 'Device belum memiliki MAC Address untuk WoL' });

    const msg = await wake(device.mac);
    logAudit(req.user.username, 'Wake on LAN', device.nama, `MAC: ${device.mac}`);
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── POST /api/control/kick — Memutus Koneksi Perangkat dari Router ── */
router.post('/kick', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat memutus koneksi perangkat' });
    }

    const { device_id, mac, ip, router_id } = req.body;
    let targetMac = mac;
    let targetIp  = ip;
    let deviceName = 'Perangkat';

    if (device_id) {
      const [rows] = await db.execute('SELECT * FROM devices WHERE id = ?', [device_id]);
      if (rows.length > 0) {
        deviceName = rows[0].nama;
        targetMac = targetMac || rows[0].mac;
        targetIp  = targetIp  || rows[0].ip;
      }
    }

    if (!targetMac && !targetIp) {
      return res.status(400).json({ error: 'MAC Address atau IP Address perangkat diperlukan' });
    }

    // Select router to send kick command
    let targetRouter = null;
    if (router_id) {
      const [rRows] = await db.execute('SELECT * FROM routers WHERE id = ?', [router_id]);
      if (rRows.length > 0) targetRouter = rRows[0];
    }

    if (!targetRouter) {
      const [allRouters] = await db.execute('SELECT * FROM routers ORDER BY id LIMIT 1');
      if (allRouters.length > 0) targetRouter = allRouters[0];
    }

    if (!targetRouter) {
      return res.status(400).json({ error: 'Tidak ada Router / AP terdaftar untuk memutus koneksi' });
    }

    const { kickDeviceFromRouter } = require('../services/routerControl');
    const msg = await kickDeviceFromRouter(targetRouter, targetMac, targetIp);

    logAudit(
      req.user.username,
      'Kick Device',
      deviceName,
      `MAC: ${targetMac || '—'}, IP: ${targetIp || '—'}, Router: ${targetRouter.name}`
    );

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('[Kick Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Gagal memutus koneksi perangkat' });
  }
});

const { sendAlert } = require('../services/notifier');

/* ── POST /api/control/test-alert — Pengujian Notifikasi Eksternal ──── */
router.post('/test-alert', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menguji notifikasi' });
    }

    const nowStr = new Date().toLocaleString('id-ID');
    const msg = `🧪 *PENGUJIAN NOTIFIKASI SISTEM*\n\nSistem Network Control CBA berhasil terhubung ke saluran notifikasi Telegram / Webhook.\n\n*Operator:* ${req.user.username}\n*Waktu:* ${nowStr}\n*Status:* Koneksi Notifikasi Aktif & Normal`;

    await sendAlert(msg);
    logAudit(req.user.username, 'Test Notification', 'Alert Dispatcher', 'Pengujian notifikasi Telegram / Webhook dikirim');

    res.json({ success: true, message: 'Notifikasi uji coba berhasil dikirim ke saluran Telegram / Webhook' });
  } catch (err) {
    console.error('[Test Alert Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Gagal mengirim notifikasi uji coba' });
  }
});

/* ── POST /api/control/block — Block Perangkat via SSH (Mendukung Durasi) ── */
router.post('/block', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat mem-block perangkat' });
    }

    const { device_id, mac, ip, router_id, reason, duration } = req.body;
    let targetMac = mac;
    let targetIp  = ip;
    let deviceName = 'Perangkat';

    if (device_id) {
      const [rows] = await db.execute('SELECT * FROM devices WHERE id = ?', [device_id]);
      if (rows.length > 0) {
        deviceName = rows[0].nama;
        targetMac = targetMac || rows[0].mac;
        targetIp  = targetIp  || rows[0].ip;
      }
    }

    if (!targetMac && !targetIp) {
      return res.status(400).json({ error: 'MAC Address atau IP Address perangkat diperlukan' });
    }

    let targetRouter = null;
    if (router_id) {
      const [rRows] = await db.execute('SELECT * FROM routers WHERE id = ?', [router_id]);
      if (rRows.length > 0) targetRouter = rRows[0];
    }
    if (!targetRouter) {
      const [allRouters] = await db.execute('SELECT * FROM routers ORDER BY id LIMIT 1');
      if (allRouters.length > 0) targetRouter = allRouters[0];
    }
    if (!targetRouter) {
      return res.status(400).json({ error: 'Tidak ada Router / AP terdaftar' });
    }

    // Hitung tanggal kadaluwarsa berdasarkan durasi
    let expiresAt = null;
    let durationLabel = 'Permanen';
    if (duration === '1h') {
      expiresAt = new Date(Date.now() + 3600 * 1000);
      durationLabel = '1 Jam';
    } else if (duration === '24h') {
      expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
      durationLabel = '24 Jam';
    } else if (duration === '7d') {
      expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      durationLabel = '7 Hari';
    }

    const expiresAtStr = expiresAt ? expiresAt.toISOString().slice(0, 19).replace('T', ' ') : null;

    const { blockDeviceOnRouter } = require('../services/routerControl');
    const msg = await blockDeviceOnRouter(targetRouter, targetMac, targetIp);

    // Save to blocked_devices DB (update if already exists)
    const [existingBlocked] = await db.execute('SELECT id FROM blocked_devices WHERE mac = ? AND mac != ""', [targetMac || '']);
    if (existingBlocked.length > 0) {
      await db.execute(`
        UPDATE blocked_devices 
        SET router_id=?, ip=?, device_name=?, reason=?, expires_at=?, blocked_at=NOW()
        WHERE id=?
      `, [targetRouter.id, targetIp || '', deviceName, reason || 'Blocked by Admin', expiresAtStr, existingBlocked[0].id]);
    } else {
      await db.execute(`
        INSERT INTO blocked_devices (device_id, router_id, mac, ip, device_name, reason, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        device_id || null,
        targetRouter.id,
        targetMac || '',
        targetIp || '',
        deviceName,
        reason || 'Blocked by Admin',
        expiresAtStr
      ]);
    }

    logAudit(
      req.user.username,
      'Block Device',
      deviceName,
      `MAC: ${targetMac || '—'}, Router: ${targetRouter.name}, Durasi: ${durationLabel}`
    );

    res.json({ success: true, message: `${msg} (Durasi: ${durationLabel})`, expires_at: expiresAtStr });
  } catch (err) {
    console.error('[Block Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Gagal mem-block perangkat' });
  }
});

/* ── POST /api/control/unblock — Buka Block Perangkat via SSH ──────── */
router.post('/unblock', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat membuka block perangkat' });
    }

    const { block_id, mac } = req.body;
    if (!block_id && !mac) return res.status(400).json({ error: 'block_id atau mac wajib diisi' });

    let bRows = [];
    if (block_id) {
      [bRows] = await db.execute('SELECT * FROM blocked_devices WHERE id = ?', [block_id]);
    } else if (mac) {
      [bRows] = await db.execute('SELECT * FROM blocked_devices WHERE mac = ?', [mac]);
    }

    if (bRows.length === 0) return res.status(404).json({ error: 'Data block tidak ditemukan' });

    const item = bRows[0];
    const [rRows] = await db.execute('SELECT * FROM routers WHERE id = ?', [item.router_id]);
    const targetRouter = rRows.length > 0 ? rRows[0] : null;

    if (targetRouter) {
      const { unblockDeviceOnRouter } = require('../services/routerControl');
      await unblockDeviceOnRouter(targetRouter, item.mac, item.ip);
    }

    await db.execute('DELETE FROM blocked_devices WHERE id = ? OR mac = ?', [item.id, item.mac]);

    logAudit(
      req.user.username,
      'Unblock Device',
      item.device_name || item.mac,
      `MAC: ${item.mac}`
    );

    res.json({ success: true, message: `Block perangkat ${item.mac} berhasil dibuka!` });
  } catch (err) {
    console.error('[Unblock Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Gagal membuka block perangkat' });
  }
});

/* ── GET /api/control/blocked — Daftar Perangkat Ter-Block ─────────── */
router.get('/blocked', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT b.*, r.name as router_name, r.host as router_host
      FROM blocked_devices b
      LEFT JOIN routers r ON b.router_id = r.id
      ORDER BY b.id DESC
    `);
    res.json({ blocked: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar perangkat ter-block' });
  }
});

/* ── GET /api/control/backup — One-Click Portable SQL Database Backup ── */
router.get('/backup', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat mengunduh backup database' });
    }

    const tables = [
      'zones',
      'locations',
      'device_types',
      'device_os',
      'devices',
      'topology_nodes',
      'routers',
      'blocked_devices',
      'users',
      'audit_logs',
      'ping_history'
    ];

    function sqlFormat(val) {
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return val;
      if (typeof val === 'boolean') return val ? 1 : 0;
      if (val instanceof Date) {
        return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
      }
      if (typeof val === 'object') {
        return `'${JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
      }
      return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
    }

    let sqlDump = `-- ========================================================\n`;
    sqlDump += `-- CBA FACTORY NETWORK CONTROL SYSTEM // FULL DATABASE BACKUP\n`;
    sqlDump += `-- Generated at : ${new Date().toISOString()}\n`;
    sqlDump += `-- Operator     : ${req.user.username}\n`;
    sqlDump += `-- ========================================================\n\n`;
    sqlDump += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

    for (const table of tables) {
      try {
        const [createRows] = await db.query(`SHOW CREATE TABLE \`${table}\``);
        if (!createRows.length) continue;

        const createSql = createRows[0]['Create Table'];
        sqlDump += `-- --------------------------------------------------------\n`;
        sqlDump += `-- Table structure for table \`${table}\`\n`;
        sqlDump += `-- --------------------------------------------------------\n`;
        sqlDump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
        sqlDump += `${createSql};\n\n`;

        // Fetch data
        const [dataRows] = await db.query(`SELECT * FROM \`${table}\``);
        if (dataRows.length > 0) {
          sqlDump += `-- Dumping data for table \`${table}\` (${dataRows.length} rows)\n`;
          const cols = Object.keys(dataRows[0]).map(c => `\`${c}\``).join(', ');
          
          // Chunk inserts in batches of 100 rows
          const CHUNK = 100;
          for (let i = 0; i < dataRows.length; i += CHUNK) {
            const batch = dataRows.slice(i, i + CHUNK);
            const valStrings = batch.map(row => {
              const vals = Object.values(row).map(sqlFormat).join(', ');
              return `(${vals})`;
            }).join(',\n');
            sqlDump += `INSERT INTO \`${table}\` (${cols}) VALUES\n${valStrings};\n`;
          }
          sqlDump += `\n`;
        }
      } catch (tableErr) {
        console.warn(`[Backup] Melewati tabel ${table}:`, tableErr.message);
      }
    }

    sqlDump += `SET FOREIGN_KEY_CHECKS = 1;\n`;
    sqlDump += `-- End of CBA Network Backup\n`;

    const filename = `cba_network_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    logAudit(req.user.username, 'Database Backup', 'System Database', `Full database backup downloaded (${filename})`);
    res.send(sqlDump);
  } catch (err) {
    console.error('[Backup Error]', err);
    res.status(500).json({ error: 'Gagal membuat backup database: ' + err.message });
  }
});

/* ── POST /api/control/restore — Restore Database from SQL Script ───── */
router.post('/restore', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat memulihkan database' });
    }

    const { sql } = req.body;
    if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
      return res.status(400).json({ error: 'Isi file SQL cadangan wajib disertakan' });
    }

    // Security check: only allow safe table operations
    if (!sql.includes('TABLE') && !sql.includes('INSERT INTO')) {
      return res.status(400).json({ error: 'Format berkas SQL tidak valid atau kosong' });
    }

    // Split SQL into individual statements while respecting quotes and semicolons
    const statements = sql
      .replace(/--.*$/gm, '') // Remove single line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi line comments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    let executedCount = 0;

    for (const statement of statements) {
      try {
        await db.query(statement);
        executedCount++;
      } catch (stmtErr) {
        console.warn('[Restore] Peringatan statement SQL:', stmtErr.message);
      }
    }

    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    logAudit(req.user.username, 'Database Restore', 'System Database', `Database dipulihkan (${executedCount} statement dieksekusi)`);
    res.json({ success: true, message: `Database berhasil dipulihkan (${executedCount} statement dieksekusi).` });
  } catch (err) {
    console.error('[Restore Error]', err);
    try { await db.query('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
    res.status(500).json({ success: false, error: 'Gagal memulihkan database: ' + err.message });
  }
});

module.exports = router;
