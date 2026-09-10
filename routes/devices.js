const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { logAudit } = require('../services/auditLog');

function uid() {
  return 'd' + Math.random().toString(36).slice(2, 10);
}

/* ── GET /api/devices — semua device dikelompokkan per loc_id ── */
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT id, loc_id, nama, tipe, merk, ip, mac, status,
             catatan, ssh_user, ssh_pass, ssh_port, device_os,
             last_seen, last_ping_ms, created_at, updated_at
      FROM devices ORDER BY loc_id, nama
    `);

    // Group by loc_id (format sama seperti frontend lama)
    const grouped = {};
    rows.forEach(d => {
      if (!grouped[d.loc_id]) grouped[d.loc_id] = [];
      grouped[d.loc_id].push(d);
    });

    res.json({ devices: grouped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/devices/list — flat list ──────────────────────── */
router.get('/list', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT id, loc_id, nama, tipe, merk, ip, mac, status,
             last_seen, last_ping_ms, device_os
      FROM devices ORDER BY loc_id, nama
    `);
    res.json({ devices: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/devices/loc/:locId ────────────────────────────── */
router.get('/loc/:locId', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT id, loc_id, nama, tipe, merk, ip, mac, status,
             catatan, ssh_user, ssh_pass, ssh_port, device_os,
             last_seen, last_ping_ms
      FROM devices WHERE loc_id = ? ORDER BY nama
    `, [req.params.locId]);
    res.json({ devices: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── POST /api/devices — tambah device ──────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      loc_id, nama, tipe, merk, ip, mac, catatan,
      ssh_user, ssh_pass, ssh_port, device_os
    } = req.body;

    if (!loc_id || !nama)
      return res.status(400).json({ error: 'loc_id dan nama wajib diisi' });

    const id = uid();
    await db.execute(`
      INSERT INTO devices
        (id, loc_id, nama, tipe, merk, ip, mac, catatan,
         ssh_user, ssh_pass, ssh_port, device_os, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unknown')
    `, [
      id, loc_id, nama,
      tipe      || 'Lainnya',
      merk      || '',
      ip        || '',
      mac       || '',
      catatan   || '',
      ssh_user  || '',
      ssh_pass  || '',
      ssh_port  || 22,
      device_os || 'generic'
    ]);

    const [rows] = await db.execute(`
      SELECT id, loc_id, nama, tipe, merk, ip, mac, status,
             catatan, ssh_user, ssh_pass, ssh_port, device_os, last_seen, last_ping_ms
      FROM devices WHERE id = ?
    `, [id]);
    
    const device = rows[0];
    
    // Audit Log
    logAudit(req.user.username, 'Add Device', nama, `IP: ${ip}, Loc: ${loc_id}`);

    res.status(201).json({ device });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── PUT /api/devices/:id — edit device ─────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const [existingRows] = await db.execute('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Device tidak ditemukan' });

    const {
      nama, tipe, merk, ip, mac, status, catatan,
      ssh_user, ssh_pass, ssh_port, device_os
    } = req.body;

    await db.execute(`
      UPDATE devices SET
        nama=?, tipe=?, merk=?, ip=?, mac=?, status=?, catatan=?,
        ssh_user=?, ssh_pass=?, ssh_port=?, device_os=?,
        updated_at=NOW()
      WHERE id=?
    `, [
      nama      ?? existing.nama,
      tipe      ?? existing.tipe,
      merk      ?? existing.merk,
      ip        ?? existing.ip,
      mac       ?? existing.mac,
      status    ?? existing.status,
      catatan   ?? existing.catatan,
      ssh_user  ?? existing.ssh_user,
      ssh_pass  !== undefined ? ssh_pass : existing.ssh_pass,
      ssh_port  ?? existing.ssh_port,
      device_os ?? existing.device_os,
      req.params.id
    ]);

    const [updatedRows] = await db.execute(`
      SELECT id, loc_id, nama, tipe, merk, ip, mac, status,
             catatan, ssh_user, ssh_pass, ssh_port, device_os, last_seen, last_ping_ms
      FROM devices WHERE id = ?
    `, [req.params.id]);
    
    const device = updatedRows[0];
    
    // Audit Log
    logAudit(req.user.username, 'Edit Device', device.nama, `IP: ${device.ip}, Updated by admin`);

    res.json({ device });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── DELETE /api/devices/:id ────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [existingRows] = await db.execute('SELECT id, nama FROM devices WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Device tidak ditemukan' });

    await db.execute('DELETE FROM devices WHERE id = ?', [req.params.id]);
    
    // Audit Log
    logAudit(req.user.username, 'Delete Device', existingRows[0].nama, `Deleted by admin`);
    
    res.json({ message: 'Device berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/devices/routers — Daftar semua Router / AP ───────── */
router.get('/routers', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id, name, host, port, username, router_type, created_at FROM routers ORDER BY id');
    res.json({ routers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar router' });
  }
});

/* ── POST /api/devices/routers — Tambah Router / AP Baru ────────── */
router.post('/routers', async (req, res) => {
  try {
    const { name, host, port, username, password, router_type } = req.body;
    if (!name || !host || !username) {
      return res.status(400).json({ error: 'Nama, Host/IP, dan Username router wajib diisi' });
    }

    await db.execute(`
      INSERT INTO routers (name, host, port, username, password, router_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      name.trim(),
      host.trim(),
      parseInt(port) || 22,
      username.trim(),
      password || '',
      router_type || 'mikrotik'
    ]);

    logAudit(req.user.username, 'Add Router', name, `Host: ${host}:${port || 22} (${router_type || 'mikrotik'})`);
    res.status(201).json({ message: 'Router / AP berhasil ditambahkan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan router baru' });
  }
});

