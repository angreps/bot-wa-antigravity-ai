const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const fs = require('fs');
const config = require('../config');
const commands = require('./commands');
const terminal = require('./terminal');
const embed = require('./embed');

const logger = pino({ level: 'silent' });

// Track message IDs sent by the bot to prevent self-reply loops
const botSentMessageIds = new Set();

// Cache processed incoming message IDs across reconnects to prevent duplicate execution & rollbacks
const processedMessageIds = new Set();

// Cache recent messages for Signal Protocol retry negotiation
const recentMessagesCache = new Map();

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractQuotedText(msg) {
  const contextInfo = msg?.message?.extendedTextMessage?.contextInfo ||
                      msg?.message?.imageMessage?.contextInfo ||
                      msg?.message?.videoMessage?.contextInfo ||
                      msg?.message?.documentMessage?.contextInfo;
  if (!contextInfo?.quotedMessage) return '';
  const q = contextInfo.quotedMessage;
  if (q.conversation) return q.conversation;
  if (q.extendedTextMessage?.text) return q.extendedTextMessage.text;
  if (q.imageMessage?.caption) return q.imageMessage.caption;
  if (q.videoMessage?.caption) return q.videoMessage.caption;
  if (q.documentMessage?.caption) return q.documentMessage.caption;
  return '';
}

