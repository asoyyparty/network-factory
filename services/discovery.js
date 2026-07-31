const { Client } = require('ssh2');

/**
 * Connect to MikroTik and fetch ARP entries to discover active devices.
 * Returns an array of objects: { ip, mac, hostName }
 */
async function discoverDevices() {
  return new Promise((resolve, reject) => {
    const host = process.env.MIKROTIK_HOST;
    const username = process.env.MIKROTIK_USER;
    const password = process.env.MIKROTIK_PASS || '';
    const port = parseInt(process.env.MIKROTIK_PORT) || 22;

    if (!host) {
      return reject(new Error('MIKROTIK_HOST belum diatur di .env'));
    }

    const conn = new Client();
    const discovered = [];

    conn.on('ready', () => {
      // Use without-paging to get all results in one chunk without pausing
      conn.exec('/ip arp print detail without-paging', (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let output = '';
        stream.on('close', () => {
          conn.end();
          
          // Parse the MikroTik ARP output
          const lines = output.split('\n');
          for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            const ipMatch = line.match(/address=([^\s]+)/);
            const macMatch = line.match(/mac-address=([^\s]+)/);
            // In ARP, sometimes there's a comment that can serve as a hostname
            const commentMatch = line.match(/comment="([^"]+)"/);

            if (ipMatch && macMatch) {
              discovered.push({
                ip: ipMatch[1],
                mac: macMatch[1].toUpperCase(),
                nama: commentMatch ? commentMatch[1] : `Unknown Device (${ipMatch[1]})`,
                tipe: 'Lainnya' // Default fallback
              });
            }
          }
          
          resolve(discovered);
        }).on('data', (data) => {
          output += data.toString();
        }).stderr.on('data', (data) => {
          // ignore stderr or log it
        });
      });
    }).on('error', (err) => {
      reject(new Error(`Gagal terhubung ke MikroTik: ${err.message}`));
    }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
      if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
        finish([password]);
      } else {
        finish([]);
      }
    });

    try {
      conn.connect({
        host,
        port,
        username,
        password,
        readyTimeout: 15000,
        tryKeyboard: true, // For MikroTik fallback
        algorithms: {
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
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  discoverDevices
};
