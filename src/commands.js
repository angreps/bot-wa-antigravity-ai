const fs = require('fs');
const path = require('path');
const config = require('../config');
const terminal = require('./terminal');
const antigravity = require('./antigravity');
const limits = require('./limits');

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
async function handleMessage(senderPhone, messageText, senderJid, isFromMe = false, options = {}) {
  const text = (messageText || '').trim();
  if (!text) return null;

  const prefix = config.prefix;
  const isOwnerUser = isAuthorized(senderPhone, senderJid, isFromMe);

  // If in Selfbot mode, strictly ignore non-owners silently
  if (!isOwnerUser && isSelfbot) {
    console.log(`[Selfbot Ignored] Pesan dari nomor non-owner (${senderPhone}) diabaikan karena Selfbot Mode aktif.`);
    return null;
  }

  // 1. HELP / MENU
  if (text === `${prefix}help` || text === `${prefix}menu`) {
    let helpText = `🤖 *${config.botName.toUpperCase()}*
_Cloud & Local Server Controller with AI Engine_

💡 *Cara Menggunakan:*
Ketik pertanyaan langsung *tanpa tanda seru* untuk chat dengan AI!

📊 *Info & Kuota:*
• \`${prefix}status\` : Cek RAM, CPU, OS & Uptime server
• \`${prefix}limit\` : Cek sisa kuota chat AI Anda`;

    if (isOwnerUser) {
      helpText += `\n\n👑 *Menu Khusus Owner / Admin:*
🧠 *AI Control:*
• \`${prefix}new\` / \`${prefix}reset\` : Reset percakapan baru
• \`${prefix}model <0-5>\` : Ganti model AI (cth: \`${prefix}model 1\`)
• \`${prefix}stop\` : Batalkan proses AI yang sedang berjalan

💻 *Terminal & Shell:*
• \`${prefix}sh <perintah>\` : Jalankan perintah terminal / shell
• \`${prefix}cd <folder>\` : Pindah folder aktif
• \`${prefix}pwd\` / \`${prefix}ls\` / \`${prefix}cat\` : Manajemen file

🔒 *Pengaturan & Limit User:*
• \`${prefix}selfbot on/off\` : Mode private (hanya balas owner)
• \`${prefix}autoread on/off\` : Otomatis baca chat & hilangkan notif
• \`${prefix}setlimit <nomor> <jumlah>\` : Setel limit harian user
• \`${prefix}addlimit <nomor> <jumlah>\` : Tambah kuota chat user
• \`${prefix}adduser <nomor>\` : Jadikan admin / owner baru`;
    } else {
      helpText += `\n\n_Anda berada dalam mode Pengguna Publik dengan kuota chat harian._`;
    }

    return helpText;
  }

  // 2. CHECK LIMIT (Accessible to everyone)
  if (text === `${prefix}limit` || text === `${prefix}ceklimit`) {
    return limits.getLimitInfo(senderPhone, isOwnerUser);
  }

  // 3. SYSTEM STATUS (Accessible to everyone, sanitized paths in public)
  if (text === `${prefix}status`) {
    const s = terminal.getSystemStatus();
    const busy = antigravity.isAgentBusy() ? '⏳ Sedang Bekerja' : '🟢 Siap (Idle)';
    const model = antigravity.getModel();

    const isGroup = Boolean(senderJid && (senderJid.endsWith('@g.us') || senderJid.includes('@g.us')));
    const showCwd = isOwnerUser && !isGroup && isSelfbot;

    let reply = `📊 *STATUS SERVER & AI*
─────────────────────────
🖥️ *Host:* ${s.hostname}
🐧 *OS:* ${s.os || 'Debian 12'}
⚡ *CPU:* ${s.cpus}
💾 *RAM:* ${s.memory}
⏱️ *Uptime:* ${s.systemUptime}
🤖 *AI Engine:* ${busy}
🎯 *Model Aktif:* ${model}
🔒 *Selfbot:* ${isSelfbot ? 'Aktif (Owner Only)' : 'Nonaktif (Publik)'}
👁️ *Auto-Read:* ${isAutoRead ? 'Aktif' : 'Nonaktif'}`;

    if (showCwd) {
      reply += `\n📁 *Workspace:*\n\`${s.cwd}\``;
    }

    return reply;
  }

  // RESTRICTED COMMANDS (Owner Only)
  if (!isOwnerUser) {
    if (text.startsWith(prefix)) {
      return `⛔ *Akses Terbatas*\nPerintah \`${text.split(' ')[0]}\` hanya dapat dijalankan oleh Administrator/Owner bot.\nKetik \`${prefix}help\` atau langsung kirim pesan biasa untuk chat dengan AI.`;
    }
  }

  // 4. OWNER: UPGRADE / SET LIMIT
  if (text.startsWith(`${prefix}setlimit `)) {
    const parts = text.substring(10).trim().split(/\s+/);
    if (parts.length < 2) return `⚠️ Format salah. Contoh: \`${prefix}setlimit 628123456789 50\``;
    const res = limits.setLimit(parts[0], parts[1]);
    return `✅ *Limit User Berhasil Diubah:*\n• Nomor: *${res.phone}*\n• Max Kuota: *${res.max} chat/hari*\n• Terpakai: ${res.used}`;
  }

  if (text.startsWith(`${prefix}addlimit `)) {
    const parts = text.substring(10).trim().split(/\s+/);
    if (parts.length < 2) return `⚠️ Format salah. Contoh: \`${prefix}addlimit 628123456789 20\``;
    const res = limits.addLimit(parts[0], parts[1]);
    return `✅ *Kuota User Berhasil Ditambahkan:*\n• Nomor: *${res.phone}*\n• Tambahan: +${res.added} chat\n• Total Kuota Baru: *${res.max} chat/hari*`;
  }

  // 5. OWNER: SELFBOT TOGGLE
  if (text === `${prefix}selfbot` || text === `${prefix}selfbot status`) {
    return `🔒 *Status Mode Selfbot:* ${isSelfbot ? '🟢 AKTIF (Hanya merespons Owner)' : '⚪ NONAKTIF (Publik)'}\n\n_Ketik \`${prefix}selfbot on\` atau \`${prefix}selfbot off\` untuk mengubah._`;
  }
  if (text === `${prefix}selfbot on`) {
    setSelfbotMode(true);
    return '🔒 *Mode Selfbot DIAKTIFKAN!* Bot sekarang hanya merespons Owner. Pesan dari orang lain akan diabaikan tanpa balasan.';
  }
  if (text === `${prefix}selfbot off`) {
    setSelfbotMode(false);
    return '🔓 *Mode Selfbot DINONAKTIFKAN!* Mode publik aktif. Orang lain dapat mencoba chat AI dengan sistem kuota harian.';
  }

  // 6. OWNER: AUTOREAD TOGGLE
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

  // 7. OWNER: STOP PROCESS
  if (text === `${prefix}stop` || text === `${prefix}cancel`) {
    const stopped = antigravity.stopActiveProcess();
    if (stopped) {
      return '🛑 *Proses AI berhasil dihentikan!*';
    } else {
      return 'ℹ️ Tidak ada proses AI yang sedang berjalan saat ini.';
    }
  }

  // 8. OWNER: RESET CONVERSATION
  if (text === `${prefix}new` || text === `${prefix}reset`) {
    antigravity.resetConversation();
    return '🧹 *Konteks percakapan direset!* Percakapan baru telah dimulai.';
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

  // 9. OWNER: LIST & SET MODELS
  if (text === `${prefix}models`) {
    return antigravity.getAvailableModelsMenu();
  }
  if (text.startsWith(`${prefix}model `) || text === `${prefix}model`) {
    const m = text.substring(6).trim();
    if (!m) return antigravity.getAvailableModelsMenu();
    const res = antigravity.setModel(m);
    return `✅ *Model AI Disetel:*\n${res.label}\n\n_Untuk kembali ke otomatis, ketik \`${prefix}model 0\`._`;
  }

  // 10. OWNER: ADD AUTHORIZED USER
  if (text.startsWith(`${prefix}adduser `)) {
    const num = text.substring(`${prefix}adduser `.length).trim();
    const added = addAuthorizedUser(num);
    return `✅ Nomor *${added}* telah ditambahkan sebagai pengguna berwenang (Owner/Admin)!`;
  }

  // 11. OWNER: TERMINAL (PWD, CD, LS, CAT, SH)
  if (text === `${prefix}pwd`) {
    return `📁 *Direktori Aktif:*\n\`${terminal.getCwd()}\``;
  }

  if (text.startsWith(`${prefix}cd `) || text === `${prefix}cd`) {
    const target = text.substring(3).trim();
    const res = terminal.setCwd(target || '.');
    if (res.success) {
      return `📁 *Direktori diubah ke:*\n\`${res.cwd}\``;
    } else {
      return `❌ *Gagal pindah folder:*\n${res.error}`;
    }
  }

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

  if (text.startsWith(`${prefix}sh `) || text.startsWith(`${prefix}exec `)) {
    const cmd = text.startsWith(`${prefix}sh `) ? text.substring(4) : text.substring(6);
    if (!cmd.trim()) return '⚠️ Masukkan perintah shell yang ingin dijalankan.';

    const start = Date.now();
    const result = await terminal.executeCommand(cmd);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    let reply = `⚡ *Terminal Execution (${duration}s)*\n\`${terminal.getCwd()}\`\n\n`;
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

  // 12. PROMPT AI (via !ai or regular chat message)
  let promptQuery = text;
  if (text.startsWith(`${prefix}ai `)) {
    promptQuery = text.substring(4).trim();
  } else if (text.startsWith(prefix)) {
    return `❓ Perintah *${text}* tidak dikenal. Ketik \`${prefix}help\` untuk melihat daftar perintah.`;
  }

  // Rate Limiting Check for non-owner
  let limitCheck = null;
  if (!isOwnerUser) {
    limitCheck = limits.checkAndConsume(senderPhone, false);
    if (!limitCheck.allowed) {
      return `⚠️ *Limit Chat AI Anda Habis!*\n\nQuota gratis harian Anda (*${limitCheck.max}/${limitCheck.max} chat*) sudah habis untuk hari ini.\n\n🔄 Quota akan otomatis di-reset besok pukul 00:00 WIB.\n💡 Hubungi Owner bot untuk melakukan *upgrade limit* akun Anda!`;
    }
  }

  // If user quote-replied to a specific message, include quoted context
  if (options && options.quotedText && options.quotedText.trim()) {
    const cleanQuoted = options.quotedText.trim();
    const previewQuoted = cleanQuoted.length > 1500 ? cleanQuoted.substring(0, 1500) + '...' : cleanQuoted;
    promptQuery = `[Konteks Pesan Yang Dikutip / Di-reply oleh Pengguna]:\n"${previewQuoted}"\n\n[Pesan / Tanggapan Pengguna]:\n${promptQuery}`;
  }

  // Send prompt directly to Antigravity CLI
  const result = await antigravity.askAntigravity(promptQuery, {
    cwd: terminal.getCwd(),
  });

  // Attach quota notice for non-owner users
  const quotaNotice = (!isOwnerUser && limitCheck)
    ? `\n\n_🔋 Sisa quota Anda: ${limitCheck.remaining} chat hari ini (Ketik \`${prefix}limit\` untuk cek)._`
    : '';

  if (result.chunks && result.chunks.length > 1) {
    const lastIdx = result.chunks.length - 1;
    result.chunks[lastIdx] += quotaNotice;
    return result.chunks;
  }

  return result.text + quotaNotice;
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
