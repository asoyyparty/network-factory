const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Ready fired!');
  conn.end();
});
conn.on('error', err => {
  console.log('SSH Error:', err.message);
});
conn.connect({
  host: 'test.rebex.net',
  port: 22,
  username: 'demo',
  password: 'wrongpassword' // correct is password
});