/* ── PUT /api/devices/routers/:id — Edit Router / AP ────────────── */
router.put('/routers/:id', async (req, res) => {
  try {
    const { name, host, port, username, password, router_type } = req.body;
    const [existing] = await db.execute('SELECT * FROM routers WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Router tidak ditemukan' });

    const current = existing[0];

    await db.execute(`
      UPDATE routers SET
        name = ?, host = ?, port = ?, username = ?,
        password = ?, router_type = ?
      WHERE id = ?
    `, [
      name       ?? current.name,
      host       ?? current.host,
      port       ?? current.port,
      username   ?? current.username,
      password   !== undefined ? password : current.password,
      router_type?? current.router_type,
      req.params.id
    ]);

    logAudit(req.user.username, 'Edit Router', name || current.name, `Host: ${host || current.host}`);
    res.json({ message: 'Router / AP berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal merubah data router' });
  }
});

/* ── DELETE /api/devices/routers/:id — Hapus Router / AP ────────── */
router.delete('/routers/:id', async (req, res) => {
  try {
    const [existing] = await db.execute('SELECT name FROM routers WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Router tidak ditemukan' });

    await db.execute('DELETE FROM routers WHERE id = ?', [req.params.id]);
    logAudit(req.user.username, 'Delete Router', existing[0].name, `Deleted by admin`);
    res.json({ message: 'Router / AP berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus router' });
  }
});

/* ── POST /api/devices/routers/:id/test — Tes Koneksi SSH Router ── */
router.post('/routers/:id/test', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM routers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Router tidak ditemukan' });

    const { testRouterSSH } = require('../services/routerControl');
    await testRouterSSH(rows[0]);
    res.json({ message: `Koneksi SSH ke ${rows[0].name} (${rows[0].host}) BERHASIL!` });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Koneksi SSH gagal' });
  }
});

