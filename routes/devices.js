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

module.exports = router;
