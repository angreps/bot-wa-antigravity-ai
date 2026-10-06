const fs = require('fs');
const path = require('path');
const config = require('../config');

const dataDir = path.resolve(__dirname, '../data');
const limitsFile = path.join(dataDir, 'limits.json');

const DEFAULT_LIMIT = 10; // Default limit per hari untuk non-owner

let db = {
  date: new Date().toISOString().slice(0, 10),
  users: {},
};

// Load database from disk
function loadDb() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (fs.existsSync(limitsFile)) {
      const raw = fs.readFileSync(limitsFile, 'utf8');
      db = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Limits] Gagal memuat limits.json, menggunakan default:', err.message);
  }
  checkDailyReset();
}

// Save database to disk
function saveDb() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(limitsFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[Limits] Gagal menyimpan limits.json:', err.message);
  }
}

// Auto-reset daily usage if date changed
function checkDailyReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (db.date !== today) {
    console.log(`[Limits] Hari baru terdeteksi (${today}). Mereset penggunaan harian user...`);
    db.date = today;
    for (const phone in db.users) {
      if (db.users[phone]) {
        db.users[phone].used = 0;
      }
    }
    saveDb();
  }
}

function normalizePhone(phone) {
  let clean = (phone || '').replace(/[^0-9]/g, '');
  if (clean.startsWith('08')) clean = '62' + clean.slice(1);
  return clean;
}

/**
 * Check and consume 1 prompt limit for a user
 * @param {string} phone
 * @param {boolean} isOwner
 * @returns {{ allowed: boolean, remaining: number|string, used: number, max: number, isOwner: boolean }}
 */
function checkAndConsume(phone, isOwner = false) {
  if (isOwner) {
    return { allowed: true, remaining: 'Unlimited', used: 0, max: Infinity, isOwner: true };
  }

  checkDailyReset();
  const clean = normalizePhone(phone);

  if (!db.users[clean]) {
    db.users[clean] = {
      used: 0,
      max: DEFAULT_LIMIT,
      updatedAt: Date.now(),
    };
  }

  const user = db.users[clean];

  if (user.used >= user.max) {
    return {
      allowed: false,
      remaining: 0,
      used: user.used,
      max: user.max,
      isOwner: false,
    };
  }

  user.used += 1;
  user.updatedAt = Date.now();
  saveDb();

  return {
    allowed: true,
    remaining: user.max - user.used,
    used: user.used,
    max: user.max,
    isOwner: false,
  };
}

const embed = require('./embed');

/**
 * Get formatted limit status string for a user
 * @param {string} phone
 * @param {boolean} isOwner
 * @returns {string}
 */
function getLimitInfo(phone, isOwner = false) {
  if (isOwner) {
    return embed.createEmbed({
      title: '👑 *STATUS AKUN & KUOTA*',
      subtitle: 'Owner Access',
      body: [
        '👤 *Peran:* Owner / Super Admin',
        '♾️ *Kuota AI:* Unlimited (Tanpa Batas)',
        '💻 *Terminal & Shell:* Akses Penuh Aktif',
      ].join('\n'),
      footer: 'Superuser Privileges Active',
    });
  }

  checkDailyReset();
  const clean = normalizePhone(phone);
  const user = db.users[clean] || { used: 0, max: DEFAULT_LIMIT };
  const sisa = Math.max(0, user.max - user.used);

  return embed.createEmbed({
    title: '📊 *STATUS KUOTA AI ANDA*',
    subtitle: 'Public User',
    body: [
      `📱 *Nomor:* ${clean}`,
      `⚡ *Terpakai:* ${user.used} / ${user.max} chat`,
      `🔋 *Sisa Kuota:* *${sisa} chat*`,
      '🔄 *Reset Harian:* Pukul 00:00 WIB',
      '',
      '_💡 Hubungi Owner bot untuk meminta upgrade kuota harian._',
    ].join('\n'),
    footer: 'Daily Rate Limit System',
  });
}

/**
 * Set custom max limit for a specific user (Owner command)
 * @param {string} phone
 * @param {number} newMax
 */
function setLimit(phone, newMax) {
  checkDailyReset();
  const clean = normalizePhone(phone);
  const max = Math.max(0, parseInt(newMax) || DEFAULT_LIMIT);

  if (!db.users[clean]) {
    db.users[clean] = { used: 0, max, updatedAt: Date.now() };
  } else {
    db.users[clean].max = max;
  }

  saveDb();
  return { phone: clean, max, used: db.users[clean].used };
}

/**
 * Add extra quota to a user's limit (Owner command)
 * @param {string} phone
 * @param {number} extra
 */
function addLimit(phone, extra) {
  checkDailyReset();
  const clean = normalizePhone(phone);
  const add = parseInt(extra) || 5;

  if (!db.users[clean]) {
    db.users[clean] = { used: 0, max: DEFAULT_LIMIT + add, updatedAt: Date.now() };
  } else {
    db.users[clean].max += add;
  }

  saveDb();
  return { phone: clean, max: db.users[clean].max, added: add };
}

// Initialize on module load
loadDb();

module.exports = {
  checkAndConsume,
  getLimitInfo,
  setLimit,
  addLimit,
};
