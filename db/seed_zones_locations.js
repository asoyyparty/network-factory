/**
 * db/seed_zones_locations.js
 * Inisialisasi tabel zones (Kategori Utama) dan locations (Sub-Kategori/Ruangan)
 * serta seeding data default jika tabel masih kosong.
 */

async function seedZonesAndLocations(pool) {
  // 1. Buat tabel zones jika belum ada
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      zone_key VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(255) NOT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Buat tabel locations jika belum ada
  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id VARCHAR(50) PRIMARY KEY,
      nama VARCHAR(255) NOT NULL,
      zone_key VARCHAR(50) NOT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_locations_zone (zone_key)
    )
  `);

  // 3. Seed data zones jika kosong
  const [zoneCount] = await pool.query('SELECT COUNT(*) as c FROM zones');
  if (zoneCount[0].c === 0) {
    console.log('[DB] Seeding default zones (Kategori Utama)...');
    const defaultZones = [
      ['PRODUKSI', 'Area Produksi Utama', 1],
      ['A', 'Gedung A', 2],
      ['B', 'Gedung B', 3],
      ['C', 'Gedung C', 4],
      ['D', 'Gedung D', 5],
      ['E', 'Gedung E', 6],
      ['F', 'Gedung F', 7],
      ['G', 'Gedung G', 8],
      ['H', 'Gedung H', 9],
      ['I', 'Gedung I', 10],
      ['J', 'Gedung J', 11],
      ['SECURITY', 'Keamanan', 12],
      ['MESS', 'Mess Karyawan', 13],
      ['GUDANG_EKS', 'Gudang Eksternal', 14],
      ['INTI', 'Inti Jaringan', 15],
      ['GUDANG_IT_AREA', 'Area Gudang IT', 16],
      ['MULSA', 'Area Mulsa', 17]
    ];

    for (const [key, label, order] of defaultZones) {
      await pool.query(
        'INSERT IGNORE INTO zones (zone_key, label, sort_order) VALUES (?, ?, ?)',
        [key, label, order]
      );
    }
  }

  // 4. Seed data locations jika kosong
  const [locCount] = await pool.query('SELECT COUNT(*) as c FROM locations');
  if (locCount[0].c === 0) {
    console.log('[DB] Seeding default locations (Sub-Kategori / Ruangan)...');
    const RAW_LOCATIONS = [
      ['LAB SPRAYER','PRODUKSI'],['RUANG UKK','PRODUKSI'],['RUANG ATK','PRODUKSI'],['RUANG BENIH','PRODUKSI'],
      ['LAB LT. 1','PRODUKSI'],['LAB LT. 2','PRODUKSI'],
      ['GEDUNG A1','A'],['GEDUNG A2','A'],['GEDUNG A3','A'],['GEDUNG A3 - OFFICE','A'],
      ['GEDUNG B1 - PROD CF','B'],['GEDUNG B1 - OFFICE GUDANG RMT C12','B'],['GEDUNG B2','B'],['GEDUNG B3 - OFFICE MTC LT. 1','B'],
      ['GEDUNG B3 - MTC LT. 2','B'],['GEDUNG B4 - IF','B'],['GEDUNG B4 - IF OFFICE','B'],['GEDUNG B5 - MP','B'],
      ['GEDUNG C1 - GUDANG RMT MLS','C'],['GEDUNG C2 - PROD MLS','C'],['GEDUNG C2 - OFFICE MLS','C'],
      ['GEDUNG D1 - PROD BOTOL','D'],['GEDUNG D2 - PROD BOTOL','D'],['GEDUNG D2 - OFFICE BOTOL','D'],['GEDUNG D3','D'],
      ['GEDUNG D3 - OFFICE GUDANG RMT BTL','D'],['GEDUNG D4','D'],['GEDUNG D5 - MINI LAB','D'],
      ['GEDUNG E1','E'],['GEDUNG E1 - OFFICE','E'],['GEDUNG E2','E'],['GEDUNG E3','E'],['GEDUNG E3 - OFFICE REAKTOR','E'],
      ['GEDUNG E4','E'],['GEDUNG E5','E'],['GEDUNG E5 - OFFICE PRODUKSI MT','E'],
      ['GEDUNG F1','F'],['GEDUNG F1 - OFFICE GDG RMT','F'],['GEDUNG F2','F'],['GEDUNG F2 - OFFICE GDG RMT','F'],
      ['GEDUNG F3','F'],['GEDUNG F3 - OFFICE GDG RMT','F'],['GEDUNG F4','F'],['GEDUNG F4 - OFFICE PROD FL','F'],
      ['GEDUNG F5','F'],['GEDUNG F5 - OFFICE','F'],
      ['GEDUNG G1','G'],['GEDUNG G2','G'],
      ['GEDUNG H1','H'],['GEDUNG H2','H'],['GEDUNG H2 - OFFICE','H'],['GEDUNG H3','H'],
      ['GEDUNG I1','I'],['GEDUNG I2','I'],['GEDUNG I3','I'],['GEDUNG I3 - OFFICE GDG RMT','I'],['GEDUNG I4','I'],['GEDUNG I5','I'],
      ['GEDUNG J','J'],['GEDUNG J - OFFICE','J'],
      ['POS SECURITY','SECURITY'],
      ['MESS DALAM KABAG','MESS'],['MESS LAES - LAJANG','MESS'],['MESS LAES - KELUARGA','MESS'],
      ['MESS CIKANDE - DEPAN','MESS'],['MESS CIKANDE - BELAKANG','MESS'],
      ['GUDANG RMT LEGOK','GUDANG_EKS'],['GUDANG RMT CEMPLANG','GUDANG_EKS'],
      ['GUDANG IT','INTI'],['KANTOR BARU LT 1','INTI'],['KANTOR BARU LT 2','INTI'],
      ['QC LAB','GUDANG_IT_AREA'],['R&D PES','GUDANG_IT_AREA'],['OFFICE LAB','GUDANG_IT_AREA'],
      ['MUSHOLLA','GUDANG_IT_AREA'],['PRIMAXON','GUDANG_IT_AREA'],['KANTOR R&D PLS','GUDANG_IT_AREA'],
      ['MESIN','E'],['GUDANG BOTOL','D'],['KANTIN ATAS','E'],
      ['KANTOR GUDANG MULSA','MULSA'],['ATAS TANGGAL OFFICE MULSA','MULSA'],
      ['GERBANG PRODUKSI MULSA','MULSA'],['POS SECURITY MULSA','MULSA']
    ];

    for (let i = 0; i < RAW_LOCATIONS.length; i++) {
      const [nama, zoneKey] = RAW_LOCATIONS[i];
      const locId = 'l' + (i + 1);
      await pool.query(
        'INSERT IGNORE INTO locations (id, nama, zone_key, sort_order) VALUES (?, ?, ?, ?)',
        [locId, nama, zoneKey, i + 1]
      );
    }
  }
}

module.exports = seedZonesAndLocations;