async function startWhatsAppBot() {
  if (!fs.existsSync(config.sessionDir)) {
    fs.mkdirSync(config.sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n======================================================`);
  console.log(`🤖 Memulai ${config.botName} (Baileys v${version.join('.')})`);
  console.log(`======================================================\n`);

  // Use makeCacheableSignalKeyStore to prevent Bad MAC and session key corruption
  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !config.usePairingCode,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.windows('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: true,
    getMessage: async (key) => {
      const cached = recentMessagesCache.get(key.id);
      if (cached) return cached;
      return { conversation: '' };
    },
  });

  // Pairing Code Flow (No camera scan required)
  if (config.usePairingCode && !sock.authState.creds.registered) {
    let phoneNumber = config.botNumber || config.owners[0];

    if (!phoneNumber) {
      console.log('📌 Belum ada nomor WhatsApp di konfigurasi .env.');
      phoneNumber = await askQuestion('👉 Masukkan nomor WhatsApp yang akan digunakan (contoh: 6281234567890): ');
    }

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (phoneNumber) {
      commands.addAuthorizedUser(phoneNumber);
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('\n======================================================');
          console.log(`🔑 KODE PAIRING WHATSAPP ANDA: \x1b[1m\x1b[32m${formattedCode}\x1b[0m`);
          console.log('======================================================');
          console.log('📱 Langkah aktivasi di WhatsApp HP Anda:');
          console.log(' 1. Buka aplikasi WhatsApp di HP Anda.');
          console.log(' 2. Buka menu Titik Tiga (Pengaturan) -> Perangkat Tertaut.');
          console.log(' 3. Pilih "Tautkan Perangkat" -> pilih "Tautkan dengan nomor telepon saja".');
          console.log(` 4. Masukkan kode 8 karakter ini: ${formattedCode}`);
          console.log('======================================================\n');
        } catch (err) {
          console.error('❌ Gagal membuat kode pairing:', err.message);
        }
      }, 3000);
    }
  }

  // Save auth credentials automatically
  sock.ev.on('creds.update', saveCreds);

  // Connection state changes
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.usePairingCode) {
      console.log('📷 Scan QR Code berikut dengan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`⚠️ Koneksi terputus (Status: ${statusCode || 'unknown'}).`);
      if (shouldReconnect) {
        console.log('🔄 Mencoba menghubungkan kembali dalam 5 detik...');
        setTimeout(() => startWhatsAppBot(), 5000);
      } else {
        console.log('❌ Anda telah logout dari WhatsApp. Hapus folder session dan restart bot.');
      }
    } else if (connection === 'open') {
      const user = sock.user;
      console.log(`\n======================================================`);
      console.log(`✅ BERHASIL TERHUBUNG KE WHATSAPP!`);
      console.log(`📱 Akun Aktif: ${user?.name || 'WA Bridge'} (${user?.id?.split(':')[0] || 'Unknown'})`);
      console.log(`======================================================`);
      console.log(`💡 Bot siap menerima prompt dan perintah remote Antigravity!`);
      console.log(`======================================================\n`);

      // Send startup notification to owner
      setTimeout(async () => {
        try {
          const sys = terminal.getSystemStatus();
          const notifMsg = embed.createEmbed({
            title: '🟢 *BOT ANTIGRAVITY ONLINE & SIAP*',
            subtitle: 'System Ready',
            body: [
              `🖥️ *Host:* ${sys.hostname}`,
              `📁 *Workspace:* \`${sys.cwd}\``,
              '🤖 *Engine:* Antigravity CLI (Gemini Pro)',
              `🔒 *Mode:* ${commands.getSelfbotMode() ? 'Selfbot (Khusus Owner)' : 'Publik'}`,
              '',
              `💡 Ketik pesan apa saja untuk chat dengan AI atau ketik \`${config.prefix}help\` untuk menu.`,
              `🎮 Ketik \`${config.prefix}game\` untuk membuka Mini App Game WhatsApp!`,
            ].join('\n'),
            footer: 'System Initialized Successfully',
          });

          if (config.primaryOwnerLid) {
            await sock.sendMessage(`${config.primaryOwnerLid}@lid`, { text: notifMsg }).catch(() => {});
          }
          await sock.sendMessage(`${config.primaryOwnerPhone}@s.whatsapp.net`, { text: notifMsg }).catch(() => {});
          console.log(`[Notification] Notifikasi startup berhasil dikirim ke nomor owner!`);
        } catch (e) {
          console.warn(`[Notification] Gagal mengirim notifikasi startup:`, e.message);
        }
      }, 3000);
    }
  });

  // Helper to send reply (single or multiple chunks)
  async function sendReply(jid, replyData, quotedMsg) {
    if (!replyData) return;

    const chunks = Array.isArray(replyData) ? replyData : [replyData];

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      if (!chunkText || !chunkText.trim()) continue;

      try {
        const sent = await sock.sendMessage(jid, { text: chunkText }, { quoted: i === 0 ? quotedMsg : undefined });
        if (sent && sent.key && sent.key.id) {
          botSentMessageIds.add(sent.key.id);
          // Keep set clean
          if (botSentMessageIds.size > 200) {
            const firstItem = botSentMessageIds.values().next().value;
            botSentMessageIds.delete(firstItem);
          }
        }
        if (chunks.length > 1 && i < chunks.length - 1) {
          await sleep(600);
        }
      } catch (err) {
        console.error('Failed to send message chunk:', err.message);
      }
    }
  }

  // Message listener
  sock.ev.on('messages.upsert', async (m) => {
    try {
      // Only process live notifications, ignore backlog/history sync stanzas
      if (m.type !== 'notify') return;

      const incomingList = m.messages || [];
      if (incomingList.length === 0) return;

      // Auto-read incoming messages to dismiss notifications & unread badges on HP
      if (commands.getAutoRead()) {
        const keysToRead = incomingList
          .filter((item) => item.key && !item.key.fromMe)
          .map((item) => item.key);

        if (keysToRead.length > 0) {
          sock.readMessages(keysToRead).catch(() => {});
        }
      }

      const msg = incomingList[0];
      if (!msg || !msg.message) return;

      const messageId = msg.key.id;

      // Prevent duplicate processing of messages already handled (especially on reconnect)
      if (processedMessageIds.has(messageId)) {
        return;
      }
      processedMessageIds.add(messageId);
      if (processedMessageIds.size > 2000) {
        const oldest = processedMessageIds.values().next().value;
        processedMessageIds.delete(oldest);
      }

      // Ignore old messages (e.g. sent before reconnect or > 90 seconds old)
      const nowSec = Math.floor(Date.now() / 1000);
      const msgTimestamp = Number(msg.messageTimestamp) || nowSec;
      if (nowSec - msgTimestamp > 90) {
        return;
      }

      // Cache message for Signal retry handler
      recentMessagesCache.set(messageId, msg.message);
      if (recentMessagesCache.size > 500) {
        const oldestKey = recentMessagesCache.keys().next().value;
        recentMessagesCache.delete(oldestKey);
      }

      // Ignore messages sent by the bot itself
      if (botSentMessageIds.has(messageId)) {
        botSentMessageIds.delete(messageId);
        return;
      }

      // Ignore broadcast or status updates
      const senderJid = msg.key.remoteJid;
      if (!senderJid || senderJid.endsWith('@broadcast') || senderJid.includes('status@broadcast')) return;

      // Extract sender phone number or LID
      const senderPhone = (msg.key.participant || senderJid).split('@')[0].split(':')[0];

      // Extract message content
      let text = '';
      if (msg.message.conversation) {
        text = msg.message.conversation;
      } else if (msg.message.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      } else if (msg.message.imageMessage?.caption) {
        text = msg.message.imageMessage.caption;
      }

      text = (text || '').trim();
      if (!text) return;

      // If message is fromMe, only process if sent to oneself or starts with prefix
      if (msg.key.fromMe) {
        const botUserPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
        const isSelfChat = senderJid.split('@')[0].split(':')[0] === botUserPhone;
        if (!isSelfChat && !text.startsWith(config.prefix)) {
          return;
        }
      }

      console.log(`[WA Incoming] From: ${senderPhone} (${senderJid}) | fromMe: ${Boolean(msg.key.fromMe)} | Text: "${text.substring(0, 50)}"`);

      const isAuthorized = commands.isAuthorized(senderPhone, senderJid, Boolean(msg.key.fromMe));
      const isPublicAllowed = !commands.getSelfbotMode();
      const canProceed = isAuthorized || isPublicAllowed;
      const isLongTask = canProceed && (
        !text.startsWith(config.prefix) ||
        text.startsWith(`${config.prefix}ai `) ||
        (isAuthorized && (
          text.startsWith(`${config.prefix}sh `) ||
          text.startsWith(`${config.prefix}exec `) ||
          text.startsWith(`${config.prefix}new `)
        ))
      );

      let loadingMsg = null;
      let intervalTimer = null;
      const startTime = Date.now();

      if (isLongTask) {
        const preview = text.length > 55 ? text.substring(0, 55) + '...' : text;
        try {
          loadingMsg = await sock.sendMessage(senderJid, {
            text: `⏳ *[Task Berjalan]* Sedang memproses...\n📋 *Task:* _"${preview}"_\n⚡ _Status: Menghubungkan ke Antigravity..._`
          }, { quoted: msg });
          if (loadingMsg?.key?.id) {
            botSentMessageIds.add(loadingMsg.key.id);
          }
        } catch (e) {
          console.warn('[Loading Msg Error]:', e.message);
        }

        if (loadingMsg) {
          let elapsedSec = 0;
          intervalTimer = setInterval(async () => {
            elapsedSec += 4;
            try {
              const editRes = await sock.sendMessage(senderJid, {
                text: `⏳ *[Task Berjalan (${elapsedSec}s)]* Sedang memproses...\n📋 *Task:* _"${preview}"_\n⚡ _Status: AI sedang menganalisis & mengerjakan task..._`,
                edit: loadingMsg.key,
              });
              if (editRes?.key?.id) botSentMessageIds.add(editRes.key.id);
            } catch (_) {}
          }, 4000);
        }
      }

      // Extract quoted text if user replied to an earlier message
      const quotedText = extractQuotedText(msg);

      // Process message through commands router
      const reply = await commands.handleMessage(senderPhone, text, senderJid, Boolean(msg.key.fromMe), { quotedText });

      if (intervalTimer) clearInterval(intervalTimer);

      if (reply) {
        const chunks = Array.isArray(reply) ? reply : [reply];
        console.log(`[WA Outgoing] Replying to ${senderJid} (${chunks.length} chunks)`);

        if (loadingMsg && chunks.length > 0) {
          const firstChunk = chunks[0];
          try {
            const edited = await sock.sendMessage(senderJid, {
              text: firstChunk,
              edit: loadingMsg.key
            });
            if (edited?.key?.id) botSentMessageIds.add(edited.key.id);
            console.log(`[WA Outgoing] Successfully edited loading message in-place for ${senderJid}`);
          } catch (editErr) {
            console.warn('[Edit Failed, sending normal message]:', editErr.message);
            await sendReply(senderJid, firstChunk, msg);
          }

          // Send any remaining chunks sequentially
          for (let i = 1; i < chunks.length; i++) {
            await sleep(600);
            await sock.sendMessage(senderJid, { text: chunks[i] });
          }
        } else {
          await sock.sendPresenceUpdate('composing', senderJid);
          await sleep(200);
          await sock.sendPresenceUpdate('paused', senderJid);
          await sendReply(senderJid, reply, msg);
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  return sock;
}

module.exports = {
  startWhatsAppBot,
};
