const { Client } = require('ssh2');

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
 * Test SSH connection to a Router / AP
 */
function testRouterSSH(router) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        conn.destroy();
        reject(new Error('Koneksi SSH ke router timeout (10s)'));
      }
    }, 10000);

    conn.on('ready', () => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);
      conn.end();
      resolve(true);
    });

    conn.on('error', (err) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);
      reject(new Error(`Gagal terhubung: ${err.message}`));
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
      reject(e);
    }
  });
}

/**
 * Disconnect / Kick a device from a router via SSH.
 * Supports MikroTik RouterOS, OpenWrt, Asuswrt (2.4G & 5G), Linux APs, and Cisco.
 */
function kickDeviceFromRouter(router, macAddress, ipAddress) {
  return new Promise((resolve, reject) => {
    if (!macAddress && !ipAddress) {
      return reject(new Error('MAC Address atau IP Address diperlukan untuk memutus koneksi'));
    }

    const conn = new Client();
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        conn.destroy();
        reject(new Error('Koneksi SSH ke router timeout saat perintah memutus koneksi'));
      }
    }, 15000);

    const macUpper = (macAddress || '').toUpperCase();
    const macLower = (macAddress || '').toLowerCase();

    // Composite universal deauthentication commands across all router platforms
    let commands = [];

    if (macUpper) {
      // 1. Asuswrt / Broadcom Wi-Fi Kick (2.4G eth1 & 5G eth2)
      commands.push(`wl -i eth1 deauthenticate ${macUpper}`);
      commands.push(`wl -i eth2 deauthenticate ${macUpper}`);
      commands.push(`wl deauthenticate ${macUpper}`);
      commands.push(`wl -i eth1 disassoc ${macUpper}`);
      commands.push(`wl -i eth2 disassoc ${macUpper}`);
      commands.push(`wl disassoc ${macUpper}`);

      // 2. OpenWrt / hostapd / iw Kick
      commands.push(`hostapd_cli deauthenticate ${macLower}`);
      commands.push(`hostapd_cli disassociate ${macLower}`);
      commands.push(`iw dev wlan0 station del ${macLower}`);
      commands.push(`iw dev wlan1 station del ${macLower}`);

      // 3. MikroTik RouterOS Kick
      commands.push(`/interface wireless registration-table remove [find mac-address="${macUpper}"]`);
      commands.push(`/interface wifi registration-table remove [find mac-address="${macUpper}"]`);
      commands.push(`/ip hotspot host remove [find mac-address="${macUpper}"]`);
      commands.push(`/ip arp remove [find mac-address="${macUpper}"]`);
    }

    if (ipAddress) {
      commands.push(`arp -d ${ipAddress}`);
      commands.push(`ip neigh del ${ipAddress} dev br0`);
      commands.push(`ip neigh del ${ipAddress} dev br-lan`);
      commands.push(`/ip arp remove [find address="${ipAddress}"]`);
    }

    // Run all commands separated by semi-colons ignoring non-matching errors
    const fullCmd = commands.map(cmd => `${cmd} 2>/dev/null`).join(' ; ') + ' ; echo KICK_SUCCESS';

    conn.on('ready', () => {
      conn.exec(fullCmd, (err, stream) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }
        }

        let output = '';
        stream.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            resolve(`Koneksi perangkat ${macUpper || ipAddress} berhasil diputus dari router ${router.name} (${router.host})`);
          }
        });

        stream.on('data', (d) => { output += d.toString(); });
        if (stream.stderr) stream.stderr.on('data', (d) => { output += d.toString(); });
      });
    });

    conn.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        reject(new Error(`Gagal terhubung ke Router ${router.name}: ${err.message}`));
      }
    });

    try {
      conn.connect({
        host: router.host,
        port: parseInt(router.port) || 22,
        username: router.username,
        password: router.password || '',
        readyTimeout: 12000,
        tryKeyboard: true,
        algorithms: COMMON_ALGORITHMS
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/**
 * Permanent MAC/IP Device Blocking on Router via SSH
 */
function blockDeviceOnRouter(router, macAddress, ipAddress) {
  return new Promise((resolve, reject) => {
    if (!macAddress && !ipAddress) {
      return reject(new Error('MAC Address atau IP Address diperlukan untuk mem-block perangkat'));
    }

    const conn = new Client();
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        conn.destroy();
        reject(new Error('Koneksi SSH ke router timeout saat perintah mem-block perangkat'));
      }
    }, 15000);

    const macUpper = (macAddress || '').toUpperCase();
    const macLower = (macAddress || '').toLowerCase();
    const routerType = (router.router_type || 'mikrotik').toLowerCase();

    let commands = [];

    if (routerType === 'mikrotik') {
      if (macUpper) {
        commands.push(`/ip firewall filter add chain=forward src-mac-address="${macUpper}" action=drop comment="BLOCKED BY APP"`);
        commands.push(`/ip firewall filter add chain=input src-mac-address="${macUpper}" action=drop comment="BLOCKED BY APP"`);
        commands.push(`/interface wireless access-list add mac-address="${macUpper}" authentication=no forwarding=no comment="BLOCKED BY APP"`);
        commands.push(`/interface wifi access-list add mac-address="${macUpper}" action=reject comment="BLOCKED BY APP"`);
        commands.push(`/interface wireless registration-table remove [find mac-address="${macUpper}"]`);
      }
      if (ipAddress) {
        commands.push(`/ip firewall filter add chain=forward src-address="${ipAddress}" action=drop comment="BLOCKED BY APP"`);
        commands.push(`/ip arp remove [find address="${ipAddress}"]`);
      }
    } else {
      // Asuswrt, OpenWrt, Linux AP
      if (macUpper) {
        // Clean existing duplicate rules first
        for (let i = 0; i < 5; i++) {
          commands.push(`ebtables -D INPUT -s ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`ebtables -D FORWARD -s ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D FORWARD -m mac --mac-source ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D INPUT -m mac --mac-source ${macUpper} -j DROP 2>/dev/null || true`);
        }

        // 1. Broadcom / Asuswrt NVRAM Wireless MAC Filter Configuration
        commands.push(`nvram set macfilter_enable_x=2`);
        commands.push(`nvram set wl0_macmode=deny`);
        commands.push(`nvram set wl1_macmode=deny`);
        commands.push(`nvram set wl0_maclist_x="<${macUpper}>"`);
        commands.push(`nvram set wl1_maclist_x="<${macUpper}>"`);

        // 2. Broadcom Wi-Fi Chip Hardware Association Blacklist (eth5 2.4G & eth6 5G)
        commands.push(`wl -i eth5 mac ${macUpper}`);
        commands.push(`wl -i eth5 macmode 2`);
        commands.push(`wl -i eth6 mac ${macUpper}`);
        commands.push(`wl -i eth6 macmode 2`);

        // 3. Layer 2 Ethernet Bridge & Layer 3 Firewall Packet Blocking
        commands.push(`ebtables -I INPUT -s ${macUpper} -j DROP`);
        commands.push(`ebtables -I FORWARD -s ${macUpper} -j DROP`);
        commands.push(`iptables -I FORWARD -m mac --mac-source ${macUpper} -j DROP`);
        commands.push(`iptables -I INPUT -m mac --mac-source ${macUpper} -j DROP`);

        // 4. Wi-Fi Service Reload & Deauthentication
        commands.push(`/sbin/service restart_wireless`);
        commands.push(`wl -i eth5 deauthenticate ${macUpper}`);
        commands.push(`wl -i eth6 deauthenticate ${macUpper}`);
        commands.push(`wl deauthenticate ${macUpper}`);
      }
      if (ipAddress) {
        for (let i = 0; i < 5; i++) {
          commands.push(`iptables -D FORWARD -s ${ipAddress} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D INPUT -s ${ipAddress} -j DROP 2>/dev/null || true`);
        }
        commands.push(`iptables -I FORWARD -s ${ipAddress} -j DROP`);
        commands.push(`iptables -I INPUT -s ${ipAddress} -j DROP`);
        commands.push(`arp -d ${ipAddress}`);
        commands.push(`ip neigh del ${ipAddress} dev br0`);
      }
    }

    const fullCmd = commands.join(' ; ') + ' ; echo BLOCK_SUCCESS';

    conn.on('ready', () => {
      conn.exec(fullCmd, (err, stream) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }
        }

        let output = '';
        stream.on('data', (d) => { output += d.toString(); });
        if (stream.stderr) stream.stderr.on('data', (d) => { output += d.toString(); });

        stream.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            resolve(`Perangkat ${macUpper || ipAddress} BERHASIL DI-BLOCK PERMANEN pada router ${router.name}`);
          }
        });
      });
    });

    conn.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        reject(new Error(`Gagal terhubung ke Router ${router.name}: ${err.message}`));
      }
    });

    try {
      conn.connect({
        host: router.host,
        port: parseInt(router.port) || 22,
        username: router.username,
        password: router.password || '',
        readyTimeout: 12000,
        tryKeyboard: true,
        algorithms: COMMON_ALGORITHMS
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/**
 * Unblock a device on a router via SSH
 */
function unblockDeviceOnRouter(router, macAddress, ipAddress) {
  return new Promise((resolve, reject) => {
    if (!macAddress && !ipAddress) {
      return reject(new Error('MAC Address atau IP Address diperlukan untuk membuka block'));
    }

    const conn = new Client();
    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        conn.destroy();
        reject(new Error('Koneksi SSH ke router timeout saat unblock'));
      }
    }, 15000);

    const macUpper = (macAddress || '').toUpperCase();
    const macLower = (macAddress || '').toLowerCase();
    const routerType = (router.router_type || 'mikrotik').toLowerCase();

    let commands = [];

    if (routerType === 'mikrotik') {
      if (macUpper) {
        commands.push(`/ip firewall filter remove [find comment="BLOCKED BY APP" and src-mac-address="${macUpper}"]`);
        commands.push(`/interface wireless access-list remove [find mac-address="${macUpper}"]`);
        commands.push(`/interface wifi access-list remove [find mac-address="${macUpper}"]`);
      }
      if (ipAddress) {
        commands.push(`/ip firewall filter remove [find comment="BLOCKED BY APP" and src-address="${ipAddress}"]`);
      }
    } else {
      if (macUpper) {
        // 1. Reset Asuswrt NVRAM MAC Filter
        commands.push(`nvram set macfilter_enable_x=0`);
        commands.push(`nvram set wl0_macmode=disabled`);
        commands.push(`nvram set wl1_macmode=disabled`);
        commands.push(`nvram set wl0_maclist_x=""`);
        commands.push(`nvram set wl1_maclist_x=""`);

        // 2. Delete MAC from Broadcom Wi-Fi lists and reset macmode to disabled (0)
        commands.push(`wl -i eth5 mac del ${macUpper}`);
        commands.push(`wl -i eth6 mac del ${macUpper}`);
        commands.push(`wl -i eth5 macmode 0`);
        commands.push(`wl -i eth6 macmode 0`);

        // 3. Purge ALL duplicate ebtables and iptables DROP rules for this MAC
        for (let i = 0; i < 5; i++) {
          commands.push(`ebtables -D INPUT -s ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`ebtables -D FORWARD -s ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D FORWARD -m mac --mac-source ${macUpper} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D INPUT -m mac --mac-source ${macUpper} -j DROP 2>/dev/null || true`);
        }

        // 4. Reload Wireless Daemon
        commands.push(`/sbin/service restart_wireless`);
      }
      if (ipAddress) {
        for (let i = 0; i < 5; i++) {
          commands.push(`iptables -D FORWARD -s ${ipAddress} -j DROP 2>/dev/null || true`);
          commands.push(`iptables -D INPUT -s ${ipAddress} -j DROP 2>/dev/null || true`);
        }
      }
    }

    const fullCmd = commands.map(cmd => `${cmd} 2>/dev/null`).join(' ; ') + ' ; echo UNBLOCK_SUCCESS';

    conn.on('ready', () => {
      conn.exec(fullCmd, (err, stream) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }
        }

        let output = '';
        stream.on('data', (d) => { output += d.toString(); });
        if (stream.stderr) stream.stderr.on('data', (d) => { output += d.toString(); });

        stream.on('close', () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timer);
            conn.end();
            resolve(`Block perangkat ${macUpper || ipAddress} BERHASIL DIBUKA di router ${router.name}`);
          }
        });
      });
    });

    conn.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        reject(new Error(`Gagal terhubung ke Router ${router.name}: ${err.message}`));
      }
    });

    try {
      conn.connect({
        host: router.host,
        port: parseInt(router.port) || 22,
        username: router.username,
        password: router.password || '',
        readyTimeout: 12000,
        tryKeyboard: true,
        algorithms: COMMON_ALGORITHMS
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

module.exports = {
  testRouterSSH,
  kickDeviceFromRouter,
  blockDeviceOnRouter,
  unblockDeviceOnRouter
};
