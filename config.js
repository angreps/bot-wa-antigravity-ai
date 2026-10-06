require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');

function extractVariants(id) {
  const clean = (id || '').replace(/[^0-9]/g, '');
  if (!clean) return [];
  const variants = [clean];

  if (clean.startsWith('08')) {
    variants.push('62' + clean.slice(1));
    variants.push(clean.slice(1));
  } else if (clean.startsWith('8')) {
    variants.push('62' + clean);
    variants.push('0' + clean);
  } else if (clean.startsWith('628')) {
    variants.push('0' + clean.slice(2));
    variants.push(clean.slice(2));
  }

  return variants;
}

// Read owners from env
const rawOwners = (process.env.OWNER_NUMBER || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ownerVariants = new Set();
for (const o of rawOwners) {
  extractVariants(o).forEach(v => ownerVariants.add(v));
}

const rawBot = (process.env.BOT_NUMBER || '').replace(/[^0-9]/g, '');
const botVariants = extractVariants(rawBot);
botVariants.forEach(v => ownerVariants.add(v));

const defaultLocalAgy = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\Administrator\\AppData\\Local',
  'agy\\bin\\agy.exe'
);

const botRconPath = path.resolve(__dirname, '../bot-rcon');
const fallbackCwd = fs.existsSync(botRconPath) ? botRconPath : process.cwd();

module.exports = {
  botName: process.env.BOT_NAME || 'Antigravity Laptop AI',
  owners: Array.from(ownerVariants),
  primaryOwnerPhone: rawOwners.find(o => o.startsWith('62') || o.startsWith('08')) || rawOwners[0] || '',
  primaryOwnerLid: rawOwners.find(o => o.length > 13) || '',
  botNumber: rawBot ? (rawBot.startsWith('8') ? '62' + rawBot : rawBot) : '',
  selfbotMode: (process.env.SELFBOT_MODE || 'true').toLowerCase() === 'true',
  autoRead: (process.env.AUTO_READ || 'true').toLowerCase() === 'true',
  agyPath: process.env.AGY_PATH || defaultLocalAgy,
  agyModel: process.env.AGY_MODEL || '',
  usePairingCode: (process.env.USE_PAIRING_CODE || 'true').toLowerCase() === 'true',
  prefix: process.env.COMMAND_PREFIX || '!',
  defaultCwd: process.env.DEFAULT_CWD || fallbackCwd,
  isWindows: os.platform() === 'win32',
  sessionDir: path.resolve(__dirname, 'session'),
  extractVariants,
};