/* ── GET /api/devices/routers/:id/clients — Client tersambung live ── */
router.get('/routers/:id/clients', async (req, res) => {
  try {
    const discovery = require('../services/discovery');
    const clients = await discovery.discoverRouterClients(req.params.id);
    
    // Cross-reference with monitored devices table
    const [existingRows] = await db.execute('SELECT id, nama, loc_id, ip, mac FROM devices');
    const macMap = new Map();
    const ipMap  = new Map();
    existingRows.forEach(d => {
      if (d.mac) macMap.set(d.mac.toUpperCase(), d);
      if (d.ip)  ipMap.set(d.ip, d);
    });

    const enrichedClients = clients.map(c => {
      const match = (c.mac && macMap.get(c.mac.toUpperCase())) || (c.ip && ipMap.get(c.ip));
      return {
        ...c,
        is_monitored: !!match,
        monitored_device_id: match ? match.id : null,
        monitored_nama: match ? match.nama : null
      };
    });

    res.json({ clients: enrichedClients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Gagal memindai klien tersambung dari router' });
  }
});

/* ── GET /api/devices/scan ────────────────────────────────────── */
router.get('/scan', async (req, res) => {
  try {
    const discovery = require('../services/discovery');
    const scannedDevices = await discovery.discoverDevices();
    
    // Get existing IPs and MACs
    const [existingRows] = await db.execute('SELECT ip, mac FROM devices');
    const existingIps = new Set(existingRows.map(r => r.ip).filter(Boolean));
    const existingMacs = new Set(existingRows.map(r => r.mac).filter(Boolean));

    // Filter out known devices
    const newDevices = scannedDevices.filter(d => {
      // Don't include if IP or MAC is already in database
      if (existingIps.has(d.ip)) return false;
      if (d.mac && existingMacs.has(d.mac)) return false;
      return true;
    });

    res.json({ scanned: newDevices });
  } catch (err) {
    console.error('[Discovery]', err);
    res.status(500).json({ error: err.message || 'Gagal melakukan pemindaian jaringan' });
  }
});

/* ── POST /api/devices/bulk — tambah banyak device sekaligus ── */
router.post('/bulk', async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'Data devices kosong atau tidak valid' });
    }

    let inserted = 0;
    for (const d of devices) {
      if (!d.loc_id || !d.nama) continue;
      const deviceId = uid();
      await db.execute(`
        INSERT INTO devices
          (id, loc_id, nama, tipe, merk, ip, mac, catatan,
           ssh_user, ssh_pass, ssh_port, device_os, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unknown')
      `, [
        deviceId, d.loc_id, d.nama,
        d.tipe      || 'Lainnya',
        d.merk      || '',
        d.ip        || '',
        d.mac       || '',
        d.catatan   || 'Auto-discovered',
        d.ssh_user  || '',
        d.ssh_pass  || '',
        d.ssh_port  || 22,
        d.device_os || 'generic'
      ]);
      inserted++;
    }

    if (inserted > 0) {
      logAudit(req.user.username, 'Bulk Add Devices', 'Multiple', `Added ${inserted} auto-discovered devices`);
    }

    res.status(201).json({ message: `Berhasil menambahkan ${inserted} perangkat` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat bulk insert' });
  }
});

/* ── Option Management endpoints ── */

/* ── GET /api/devices/types ── */
router.get('/types', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT name FROM device_types ORDER BY id');
    res.json({ types: rows.map(r => r.name) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar kategori' });
  }
});

/* ── POST /api/devices/types ── */
router.post('/types', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nama tipe wajib diisi' });
    await db.execute('INSERT INTO device_types (name) VALUES (?)', [name.trim()]);
    res.status(201).json({ message: 'Tipe berhasil ditambahkan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan tipe (nama mungkin sudah terpakai)' });
  }
});

/* ── PUT /api/devices/types/:oldName ── */
router.put('/types/:oldName', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nama baru wajib diisi' });
    
    // Update type name
    await db.execute('UPDATE device_types SET name = ? WHERE name = ?', [name.trim(), req.params.oldName]);
    // Cascade update devices using this type
    await db.execute('UPDATE devices SET tipe = ? WHERE tipe = ?', [name.trim(), req.params.oldName]);
    
    res.json({ message: 'Tipe berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah tipe' });
  }
});

