/**
 * db/database.js
 * Menggunakan mysql2/promise untuk koneksi asinkron ke MySQL (XAMPP)
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function initializeDB() {
  // 1. Buat database jika belum ada (tanpa menyebutkan database di awal)
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    port: process.env.DB_PORT || 3306,
  });

  const dbName = process.env.DB_NAME || 'factory_network';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  await connection.end();

  // 2. Buat pool koneksi ke database spesifik
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: dbName,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  // 3. Buat tabel-tabel
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'viewer',
      must_change_password BOOLEAN DEFAULT FALSE,
      last_login DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id VARCHAR(50) PRIMARY KEY,
      loc_id VARCHAR(50) NOT NULL,
      nama VARCHAR(255) NOT NULL,
      tipe VARCHAR(50) NOT NULL DEFAULT 'Lainnya',
      merk VARCHAR(255) DEFAULT '',
      ip VARCHAR(100) DEFAULT '',
      mac VARCHAR(50) DEFAULT '',
      status VARCHAR(50) DEFAULT 'Unknown',
      catatan TEXT,
      ssh_user VARCHAR(100) DEFAULT '',
      ssh_pass VARCHAR(255) DEFAULT '',
      ssh_port INT DEFAULT 22,
      device_os VARCHAR(50) DEFAULT 'generic',
      last_seen DATETIME,
      last_ping_ms INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_devices_loc (loc_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ping_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id VARCHAR(50) NOT NULL,
      ip VARCHAR(100) NOT NULL,
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      latency_ms INT,
      pinged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
      INDEX idx_ping_device (device_id),
      INDEX idx_ping_time (pinged_at DESC)
    )
  `);

  // 4. Seed admin user
  const [users] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
  if (users.length === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@1234';
    const hash = bcrypt.hashSync(adminPass, 12);
    await pool.query(`
      INSERT INTO users (username, password_hash, role, must_change_password)
      VALUES (?, ?, 'admin', 1)
    `, ['admin', hash]);
    console.log(`[DB] User admin dibuat. Password default: ${adminPass}`);
    console.log('[DB] PENTING: Harap ganti password saat pertama login!');
  }

  console.log(`[DB] MySQL Terkoneksi ke database: ${dbName}`);
  return pool;
}

const poolPromise = initializeDB().catch(err => {
  console.error('[DB] Gagal inisialisasi database MySQL:', err);
  process.exit(1);
});

// Export wrapper method execute yang memanggil query pada pool
module.exports = {
  execute: async (sql, params) => {
    const pool = await poolPromise;
    return pool.execute(sql, params);
  },
  query: async (sql, params) => {
    const pool = await poolPromise;
    return pool.query(sql, params);
  }
};
