const fs = require('fs');
const path = require('path');
const config = require('../config');
const terminal = require('./terminal');
const antigravity = require('./antigravity');

// Allow dynamically added owners
const authorizedUsers = new Set(config.owners);
let isSelfbot = config.selfbotMode;
let isAutoRead = config.autoRead;

function setAutoRead(enabled) {
  isAutoRead = Boolean(enabled);
  config.autoRead = isAutoRead;
  return isAutoRead;
}

function getAutoRead() {
  return isAutoRead;
}

function isAuthorized(senderPhone, senderJid, isFromMe) {
  if (isFromMe) return true;
  if (authorizedUsers.size === 0) return true;

  // Check phone variants
  const variants = config.extractVariants(senderPhone);
  for (const v of variants) {
    if (authorizedUsers.has(v)) return true;
  }

  // Check senderJid numbers
  const jidNum = (senderJid || '').split('@')[0].split(':')[0];
  const jidVariants = config.extractVariants(jidNum);
  for (const v of jidVariants) {
    if (authorizedUsers.has(v)) return true;
  }

  return false;
}

function addAuthorizedUser(phone) {
  const variants = config.extractVariants(phone);
  variants.forEach(v => authorizedUsers.add(v));
  return variants[0] || phone;
}

function setSelfbotMode(enabled) {
  isSelfbot = Boolean(enabled);
  return isSelfbot;
}

function getSelfbotMode() {
  return isSelfbot;
}

/**
 * Handle incoming WhatsApp message
 * @param {string} senderPhone
 * @param {string} messageText
 * @param {string} senderJid
 * @param {boolean} isFromMe
 * @returns {Promise<string|string[]|null>}
 */
