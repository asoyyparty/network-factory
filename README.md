# Factory Network Control System

Aplikasi monitoring & kontrol perangkat jaringan pabrik berbasis web (LAN).

## Cara Menjalankan

```bash
# 1. Install dependencies (sekali saja)
npm install

# 2. Jalankan server
npm start

# 3. Buka di browser
http://localhost:3000
# atau dari perangkat lain di LAN:
http://[ip-komputer-server]:3000
```

## Login Default

| Username | Password | Keterangan |
|---|---|---|
| `admin` | `Admin@1234` | Wajib diganti saat pertama login |

## Konfigurasi (.env)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP server |
| `JWT_SECRET` | - | **Ganti dengan string acak yang panjang!** |
| `PING_INTERVAL_MS` | `30000` | Interval ping scheduler (ms) |
| `PING_HISTORY_DAYS` | `7` | Berapa hari history ping disimpan |

## Fitur

- ✅ **Topologi jaringan visual** — SVG interaktif, pan & zoom
- ✅ **Login & autentikasi** — JWT, role admin/viewer
- ✅ **Inventaris perangkat** — CRUD per lokasi/gedung
- ✅ **Monitoring realtime** — ping otomatis tiap 30 detik via WebSocket
- ✅ **Ping on-demand** — tombol ping langsung per device
- ✅ **Riwayat ping** — chart latency per device (Chart.js)
- ✅ **Reboot via SSH** — mendukung MikroTik, Linux, OpenWRT
- ✅ **Notifikasi** — toast notification saat status berubah

## Struktur File

```
topology/
├── server.js              ← Entry point
├── package.json
├── .env                   ← Konfigurasi (rahasia)
├── db/database.js         ← SQLite (built-in Node v22)
├── middleware/auth.js     ← JWT middleware
├── routes/
│   ├── auth.js            ← Login, change-password, user management
│   ├── devices.js         ← CRUD perangkat
│   ├── ping.js            ← Ping on-demand & history
│   └── control.js         ← SSH reboot
├── services/
│   ├── pingScheduler.js   ← Auto-ping + WebSocket broadcast
│   └── sshControl.js      ← SSH execution
├── data/network.db        ← Database SQLite (auto-created)
└── public/
    ├── index.html         ← Aplikasi utama
    ├── login.html         ← Halaman login
    └── assets/
        ├── app.js         ← Frontend JavaScript
        └── style.css      ← CSS tambahan
```

## Requirement

- **Node.js v22.5.0 atau lebih baru** (untuk built-in `node:sqlite`)
- Jaringan LAN (server harus bisa diakses oleh semua device target ping)
- Untuk fitur SSH reboot: device target harus bisa diakses via SSH dari server
