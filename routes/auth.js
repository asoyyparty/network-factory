const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');
const authMW  = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

/* ── POST /api/auth/login ─────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username.trim()]);
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Username atau password salah' });

    await db.execute("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      }
    });
    
    logAudit(user.username, 'User Login', 'System', 'Login berhasil');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── POST /api/auth/change-password ──────────────── */
router.post('/change-password', authMW, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password)
      return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];

    if (!bcrypt.compareSync(old_password, user.password_hash))
      return res.status(400).json({ error: 'Password lama salah' });

    const hash = bcrypt.hashSync(new_password, 12);
    await db.execute('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);

    logAudit(req.user.username, 'Change Password', 'System', 'Password berhasil diubah');
    res.json({ message: 'Password berhasil diubah' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/auth/me ─────────────────────────────── */
router.get('/me', authMW, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, username, role, must_change_password, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── GET /api/auth/users  (admin only) ───────────── */
router.get('/users', authMW, async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat melihat daftar user' });
    
    const [users] = await db.execute(
      'SELECT id, username, role, must_change_password, last_login, created_at FROM users ORDER BY id'
    );
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── POST /api/auth/users  (admin only) ──────────── */
router.post('/users', authMW, async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat menambah user' });

    const { username, password, role } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Username sudah digunakan' });

    const hash = bcrypt.hashSync(password, 12);
    const [result] = await db.execute(
      "INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)",
      [username.trim(), hash, role === 'admin' ? 'admin' : 'viewer']
    );

    logAudit(req.user.username, 'Create User', username.trim(), `Role: ${role || 'viewer'}`);
    res.status(201).json({ id: result.insertId, username: username.trim(), role: role || 'viewer' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

/* ── DELETE /api/auth/users/:id  (admin only) ────── */
router.delete('/users/:id', authMW, async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Hanya admin yang dapat menghapus user' });
    if (parseInt(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Tidak bisa menghapus diri sendiri' });

    await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    
    logAudit(req.user.username, 'Delete User', `User ID: ${req.params.id}`, 'User dihapus');
    res.json({ message: 'User dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

module.exports = router;