/* ── DELETE /api/devices/types/:name ── */
router.delete('/types/:name', async (req, res) => {
  try {
    await db.execute('DELETE FROM device_types WHERE name = ?', [req.params.name]);
    res.json({ message: 'Tipe berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus tipe' });
  }
});

/* ── GET /api/devices/os ── */
router.get('/os', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id, name FROM device_os ORDER BY name');
    res.json({ os: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar OS' });
  }
});

/* ── POST /api/devices/os ── */
router.post('/os', async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!id || !id.trim() || !name || !name.trim()) {
      return res.status(400).json({ error: 'ID dan nama OS wajib diisi' });
    }
    await db.execute('INSERT INTO device_os (id, name) VALUES (?, ?)', [id.trim().toLowerCase(), name.trim()]);
    res.status(201).json({ message: 'OS berhasil ditambahkan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan OS (ID/nama mungkin sudah terpakai)' });
  }
});

/* ── PUT /api/devices/os/:id ── */
router.put('/os/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nama baru wajib diisi' });
    
    await db.execute('UPDATE device_os SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    
    res.json({ message: 'OS berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah OS' });
  }
});

/* ── DELETE /api/devices/os/:id ── */
router.delete('/os/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM device_os WHERE id = ?', [req.params.id]);
    res.json({ message: 'OS berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus OS' });
  }
});

/* ── Zone / Category Management endpoints ── */

/* ── GET /api/devices/zones ── */
router.get('/zones', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT z.id, z.zone_key, z.label, z.sort_order,
        COALESCE((SELECT COUNT(*) FROM locations l WHERE l.zone_key = z.zone_key), 0) AS location_count,
        COALESCE((SELECT COUNT(*) FROM devices d JOIN locations l ON d.loc_id = l.id WHERE l.zone_key = z.zone_key), 0) AS device_count
      FROM zones z
      ORDER BY z.sort_order, z.id
    `);
    res.json({ zones: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar kategori gedung' });
  }
});

/* ── POST /api/devices/zones ── */
router.post('/zones', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menambah kategori gedung' });
    }
    const { zone_key, label, sort_order } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Nama/Label kategori wajib diisi' });
    }
    const key = (zone_key && zone_key.trim()) ? zone_key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') : label.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    
    await db.execute('INSERT INTO zones (zone_key, label, sort_order) VALUES (?, ?, ?)', [
      key, label.trim(), parseInt(sort_order) || 0
    ]);
    
    logAudit(req.user.username, 'Tambah Kategori Gedung', label, `Key: ${key}`);
    res.status(201).json({ message: 'Kategori gedung berhasil ditambahkan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Gagal menambahkan kategori gedung' });
  }
});

/* ── PUT /api/devices/zones/:id ── */
router.put('/zones/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat mengedit kategori gedung' });
    }
    const { label, sort_order } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Nama/Label kategori wajib diisi' });
    }

    await db.execute('UPDATE zones SET label = ?, sort_order = ? WHERE id = ?', [
      label.trim(), parseInt(sort_order) || 0, req.params.id
    ]);

    logAudit(req.user.username, 'Edit Kategori Gedung', label, `ID: ${req.params.id}`);
    res.json({ message: 'Kategori gedung berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah kategori gedung' });
  }
});

/* ── DELETE /api/devices/zones/:id ── */
router.delete('/zones/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menghapus kategori gedung' });
    }
    
    const [zRows] = await db.execute('SELECT * FROM zones WHERE id = ?', [req.params.id]);
    if (zRows.length === 0) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    
    const zone = zRows[0];

    // Check if subcategories/locations are attached to this zone
    const [lRows] = await db.execute('SELECT COUNT(*) as cnt FROM locations WHERE zone_key = ?', [zone.zone_key]);
    if (lRows[0].cnt > 0) {
      return res.status(400).json({
        error: `Tidak dapat menghapus "${zone.label}" karena masih memiliki ${lRows[0].cnt} sub-kategori/ruangan. Hapus atau pindahkan sub-kategori terlebih dahulu.`
      });
    }

    await db.execute('DELETE FROM zones WHERE id = ?', [req.params.id]);

    logAudit(req.user.username, 'Hapus Kategori Gedung', zone.label, `Key: ${zone.zone_key}`);
    res.json({ message: 'Kategori gedung berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus kategori gedung' });
  }
});

/* ── Sub Category / Location Management endpoints ── */

/* ── GET /api/devices/locations ── */
router.get('/locations', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT l.id, l.nama, l.zone_key, l.sort_order,
        COALESCE(z.label, l.zone_key) AS zone_label,
        COALESCE((SELECT COUNT(*) FROM devices d WHERE d.loc_id = l.id), 0) AS device_count
      FROM locations l
      LEFT JOIN zones z ON l.zone_key = z.zone_key
      ORDER BY l.sort_order, l.nama
    `);
    res.json({ locations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar sub-kategori / lokasi' });
  }
});

