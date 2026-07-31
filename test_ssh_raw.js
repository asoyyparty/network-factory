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

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Ready fired! Requesting shell...');
  conn.shell((err, stream) => {
    if (err) {
      console.log('Shell error:', err);
      conn.end();
      return;
    }
    stream.on('close', () => {
      console.log('Stream closed');
      conn.end();
    });
    stream.on('data', d => {
      console.log('STDOUT:', d.toString());
    });
    stream.stderr.on('data', d => {
      console.log('STDERR:', d.toString());
    });
  });
});
conn.on('error', err => {
  console.log('SSH Error:', err.message);
});
conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
  console.log('Keyboard interactive prompted:', prompts);
  finish(['wrongpassword']);
});

console.log('Connecting...');
conn.connect({
  host: '192.168.1.219',
  port: 22,
  username: 'administrator',
  password: 'wrongpassword',
  tryKeyboard: true,
  algorithms: COMMON_ALGORITHMS
});
