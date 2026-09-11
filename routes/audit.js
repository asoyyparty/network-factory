const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

/* ── GET /api/audit — Daftar log audit (Admin Only) ── */
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat melihat log audit' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const search = (req.query.search || '').trim();
    const userFilter = (req.query.username || '').trim();
    const actionFilter = (req.query.action_category || '').trim();

    let sql = 'SELECT id, username, action, target_device, details, created_at FROM audit_logs';
    const whereClauses = [];
    const params = [];

    if (search) {
      whereClauses.push('(username LIKE ? OR action LIKE ? OR target_device LIKE ? OR details LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (userFilter && userFilter !== 'ALL') {
      whereClauses.push('username = ?');
      params.push(userFilter);
    }

    if (actionFilter && actionFilter !== 'ALL') {
      if (actionFilter === 'CRITICAL') {
        whereClauses.push("action IN ('Delete Device', 'Hapus Sub-Kategori', 'Reboot Device', 'Putus Sambungan')");
      } else if (actionFilter === 'DEVICE') {
        whereClauses.push("action IN ('Add Device', 'Bulk Add Devices', 'Delete Device', 'Edit Device', 'Wake on LAN', 'Status Changed')");
      } else if (actionFilter === 'MOVE') {
        whereClauses.push("action IN ('Pindah Perangkat', 'Pindah Lokasi Perangkat')");
      } else if (actionFilter === 'SSH') {
        whereClauses.push("action IN ('Reboot Device', 'Test SSH', 'Update SSH Creds')");
      } else if (actionFilter === 'SYSTEM') {
        whereClauses.push("action IN ('User Login', 'Create User', 'Change Password', 'Hapus Sub-Kategori')");
      }
    }

    if (whereClauses.length > 0) {
      sql += ' WHERE ' + whereClauses.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [logs] = await db.query(sql, params);

    // Global Stats for Telemetry Quad Strip
    const [tRows] = await db.query('SELECT COUNT(*) as total FROM audit_logs');
    const [tdRows] = await db.query('SELECT COUNT(*) as today_count FROM audit_logs WHERE DATE(created_at) = CURDATE()');
    const [cRows] = await db.query("SELECT COUNT(*) as critical_count FROM audit_logs WHERE action IN ('Delete Device', 'Hapus Sub-Kategori', 'Reboot Device', 'Putus Sambungan')");
    const [uRows] = await db.query('SELECT DISTINCT username FROM audit_logs ORDER BY username');

    res.json({
      logs,
      stats: {
        total: tRows[0] ? tRows[0].total : logs.length,
        today: tdRows[0] ? tdRows[0].today_count : 0,
        critical: cRows[0] ? cRows[0].critical_count : 0,
        users: uRows.map(u => u.username)
      }
    });
  } catch (err) {
    console.error('[Audit]', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat audit log' });
  }
});

module.exports = router;
