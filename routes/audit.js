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
    const search = req.query.search || '';

    let sql = 'SELECT id, username, action, target_device, details, created_at FROM audit_logs';
    const params = [];

    if (search) {
      sql += ' WHERE username LIKE ? OR action LIKE ? OR target_device LIKE ? OR details LIKE ?';
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [logs] = await db.query(sql, params);
    res.json({ logs });
  } catch (err) {
    console.error('[Audit]', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat memuat audit log' });
  }
});

module.exports = router;
