const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { rebootDevice, testSSH } = require('../services/sshControl');

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

    res.json({ success: true, message: 'Kredensial SSH disimpan' });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

module.exports = router;
