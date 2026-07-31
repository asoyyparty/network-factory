const { Client } = require('ssh2');

const REBOOT_CMD = {
  mikrotik : '/system reboot',
  linux    : 'reboot',
  openwrt  : 'reboot',
  generic  : 'reboot'
};

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

function setupConn(connCfg, timeoutMs, onFinish, onReady, isTest = false) {
  const conn = new Client();
  let isResolved = false;

  const timer = setTimeout(() => {
    if (!isResolved) {
      conn.destroy();
      onFinish(new Error('SSH connection timeout'));
    }
  }, timeoutMs);

  const finish = (err, result) => {
    if (isResolved) return;
    isResolved = true;
    clearTimeout(timer);
    if (err) onFinish(err);
    else onFinish(null, result);
  };

  conn.on('ready', () => {
    onReady(conn, finish);
  });

  // Handle keyboard-interactive untuk switch yang mewajibkannya
  conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finishInteractive) => {
    const responses = prompts.map(p => {
      const pr = p.prompt.toLowerCase();
      if (pr.includes('password')) return connCfg.password;
      if (pr.includes('user') || pr.includes('login')) return connCfg.username;
      return '';
    });
    finishInteractive(responses);
  });

  conn.on('error', err => {
    if (!isTest && (err.code === 'ECONNRESET' || err.level === 'client-socket' || err.message.includes('timeout') || err.message.includes('reset'))) {
      finish(null, `Reboot command terkirim. Device sedang restart.`);
    } else {
      finish(err);
    }
  });

  conn.connect({
    host        : connCfg.host,
    port        : connCfg.port || 22,
    username    : connCfg.username,
    password    : connCfg.password,
    tryKeyboard : true, // Penting!
    readyTimeout: timeoutMs,
    algorithms  : COMMON_ALGORITHMS
  });
}

function execSSH(connCfg, command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    setupConn(connCfg, timeoutMs, (err, res) => {
      if (err) reject(err); else resolve(res);
    }, (conn, finish) => {
      conn.shell({ term: 'vt100' }, (err, stream) => {
        if (err) {
          // Fallback exec jika shell tidak didukung
          conn.exec(command, (err2, stream2) => {
            if (err2) { conn.end(); return finish(err2); }
            let out = '';
            stream2.on('close', code => { conn.end(); finish(null, out.trim() || `Executed (exit ${code})`); });
            stream2.on('data', d => out += d.toString());
            if (stream2.stderr) stream2.stderr.on('data', d => out += d.toString());
          });
          return;
        }

        let output = '';
        let commandSent = false;
        
        stream.on('data', d => {
          const str = d.toString();
          output += str;
          
          if (!commandSent) {
            if (str.match(/(login|user(name)?)\s*:/i)) {
              stream.write(connCfg.username + '\r\n');
            } else if (str.match(/password\s*:/i)) {
              stream.write(connCfg.password + '\r\n');
            } else if (str.match(/incorrect|failed|invalid|bad/i)) {
              conn.end();
              finish(new Error('Authentication failed (wrong password)'));
            } else if (str.match(/[a-zA-Z0-9_\-]+[#>\]]\s*$/) || str.match(/[#>\]]\s*$/)) {
              // Terdeteksi prompt CLI sukses
              commandSent = true;
              stream.write(command + '\r\n');
              setTimeout(() => { if (stream.writable) stream.write('y\r\n'); }, 500);
            }
          }
        });

        stream.on('close', () => {
          conn.end();
          finish(null, output.trim() || `Command executed`);
        });

        if (stream.stderr) stream.stderr.on('data', d => output += d.toString());
        
        setTimeout(() => { if (!commandSent && stream.writable) stream.write('\r\n'); }, 1000);
      });
    });
  });
}

function testSSH(creds) {
  return new Promise((resolve, reject) => {
    setupConn(creds, 12000, (err, res) => {
      if (err) reject(err); else resolve(res);
    }, (conn, finish) => {
      conn.shell({ term: 'vt100' }, (err, stream) => {
        if (err) {
          conn.end();
          return finish(null, true);
        }

        let isSuccess = false;
        stream.on('data', d => {
          if (isSuccess) return;
          const str = d.toString();
          
          if (str.match(/(login|user(name)?)\s*:/i)) {
            stream.write(creds.username + '\r\n');
          } else if (str.match(/password\s*:/i)) {
            stream.write(creds.password + '\r\n');
          } else if (str.match(/incorrect|failed|invalid|bad|denied/i)) {
            conn.end();
            finish(new Error('Authentication failed (wrong password)'));
          } else if (str.match(/[a-zA-Z0-9_\-]+[#>\]]\s*$/) || str.match(/[#>\]]\s*$/)) {
            isSuccess = true;
            conn.end();
            finish(null, true);
          }
        });

        stream.on('close', () => {
          if (!isSuccess) finish(new Error('Connection closed before authentication completed'));
        });

        setTimeout(() => { if (!isSuccess && stream.writable) stream.write('\r\n'); }, 1000);
        
        setTimeout(() => {
          if (!isSuccess) {
            isSuccess = true;
            conn.end();
            finish(new Error('Koneksi terputus atau prompt tidak merespon (kemungkinan password salah)'));
          }
        }, 3500);
      });
    }, true); // isTest = true
  });
}

async function rebootDevice(creds) {
  const { device_os = 'generic', ...conn } = creds;
  const command = REBOOT_CMD[device_os] || REBOOT_CMD.generic;

  console.log(`[SSH] Reboot ${conn.host} (OS: ${device_os}) → "${command}"`);

  try {
    const result = await execSSH(conn, command, 15000);
    return result || `Reboot command dikirim ke ${conn.host}`;
  } catch (err) {
    if (
      err.message.includes('disconnect') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('timeout') ||
      err.message.includes('reset')
    ) {
      return `Reboot command dikirim ke ${conn.host}. Device sedang restart.`;
    }
    throw new Error(`SSH Error: ${err.message}`);
  }
}

module.exports = { rebootDevice, testSSH };