/* ── POST /api/devices/locations ── */
router.post('/locations', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menambah sub-kategori' });
    }
    const { id, nama, zone_key, sort_order } = req.body;
    if (!nama || !nama.trim() || !zone_key || !zone_key.trim()) {
      return res.status(400).json({ error: 'Nama sub-kategori dan Kategori Utama wajib diisi' });
    }
    
    const locId = (id && id.trim()) ? id.trim() : 'l' + Date.now();
    await db.execute('INSERT INTO locations (id, nama, zone_key, sort_order) VALUES (?, ?, ?, ?)', [
      locId, nama.trim(), zone_key.trim(), parseInt(sort_order) || 0
    ]);
    
    logAudit(req.user.username, 'Tambah Sub-Kategori', nama, `ID: ${locId}, Zone: ${zone_key}`);
    res.status(201).json({ message: 'Sub-kategori / lokasi berhasil ditambahkan', id: locId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Gagal menambahkan sub-kategori' });
  }
});

/* ── PUT /api/devices/locations/:id ── */
router.put('/locations/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat mengedit sub-kategori' });
    }
    const { nama, zone_key, sort_order } = req.body;
    if (!nama || !nama.trim() || !zone_key || !zone_key.trim()) {
      return res.status(400).json({ error: 'Nama sub-kategori dan Kategori Utama wajib diisi' });
    }

    await db.execute('UPDATE locations SET nama = ?, zone_key = ?, sort_order = ? WHERE id = ?', [
      nama.trim(), zone_key.trim(), parseInt(sort_order) || 0, req.params.id
    ]);

    logAudit(req.user.username, 'Edit Sub-Kategori', nama, `ID: ${req.params.id}`);
    res.json({ message: 'Sub-kategori / lokasi berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah sub-kategori' });
  }
});

/* ── DELETE /api/devices/locations/:id ── */
router.delete('/locations/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menghapus sub-kategori' });
    }
    
    const [lRows] = await db.execute('SELECT * FROM locations WHERE id = ?', [req.params.id]);
    if (lRows.length === 0) return res.status(404).json({ error: 'Sub-kategori tidak ditemukan' });
    
    const loc = lRows[0];
    
    // Check if devices are attached to this location
    const [dRows] = await db.execute('SELECT COUNT(*) as cnt FROM devices WHERE loc_id = ?', [req.params.id]);
    if (dRows[0].cnt > 0) {
      return res.status(400).json({ error: `Tidak dapat menghapus "${loc.nama}" karena masih digunakan oleh ${dRows[0].cnt} perangkat` });
    }

    await db.execute('DELETE FROM locations WHERE id = ?', [req.params.id]);

    logAudit(req.user.username, 'Hapus Sub-Kategori', loc.nama, `ID: ${loc.id}`);
    res.json({ message: 'Sub-kategori / lokasi berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus sub-kategori' });
  }
});

module.exports = router;