async function handleMessage(senderPhone, messageText, senderJid, isFromMe = false) {
  const text = (messageText || '').trim();
  if (!text) return null;

  // Authorization check
  if (!isAuthorized(senderPhone, senderJid, isFromMe)) {
    // If in selfbot mode, completely ignore strangers (silent drop)
    if (isSelfbot) {
      console.log(`[Selfbot Ignored] Pesan dari nomor tak dikenal (${senderPhone}) diabaikan.`);
      return null;
    }
    return '⛔ *Akses Ditolak*\nNomor Anda belum terdaftar sebagai pemilik laptop / bot ini.\nHubungi administrator untuk menambahkan nomor Anda.';
  }

  const prefix = config.prefix;

  // 1. HELP / MENU
  if (text === `${prefix}help` || text === `${prefix}menu`) {
    return `🤖 *${config.botName.toUpperCase()}*
_Bridge WhatsApp ➔ Antigravity Laptop & Terminal_

💡 *Cara Menggunakan:*
Kirim pesan teks biasa *tanpa tanda seru* untuk langsung berinteraksi dengan AI Antigravity di laptop Anda!

🧠 *Kontrol AI Antigravity:*
• \`${prefix}new\` / \`${prefix}reset\` : Mulai percakapan baru (reset konteks)
• \`${prefix}models\` : Cek daftar model AI yang tersedia di laptop
• \`${prefix}model <nama>\` : Ganti model (cth: \`gemini-3.1-pro-high\`)
• \`${prefix}stop\` : Batalkan proses AI yang sedang berjalan

💻 *Terminal & PowerShell:*
• \`${prefix}sh <perintah>\` : Jalankan PowerShell langsung di laptop
• \`${prefix}cd <folder>\` : Pindah folder kerja aktif
• \`${prefix}pwd\` : Cek path folder aktif saat ini
• \`${prefix}ls\` : Lihat daftar file di folder aktif
• \`${prefix}cat <file>\` : Baca isi file
• \`${prefix}status\` : Cek RAM, CPU, Uptime laptop

🔒 *Keamanan & Pengaturan:*
• \`${prefix}selfbot on/off\` : Mode selfbot (hanya balas owner)
• \`${prefix}autoread on/off\` : Otomatis baca pesan & hilangkan notif HP
• \`${prefix}adduser <nomor>\` : Beri akses admin ke nomor lain`;
  }

  // 2. SELFBOT TOGGLE
  if (text === `${prefix}selfbot` || text === `${prefix}selfbot status`) {
    return `🔒 *Status Mode Selfbot:* ${isSelfbot ? '🟢 AKTIF (Hanya merespons Owner)' : '⚪ NONAKTIF (Publik)'}\n\n_Ketik \`${prefix}selfbot on\` atau \`${prefix}selfbot off\` untuk mengubah._`;
  }
  if (text === `${prefix}selfbot on`) {
    setSelfbotMode(true);
    return '🔒 *Mode Selfbot DIAKTIFKAN!* Bot sekarang hanya merespons Owner. Pesan dari orang lain akan diabaikan tanpa balasan.';
  }
  if (text === `${prefix}selfbot off`) {
    setSelfbotMode(false);
    return '🔓 *Mode Selfbot DINONAKTIFKAN!* Bot sekarang akan merespons pesan publik (menolak akses non-owner).';
  }

  // 2b. AUTOREAD TOGGLE
  if (text === `${prefix}autoread` || text === `${prefix}autoread status`) {
    return `👁️ *Status Auto-Read:* ${isAutoRead ? '🟢 AKTIF (Otomatis baca pesan & hilangkan notif HP)' : '⚪ NONAKTIF'}\n\n_Ketik \`${prefix}autoread on\` atau \`${prefix}autoread off\` untuk mengubah._`;
  }
  if (text === `${prefix}autoread on`) {
    setAutoRead(true);
    return '👁️ *Auto-Read DIAKTIFKAN!* Semua pesan masuk akan langsung ditandai terbaca (centang biru) sehingga notifikasi tidak menumpuk di HP.';
  }
  if (text === `${prefix}autoread off`) {
    setAutoRead(false);
    return '👁️ *Auto-Read DINONAKTIFKAN!* Pesan masuk tidak akan otomatis ditandai terbaca.';
  }

  // 3. SYSTEM STATUS
  if (text === `${prefix}status`) {
    const s = terminal.getSystemStatus();
    const busy = antigravity.isAgentBusy() ? '⏳ Sedang Bekerja' : '🟢 Siap (Idle)';
    const model = antigravity.getModel();

    return `📊 *STATUS LAPTOP & ANTIGRAVITY*
─────────────────────────
🖥️ *Host:* ${s.hostname}
🐧 *OS:* ${s.os || 'Debian 12'}
⚡ *CPU:* ${s.cpus}
💾 *RAM:* ${s.memory}
⏱️ *Uptime:* ${s.systemUptime}
🤖 *Antigravity:* ${busy}
🎯 *Model Aktif:* ${model}
🔒 *Selfbot:* ${isSelfbot ? 'Aktif (Owner Only)' : 'Nonaktif'}
👁️ *Auto-Read:* ${isAutoRead ? 'Aktif (Notif HP Dibersihkan)' : 'Nonaktif'}
📁 *Direktori Aktif:*
\`${s.cwd}\``;
  }

  // 4. STOP / CANCEL PROCESS
  if (text === `${prefix}stop` || text === `${prefix}cancel`) {
    const stopped = antigravity.stopActiveProcess();
    if (stopped) {
      return '🛑 *Proses Antigravity berhasil dihentikan!*';
    } else {
      return 'ℹ️ Tidak ada proses Antigravity yang sedang berjalan saat ini.';
    }
  }

  // 5. RESET CONVERSATION
  if (text === `${prefix}new` || text === `${prefix}reset`) {
    antigravity.resetConversation();
    return '🧹 *Konteks percakapan direset!* Percakapan baru dengan Antigravity telah dimulai.';
  }
  if (text.startsWith(`${prefix}new `)) {
    antigravity.resetConversation();
    const initialPrompt = text.substring(`${prefix}new `.length).trim();
    if (initialPrompt) {
      const res = await antigravity.askAntigravity(initialPrompt, { cwd: terminal.getCwd() });
      if (res.chunks && res.chunks.length > 1) return res.chunks;
      return res.text;
    }
    return '🧹 *Konteks percakapan direset!* Silakan kirim pesan berikutnya.';
  }

  // 6. LIST MODELS
  if (text === `${prefix}models`) {
    return antigravity.getAvailableModelsMenu();
  }

  // 7. SET MODEL
  if (text.startsWith(`${prefix}model `) || text === `${prefix}model`) {
    const m = text.substring(6).trim();
    if (!m) return antigravity.getAvailableModelsMenu();
    const res = antigravity.setModel(m);
    return `✅ *Model AI Disetel:*\n${res.label}\n\n_Untuk kembali ke otomatis, ketik \`${prefix}model 0\`._`;
  }

  // 8. ADD AUTHORIZED USER
  if (text.startsWith(`${prefix}adduser `)) {
    const num = text.substring(`${prefix}adduser `.length).trim();
    const added = addAuthorizedUser(num);
    return `✅ Nomor *${added}* telah ditambahkan sebagai pengguna berwenang!`;
  }

  // 9. TERMINAL: PWD
  if (text === `${prefix}pwd`) {
    return `📁 *Direktori Aktif:*\n\`${terminal.getCwd()}\``;
  }

  // 10. TERMINAL: CD
  if (text.startsWith(`${prefix}cd `) || text === `${prefix}cd`) {
    const target = text.substring(3).trim();
    const res = terminal.setCwd(target || '.');
    if (res.success) {
      return `📁 *Direktori diubah ke:*\n\`${res.cwd}\``;
    } else {
      return `❌ *Gagal pindah folder:*\n${res.error}`;
    }
  }

  // 11. TERMINAL: LS / DIR
  if (text === `${prefix}ls` || text === `${prefix}dir`) {
    const cwd = terminal.getCwd();
    try {
      const files = fs.readdirSync(cwd);
      if (files.length === 0) return `📁 *Folder Kosong:* \`${cwd}\``;

      const fileList = files.slice(0, 35).map(f => {
        const full = path.join(cwd, f);
        try {
          const isDir = fs.statSync(full).isDirectory();
          return `${isDir ? '📁' : '📄'} ${f}`;
        } catch {
          return `❓ ${f}`;
        }
      }).join('\n');

      const extra = files.length > 35 ? `\n\n_...dan ${files.length - 35} file lainnya_` : '';
      return `📂 *Daftar File di* \`${cwd}\`:\n\n${fileList}${extra}`;
    } catch (err) {
      return `❌ *Gagal membaca folder:* ${err.message}`;
    }
  }

  // 12. TERMINAL: CAT / READ FILE
  if (text.startsWith(`${prefix}cat `)) {
    const fileName = text.substring(`${prefix}cat `.length).trim();
    const filePath = path.resolve(terminal.getCwd(), fileName);
    try {
      if (!fs.existsSync(filePath)) return `❌ File tidak ditemukan: \`${fileName}\``;
      const content = fs.readFileSync(filePath, 'utf8');
      const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n\n...[Isi dipotong]' : content;
      return `📄 *Isi File \`${fileName}\`:*\n\`\`\`\n${truncated}\n\`\`\``;
    } catch (err) {
      return `❌ Gagal membaca file: ${err.message}`;
    }
  }

  // 13. TERMINAL: RUN SHELL / EXEC
  if (text.startsWith(`${prefix}sh `) || text.startsWith(`${prefix}exec `)) {
    const cmd = text.startsWith(`${prefix}sh `) ? text.substring(4) : text.substring(6);
    if (!cmd.trim()) return '⚠️ Masukkan perintah PowerShell yang ingin dijalankan.';

    const start = Date.now();
    const result = await terminal.executeCommand(cmd);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    let reply = `⚡ *PowerShell Execution (${duration}s)*\n\`${terminal.getCwd()}\`\n\n`;
    if (result.stdout) {
      reply += `*STDOUT:*\n\`\`\`\n${result.stdout}\n\`\`\`\n`;
    }
    if (result.stderr) {
      reply += `*STDERR:*\n\`\`\`\n${result.stderr}\n\`\`\`\n`;
    }
    if (!result.stdout && !result.stderr) {
      reply += `_Perintah selesai tanpa output (Exit Code: ${result.exitCode})_`;
    }
    return reply;
  }

  // 14. PROMPT ANTIGRAVITY (via !ai or regular chat message)
  let promptQuery = text;
  if (text.startsWith(`${prefix}ai `)) {
    promptQuery = text.substring(4).trim();
  } else if (text.startsWith(prefix)) {
    return `❓ Perintah *${text}* tidak dikenal. Ketik \`${prefix}help\` untuk melihat daftar perintah.`;
  }

  // Send prompt directly to Antigravity CLI on the laptop
  const result = await antigravity.askAntigravity(promptQuery, {
    cwd: terminal.getCwd(),
  });

  // Result chunks (supports long responses)
  if (result.chunks && result.chunks.length > 1) {
    return result.chunks;
  }

  return result.text;
}

module.exports = {
  handleMessage,
  isAuthorized,
  addAuthorizedUser,
  setSelfbotMode,
  getSelfbotMode,
  setAutoRead,
  getAutoRead,
};
