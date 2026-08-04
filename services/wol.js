const dgram = require('dgram');

/**
 * Mengirim Magic Packet Wake-on-LAN ke alamat MAC yang ditentukan.
 * @param {string} macAddress - Contoh: '00:11:22:33:44:55' atau '00-11-22-33-44-55'
 * @returns {Promise<string>}
 */
function wake(macAddress) {
  return new Promise((resolve, reject) => {
    try {
      // Bersihkan MAC dari tanda hubung/titik dua
      const cleanMac = macAddress.replace(/[^0-9A-Fa-f]/g, '');
      if (cleanMac.length !== 12) {
        return reject(new Error('Format MAC Address tidak valid.'));
      }

      // Format Magic Packet: 6 byte 0xFF, diikuti oleh 16 pengulangan MAC Address (total 102 byte)
      const macBuffer = Buffer.from(cleanMac, 'hex');
      const magicPacket = Buffer.alloc(102);
      
      magicPacket.fill(0xff, 0, 6);
      for (let i = 0; i < 16; i++) {
        macBuffer.copy(magicPacket, 6 + (i * 6));
      }

      // Kirim via UDP broadcast port 9
      const socket = dgram.createSocket('udp4');
      socket.once('error', (err) => {
        socket.close();
        reject(err);
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err) => {
          socket.close();
          if (err) return reject(err);
          resolve(`Magic Packet terkirim ke ${macAddress}`);
        });
      });
    } catch (err) {
      reject(new Error(`Gagal mengirim WoL: ${err.message}`));
    }
  });
}

module.exports = { wake };
