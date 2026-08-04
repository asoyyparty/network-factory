const db = require('../db/database');

/**
 * Mencatat log aktivitas ke dalam tabel audit_logs.
 * @param {string} username - Nama user (atau 'system')
 * @param {string} action - Aksi (contoh: 'Reboot Device', 'User Login')
 * @param {string} target_device - Nama atau ID device target (opsional)
 * @param {string} details - Detail tambahan (opsional)
 */
async function logAudit(username, action, target_device = '', details = '') {
  try {
    const sql = `
      INSERT INTO audit_logs (username, action, target_device, details, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `;
    await db.execute(sql, [
      username || 'system',
      action || 'Unknown Action',
      target_device || '',
      details || ''
    ]);
  } catch (err) {
    console.error('[AuditLog] Gagal menyimpan log audit:', err.message);
  }
}

module.exports = { logAudit };
