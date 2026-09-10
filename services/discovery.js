require('dotenv').config();
const { Client } = require('ssh2');
const db = require('../db/database');

const COMMON_ALGORITHMS = {
  kex: [
    'diffie-hellman-group1-sha1',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group-exchange-sha256',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'curve25519-sha256',
    'curve25519-sha256@libssh.org'
  ],
  cipher: [
    'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
    'aes128-gcm', 'aes128-gcm@openssh.com',
    'aes256-gcm', 'aes256-gcm@openssh.com',
    'aes128-cbc', 'aes192-cbc', 'aes256-cbc',
    '3des-cbc'
  ],
  serverHostKey: [
    'ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
    'ssh-ed25519'
  ]
};

/**
 * Scan ARP & Connected Wireless Clients (2.4GHz & 5GHz) from a single router / AP via SSH.
 * Filters out wired LAN devices when wireless client registration data is available.
 */
function scanSingleRouter(router) {
  return new Promise((resolve) => {
    const conn = new Client();
    const discovered = [];
    const seenIps = new Set();
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        conn.destroy();
        console.warn(`[Discovery] Timeout scanning router ${router.name || router.host}`);
        resolve([]);
      }
    }, 12000);

    // Multi-platform command sequence fetching wireless station list (2.4G & 5G) + ARP table
    const cmd = [
      'ping -c 1 -W 1 192.168.6.255 2>/dev/null || true',
      'echo ___BAND_2.4G___',
      'wl -i eth5 assoclist 2>/dev/null',
      'wl -i eth1 assoclist 2>/dev/null',
      'wl -i wlan0 assoclist 2>/dev/null',
      'echo ___BAND_5G___',
      'wl -i eth6 assoclist 2>/dev/null',
      'wl -i eth2 assoclist 2>/dev/null',
      'wl -i wlan1 assoclist 2>/dev/null',
      'echo ___MIKROTIK_WIFI___',
      '/interface wireless registration-table print detail without-paging 2>/dev/null',
      '/interface wifi registration-table print detail without-paging 2>/dev/null',
      'echo ___ARP_TABLE___',
      'cat /proc/net/arp 2>/dev/null',
      '/ip arp print detail without-paging 2>/dev/null',
      'ip neigh 2>/dev/null'
    ].join(' ; ');

    conn.on('ready', () => {
      conn.exec(cmd, async (err, stream) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            resolve([]);
          }
          return;
        }

        let output = '';
        stream.on('close', async () => {
          if (isResolved) return;
          isResolved = true;
          clearTimeout(timer);
          conn.end();

          const wifiMap = new Map(); // MAC -> '2.4GHz' | '5GHz'
          const arpCandidates = [];
          let currentSection = 'UNKNOWN';

          const lines = output.split('\n');
          for (let line of lines) {
            line = line.trim();
            if (!line || line.includes('not found') || line.includes('IP address') || line.includes('HW type')) continue;

            if (line.includes('___BAND_2.4G___')) { currentSection = '2.4G'; continue; }
            if (line.includes('___BAND_5G___')) { currentSection = '5G'; continue; }
            if (line.includes('___MIKROTIK_WIFI___')) { currentSection = 'MIKROTIK'; continue; }
            if (line.includes('___ARP_TABLE___')) { currentSection = 'ARP'; continue; }

            // Extract 2.4G & 5G Wi-Fi Station MACs
            if (currentSection === '2.4G' || currentSection === '5G') {
              if (line.startsWith('assoclist')) {
                const parts = line.split(/\s+/);
                if (parts[1] && parts[1].match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)) {
                  wifiMap.set(parts[1].toUpperCase(), currentSection === '2.4G' ? '2.4GHz' : '5GHz');
                }
              }
            } else if (currentSection === 'MIKROTIK') {
              const macMatch = line.match(/mac-address=([^\s]+)/);
              const interfaceMatch = line.match(/interface=([^\s]+)/);
              if (macMatch) {
                const mac = macMatch[1].toUpperCase();
                const iface = interfaceMatch ? interfaceMatch[1].toLowerCase() : '';
                const band = (iface.includes('5g') || iface.includes('wlan2') || iface.includes('wifi2')) ? '5GHz' : '2.4GHz';
                wifiMap.set(mac, band);
              }
            }

            // Parse ARP table entries
            if (currentSection === 'ARP' || currentSection === 'UNKNOWN') {
              let ip = null;
              let mac = null;
              let comment = null;

              // 1. MikroTik RouterOS format parser
              const ipMatch = line.match(/address=([^\s]+)/);
              const macMatch = line.match(/mac-address=([^\s]+)/);
              const commentMatch = line.match(/comment="([^"]+)"/);

              if (ipMatch) ip = ipMatch[1];
              if (macMatch) mac = macMatch[1].toUpperCase();
              if (commentMatch) comment = commentMatch[1];

              // 2. Linux /proc/net/arp & arp -n format parser
              if (!ip || !mac) {
                const parts = line.split(/\s+/);
                const foundIp = parts.find(p => p.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/));
                const foundMac = parts.find(p => p.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/));

                if (foundIp) ip = foundIp;
                if (foundMac) mac = foundMac.toUpperCase();
              }

              // 3. Cisco / Generic arp -a format parser
              if (!ip || !mac) {
                const arpAMatch = line.match(/\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)\s+at\s+([0-9A-Fa-f:]{17})/i);
                if (arpAMatch) {
                  ip = arpAMatch[1];
                  mac = arpAMatch[2].toUpperCase();
                }
              }

              if (ip && mac && mac !== '00:00:00:00:00:00') {
                arpCandidates.push({ ip, mac, comment });
              }
            }
          }

          // Fetch blocked MACs & registered devices from DB for IP enrichment
          let blockedMacSet = new Set();
          const dbMacToIp = new Map();
          try {
            const [blockedRows] = await db.query('SELECT mac FROM blocked_devices');
            blockedMacSet = new Set(blockedRows.map(b => (b.mac || '').toUpperCase()));

            const [deviceRows] = await db.query('SELECT mac, ip, nama FROM devices');
            deviceRows.forEach(d => {
              if (d.mac && d.ip) dbMacToIp.set(d.mac.toUpperCase(), d.ip);
            });
          } catch(e) {}

          // Also parse nvram custom_clientlist for Asuswrt IP mappings if present
          const customClientlistMatch = output.match(/<[^>]+>([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})>([0-9.]+)/g);
          if (customClientlistMatch) {
            for (const item of customClientlistMatch) {
              const m = item.match(/([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})>([0-9.]+)/);
              if (m) dbMacToIp.set(m[1].toUpperCase(), m[2]);
            }
          }

          // Filter out infrastructure IPs (router host itself, default gateways like 192.168.6.254)
          const infraIps = new Set([
            router.host,
            '192.168.6.254',
            '192.168.6.1',
            '192.168.0.254',
            '192.168.0.1',
            '192.168.1.254',
            '192.168.1.1'
          ]);

          console.log(`[Discovery] Router ${router.name || router.host}: Found ${wifiMap.size} WPA/WPA2 Wi-Fi stations (2.4G/5G). Blocked count: ${blockedMacSet.size}`);

          const seenMacs = new Set();

          // 1. Process all active connected clients from ARP & neighbor tables (Wi-Fi and LAN)
          arpCandidates.forEach(item => {
            if (infraIps.has(item.ip)) return; // Exclude gateways & infrastructure

            const isBlocked = blockedMacSet.has(item.mac);
            const wifiBand = wifiMap.get(item.mac);

            if (!isBlocked && !seenIps.has(item.ip)) {
              seenIps.add(item.ip);
              seenMacs.add(item.mac);
              discovered.push({
                ip: item.ip,
                mac: item.mac,
                nama: item.comment || `Perangkat (${item.ip})`,
                tipe: 'Lainnya',
                band: wifiBand ? wifiBand : 'LAN',
                router_name: router.name || router.host,
                router_id: router.id || null
              });
            }
          });

          // 2. Include any active WPA/WPA2 Wi-Fi station in assoclist whose ARP is not yet populated
          wifiMap.forEach((band, mac) => {
            if (!seenMacs.has(mac) && !blockedMacSet.has(mac)) {
              seenMacs.add(mac);
              const resolvedIp = dbMacToIp.get(mac) || '—';
              discovered.push({
                ip: resolvedIp,
                mac: mac,
                nama: resolvedIp !== '—' ? `Perangkat (${resolvedIp})` : `Perangkat Wi-Fi (${mac})`,
                tipe: 'Lainnya',
                band: band,
                router_name: router.name || router.host,
                router_id: router.id || null
              });
            }
          });

          resolve(discovered);
        }).on('data', (data) => {
          output += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        console.warn(`[Discovery] Error scanning ${router.name || router.host}: ${err.message}`);
        resolve([]);
      }
    });

    try {
      conn.connect({
        host: router.host,
        port: parseInt(router.port) || 22,
        username: router.username,
        password: router.password || '',
        readyTimeout: 10000,
        tryKeyboard: true,
        algorithms: COMMON_ALGORITHMS
      });
    } catch (e) {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

/**
 * Scan all active routers in parallel and return aggregated results
 */
async function discoverDevices() {
  try {
    const [routers] = await db.execute('SELECT * FROM routers ORDER BY id');
    
    let targetRouters = routers;

    // Fallback to .env if DB table has no routers
    if (!targetRouters || targetRouters.length === 0) {
      if (process.env.MIKROTIK_HOST) {
        targetRouters = [{
          id: 1,
          name: 'Router Utama',
          host: process.env.MIKROTIK_HOST,
          port: parseInt(process.env.MIKROTIK_PORT) || 22,
          username: process.env.MIKROTIK_USER || 'admin',
          password: process.env.MIKROTIK_PASS || '',
          router_type: 'mikrotik'
        }];
      } else {
        throw new Error('Belum ada Router / AP terdaftar untuk dipindai');
      }
    }

    console.log(`[Discovery] Memindai ${targetRouters.length} router/AP...`);

    const scanPromises = targetRouters.map(r => scanSingleRouter(r));
    const resultsArray = await Promise.all(scanPromises);

    // Flatten and deduplicate by IP + MAC
    const allDiscovered = [];
    const seenMap = new Set();

    resultsArray.forEach(list => {
      list.forEach(item => {
        const key = `${item.ip}_${item.mac}`;
        if (!seenMap.has(key)) {
          seenMap.add(key);
          allDiscovered.push(item);
        }
      });
    });

    console.log(`[Discovery] Pemindaian selesai: ${allDiscovered.length} perangkat ditemukan dari ${targetRouters.length} router.`);
    return allDiscovered;

  } catch (err) {
    console.error('[Discovery Error]', err.message);
    throw err;
  }
}

async function discoverRouterClients(routerId) {
  const [rows] = await db.execute('SELECT * FROM routers WHERE id = ?', [routerId]);
  if (rows.length === 0) throw new Error('Router tidak ditemukan');
  return await scanSingleRouter(rows[0]);
}

module.exports = {
  discoverDevices,
  scanSingleRouter,
  discoverRouterClients
};
