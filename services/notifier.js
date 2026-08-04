require('dotenv').config();

/**
 * Mengirim pesan teks notifikasi ke Telegram atau Webhook.
 * @param {string} message - Pesan berformat markdown/teks biasa
 */
async function sendAlert(message) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;

  const promises = [];

  // Telegram Notification
  if (telegramToken && telegramChatId) {
    const telegramUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    const p1 = fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    }).catch(err => console.error('[Notifier] Telegram gagal:', err.message));
    promises.push(p1);
  }

  // Generic Webhook Notification (e.g. WhatsApp Gateway)
  if (webhookUrl) {
    const p2 = fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message
      })
    }).catch(err => console.error('[Notifier] Webhook gagal:', err.message));
    promises.push(p2);
  }

  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}

module.exports = { sendAlert };
