const fs = require('fs');
const path = require('path');
const config = require('../config');
const terminal = require('./terminal');
const antigravity = require('./antigravity');
const limits = require('./limits');
const embed = require('./embed');
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
    const fields = [
      {
        title: '💡 Cara Menggunakan',
        value: 'Ketik pesan apa saja secara langsung tanpa prefix untuk berdiskusi atau meminta bantuan koding & analisis file!',
      },
      {
        title: '📊 Info & Hiburan',
        value: [
          `• \`${prefix}status\` : Status server, CPU, RAM, & Uptime`,
          `• \`${prefix}limit\` : Cek kuota harian chat akun Anda`,
        ].join('\n'),
      },
    ];

    if (isOwnerUser) {
      fields.push(
        {
          title: '🧠 AI Controller (Owner)',
          value: [
            `• \`${prefix}new\` / \`${prefix}reset\` : Bersihkan konteks & mulai sesi baru`,
            `• \`${prefix}model <0-5>\` : Ganti model AI aktif`,
            `• \`${prefix}models\` : Lihat daftar model AI tersedia`,
            `• \`${prefix}stop\` : Batalkan proses task AI yang berjalan`,
          ].join('\n'),
        },
        {
          title: '💻 Terminal & Shell (Owner)',
          value: [
            `• \`${prefix}sh <perintah>\` : Jalankan perintah terminal`,
            `• \`${prefix}cd <folder>\` / \`${prefix}pwd\` : Navigasi folder`,
            `• \`${prefix}ls\` / \`${prefix}cat <file>\` : Manajemen file`,
          ].join('\n'),
        },
        {
          title: '🔒 Pengaturan & Limit (Owner)',
          value: [
            `• \`${prefix}selfbot on/off\` : Mode privat (hanya balas owner)`,
            `• \`${prefix}autoread on/off\` : Otomatis baca chat masuk`,
            `• \`${prefix}setlimit / addlimit\` : Atur kuota user publik`,
            `• \`${prefix}adduser <nomor>\` : Tambah owner baru`,
          ].join('\n'),
        }
      );
    }

    return embed.createEmbed({
      title: '🤖 *ANTIGRAVITY AI ASSISTANT*',
      subtitle: isOwnerUser ? 'Mode Owner' : 'Mode Publik',
      fields,
      footer: 'Google Antigravity Laptop Bridge',
    });
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

    const fields = [
      {
        title: '🖥️ Spesifikasi Sistem',
        value: [
          `• Host: *${s.hostname}*`,
          `• OS: ${s.os || 'Debian 12'}`,
          `• CPU: ${s.cpus}`,
          `• RAM: ${s.memory}`,
          `• Uptime: ${s.systemUptime}`,
        ].join('\n'),
      },
      {
        title: '⚙️ Status Layanan',
        value: [
          `• AI Engine: ${busy}`,
          `• Model Aktif: ${model}`,
          `• Mode Selfbot: ${isSelfbot ? 'Aktif (Owner Only)' : 'Nonaktif (Publik)'}`,
          `• Auto-Read: ${isAutoRead ? 'Aktif' : 'Nonaktif'}`,
          showCwd ? `• Workspace: \`${s.cwd}\`` : '',
        ].filter(Boolean).join('\n'),
      },
    ];

    return embed.createEmbed({
      title: '📊 *STATUS SERVER & ENGINE*',
      fields,
      footer: 'Server Telemetry & Performance',
    });
  }

  // RESTRICTED COMMANDS (Owner Only)
  if (!isOwnerUser) {
    if (text.startsWith(prefix)) {
      return embed.createEmbed({
        title: '⛔ *AKSES DITOLAK*',
        body: `Perintah \`${text.split(' ')[0]}\` khusus Administrator/Owner bot.\nKetik \`${prefix}help\` atau kirim pesan biasa untuk chat dengan AI.`,
        footer: 'Permission Restricted',
      });
    }
  }

  // 5. OWNER: UPGRADE / SET LIMIT
  if (text.startsWith(`${prefix}setlimit `)) {
    const parts = text.substring(10).trim().split(/\s+/);
    if (parts.length < 2) return embed.formatAlert('Format Salah', `Contoh penggunaan: \`${prefix}setlimit 628123456789 50\``, 'warning');
    const res = limits.setLimit(parts[0], parts[1]);
    return embed.createEmbed({
      title: '✅ *LIMIT USER DIPERBARUI*',
      body: [
        `• Nomor: *${res.phone}*`,
        `• Kuota Baru: *${res.max} chat/hari*`,
        `• Terpakai: ${res.used}`,
      ].join('\n'),
      footer: 'Quota Updated',
    });
  }

  if (text.startsWith(`${prefix}addlimit `)) {
    const parts = text.substring(10).trim().split(/\s+/);
    if (parts.length < 2) return embed.formatAlert('Format Salah', `Contoh penggunaan: \`${prefix}addlimit 628123456789 20\``, 'warning');
    const res = limits.addLimit(parts[0], parts[1]);
    return embed.createEmbed({
      title: '✅ *BONUS KUOTA DITAMBAHKAN*',
      body: [
        `• Nomor: *${res.phone}*`,
        `• Tambahan: +${res.added} chat`,
        `• Total Kuota: *${res.max} chat/hari*`,
      ].join('\n'),
      footer: 'Bonus Quota Applied',
    });
  }

  // 6. OWNER: SELFBOT TOGGLE
  if (text === `${prefix}selfbot` || text === `${prefix}selfbot status`) {
    return embed.createEmbed({
      title: '🔒 *STATUS SELFBOT*',
      body: `Status: ${isSelfbot ? '🟢 *AKTIF* (Hanya merespons Owner)' : '⚪ *NONAKTIF* (Publik)'}\n\n_Ketik \`${prefix}selfbot on\` atau \`${prefix}selfbot off\` untuk mengubah._`,
      footer: 'Privacy Controller',
    });
  }
  if (text === `${prefix}selfbot on`) {
    setSelfbotMode(true);
    return embed.createEmbed({
      title: '🔒 *MODE SELFBOT DIAKTIFKAN*',
      body: 'Bot sekarang *hanya merespons Owner*. Pesan dari pengguna lain akan diabaikan tanpa balasan.',
      footer: 'Owner Only Mode Active',
    });
  }
  if (text === `${prefix}selfbot off`) {
    setSelfbotMode(false);
    return embed.createEmbed({
      title: '🔓 *MODE SELFBOT DINONAKTIFKAN*',
      body: 'Mode publik aktif. Pengguna lain dapat mencoba chat dengan AI menggunakan sistem kuota harian.',
      footer: 'Public Mode Active',
    });
  }

  // 7. OWNER: AUTOREAD TOGGLE
  if (text === `${prefix}autoread` || text === `${prefix}autoread status`) {
    return embed.createEmbed({
      title: '👁️ *STATUS AUTO-READ*',
      body: `Status: ${isAutoRead ? '🟢 *AKTIF* (Otomatis baca & centang biru)' : '⚪ *NONAKTIF*'}\n\n_Ketik \`${prefix}autoread on\` atau \`${prefix}autoread off\` untuk mengubah._`,
      footer: 'Notification Controller',
    });
  }
  if (text === `${prefix}autoread on`) {
    setAutoRead(true);
    return embed.createEmbed({
      title: '👁️ *AUTO-READ DIAKTIFKAN*',
      body: 'Pesan masuk akan langsung ditandai terbaca (centang biru), mencegah tumpukan notifikasi di HP Anda.',
      footer: 'Auto-Read Active',
    });
  }
  if (text === `${prefix}autoread off`) {
    setAutoRead(false);
    return embed.createEmbed({
      title: '👁️ *AUTO-READ DINONAKTIFKAN*',
      body: 'Pesan masuk tidak akan otomatis ditandai terbaca.',
      footer: 'Auto-Read Inactive',
    });
  }

  // 8. OWNER: STOP PROCESS
  if (text === `${prefix}stop` || text === `${prefix}cancel`) {
    const stopped = antigravity.stopActiveProcess();
    return embed.createEmbed({
      title: stopped ? '🛑 *PROSES DIHENTIKAN*' : 'ℹ️ *TIDAK ADA PROSES*',
      body: stopped
        ? 'Eksekusi AI aktif berhasil dihentikan secara paksa.'
        : 'Tidak ada proses AI yang sedang berjalan saat ini.',
      footer: 'Process Controller',
    });
  }

  // 9. OWNER: RESET CONVERSATION
  if (text === `${prefix}new` || text === `${prefix}reset`) {
    antigravity.resetConversation();
    return embed.createEmbed({
      title: '🧹 *KONTEKS PERCAKAPAN DIRESET*',
      body: [
        'Sesi lama telah dibersihkan secara tuntas.',
        'Sesi baru telah dimulai dan tidak akan terhubung ke riwayat sebelum restart.',
        '',
        '💡 _Silakan kirim pertanyaan atau tugas koding berikutnya!_',
      ].join('\n'),
      footer: 'Clean New Session Started',
    });
  }
  if (text.startsWith(`${prefix}new `)) {
    antigravity.resetConversation();
    const initialPrompt = text.substring(`${prefix}new `.length).trim();
    if (initialPrompt) {
      const res = await antigravity.askAntigravity(initialPrompt, { cwd: terminal.getCwd() });
      if (res.chunks && res.chunks.length > 1) return res.chunks;
      return res.text;
    }
    return embed.createEmbed({
      title: '🧹 *KONTEKS PERCAKAPAN DIRESET*',
      body: 'Sesi baru telah siap. Silakan kirim pesan berikutnya.',
      footer: 'Fresh Conversation Ready',
    });
  }

  // 10. OWNER: LIST & SET MODELS
  if (text === `${prefix}models`) {
    return antigravity.getAvailableModelsMenu();
  }
  if (text.startsWith(`${prefix}model `) || text === `${prefix}model`) {
    const m = text.substring(6).trim();
    if (!m) return antigravity.getAvailableModelsMenu();
    const res = antigravity.setModel(m);
    return embed.createEmbed({
      title: '✅ *MODEL AI DIPERBARUI*',
      body: `Engine AI aktif: *${res.label}*\n\n_Untuk kembali ke otomatis, ketik \`${prefix}model 0\`._`,
      footer: 'Model Engine Selected',
    });
  }

  // 11. OWNER: ADD AUTHORIZED USER
  if (text.startsWith(`${prefix}adduser `)) {
    const num = text.substring(`${prefix}adduser `.length).trim();
    const added = addAuthorizedUser(num);
    return embed.createEmbed({
      title: '✅ *ADMIN / OWNER DITAMBAHKAN*',
      body: `Nomor *${added}* kini memiliki hak akses penuh Superuser!`,
      footer: 'Privilege Granted',
    });
  }

  // 11. OWNER: TERMINAL (PWD, CD, LS, CAT, SH)
  if (text === `${prefix}pwd`) {
    return embed.createEmbed({
      title: '📁 *DIREKTORI AKTIF*',
      body: `\`${terminal.getCwd()}\``,
      footer: 'Working Directory',
    });
  }

  if (text.startsWith(`${prefix}cd `) || text === `${prefix}cd`) {
    const target = text.substring(3).trim();
    const res = terminal.setCwd(target || '.');
    return embed.createEmbed({
      title: res.success ? '📁 *DIREKTORI DIUBAH*' : '❌ *GAGAL PINDAH FOLDER*',
      body: res.success ? `\`${res.cwd}\`` : res.error,
      footer: 'Terminal Directory',
    });
  }

  if (text === `${prefix}ls` || text === `${prefix}dir`) {
    const cwd = terminal.getCwd();
    try {
      const files = fs.readdirSync(cwd);
      if (files.length === 0) {
        return embed.createEmbed({
          title: '📂 *FOLDER KOSONG*',
          body: `\`${cwd}\``,
          footer: 'File Explorer',
        });
      }

      const fileList = files.slice(0, 30).map(f => {
        const full = path.join(cwd, f);
        try {
          const isDir = fs.statSync(full).isDirectory();
          return `${isDir ? '📁' : '📄'} ${f}`;
        } catch {
          return `❓ ${f}`;
        }
      }).join('\n');

      const extra = files.length > 30 ? `\n_...dan ${files.length - 30} file lainnya_` : '';
      return embed.createEmbed({
        title: '📂 *DAFTAR FILE WORKSPACE*',
        subtitle: path.basename(cwd),
        body: `${fileList}${extra}`,
        footer: `${files.length} Total Item`,
      });
    } catch (err) {
      return embed.formatAlert('Gagal Membaca Folder', err.message, 'error');
    }
  }

  if (text.startsWith(`${prefix}cat `)) {
    const fileName = text.substring(`${prefix}cat `.length).trim();
    const filePath = path.resolve(terminal.getCwd(), fileName);
    try {
      if (!fs.existsSync(filePath)) return embed.formatAlert('File Tidak Ditemukan', `\`${fileName}\``, 'warning');
      const content = fs.readFileSync(filePath, 'utf8');
      const truncated = content.length > 2500 ? content.substring(0, 2500) + '\n\n...[Isi dipotong]' : content;
      return embed.createEmbed({
        title: '📄 *ISI FILE*',
        subtitle: fileName,
        body: `\`\`\`\n${truncated}\n\`\`\``,
        footer: 'File Viewer',
      });
    } catch (err) {
      return embed.formatAlert('Gagal Membaca File', err.message, 'error');
    }
  }

  if (text.startsWith(`${prefix}sh `) || text.startsWith(`${prefix}exec `)) {
    const cmd = text.startsWith(`${prefix}sh `) ? text.substring(4) : text.substring(6);
    if (!cmd.trim()) return embed.formatAlert('Perintah Kosong', 'Masukkan perintah shell yang ingin dijalankan.', 'warning');

    const start = Date.now();
    const result = await terminal.executeCommand(cmd);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    const fields = [];
    if (result.stdout) {
      const out = result.stdout.length > 2500 ? result.stdout.substring(0, 2500) + '\n...[Dipotong]' : result.stdout;
      fields.push({ title: '📤 STDOUT', value: `\`\`\`\n${out}\n\`\`\`` });
    }
    if (result.stderr) {
      const errOut = result.stderr.length > 2500 ? result.stderr.substring(0, 2500) + '\n...[Dipotong]' : result.stderr;
      fields.push({ title: '⚠️ STDERR', value: `\`\`\`\n${errOut}\n\`\`\`` });
    }
    if (!result.stdout && !result.stderr) {
      fields.push({ title: 'ℹ️ Output', value: `_Perintah selesai tanpa output (Exit Code: ${result.exitCode})_` });
    }

    return embed.createEmbed({
      title: '⚡ *TERMINAL EXECUTION*',
      subtitle: `${duration}s`,
      body: `💻 *Cmd:* \`${cmd.trim()}\`\n📁 *Cwd:* \`${terminal.getCwd()}\``,
      fields,
      footer: `Exit Code: ${result.exitCode}`,
    });
  }

  // 12. PROMPT AI (via !ai or regular chat message)
  let promptQuery = text;
  if (text.startsWith(`${prefix}ai `)) {
    promptQuery = text.substring(4).trim();
  } else if (text.startsWith(prefix)) {
    return embed.createEmbed({
      title: '❓ *PERINTAH TIDAK DIKENAL*',
      body: `Perintah *${text}* tidak terdaftar.\nKetik \`${prefix}help\` untuk melihat daftar perintah yang tersedia.`,
      footer: 'Command Not Found',
    });
  }

  // Rate Limiting Check for non-owner
  let limitCheck = null;
  if (!isOwnerUser) {
    limitCheck = limits.checkAndConsume(senderPhone, false);
    if (!limitCheck.allowed) {
      return embed.createEmbed({
        title: '⚠️ *KUOTA CHAT AI ANDA HABIS*',
        body: [
          `Kuota gratis harian Anda (*${limitCheck.max}/${limitCheck.max} chat*) sudah habis untuk hari ini.`,
          '',
          '🔄 *Reset Otomatis:* Besok pukul 00:00 WIB',
          '💡 *Upgrade Kuota:* Hubungi Owner bot untuk menambah limit akun Anda!',
        ].join('\n'),
        footer: 'Daily Rate Limit Exceeded',
      });
    }
  }

  // If user quote-replied to a specific message, include quoted context
  if (options && options.quotedText && options.quotedText.trim()) {
    const cleanQuoted = options.quotedText.trim();
    const previewQuoted = cleanQuoted.length > 1500 ? cleanQuoted.substring(0, 1500) + '...' : cleanQuoted;
    promptQuery = `[Konteks Pesan Yang Dikutip / Di-reply oleh Pengguna]:\n"${previewQuoted}"\n\n[Pesan / Tanggapan Pengguna]:\n${promptQuery}`;
  }

  // If user attached an image message
  if (options && options.imagePath) {
    const normPath = options.imagePath.replace(/\\/g, '/');
    promptQuery = `[Lampiran Gambar Diterima Dari WhatsApp]: file:///${normPath}\n(File gambar tersimpan di path lokal laptop: ${normPath}. Silakan periksa, peroleh informasi, dan analisis isi gambar tersebut secara mendalam untuk merespon pengguna.)\n\n[Pertanyaan / Perintah Pengguna]:\n${promptQuery}`;
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
