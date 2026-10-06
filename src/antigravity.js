const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const terminal = require('./terminal');
const tracker = require('./tracker');

// State tracking
let isBusy = false;
let activeProcess = null;
let shouldStartNewConversation = false;
let customModel = null; // Start null so it uses default laptop session smoothly

const MODEL_PRESETS = {
  '1': { slug: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (Super Cepat)' },
  'flash': { slug: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (Super Cepat)' },
  '3.8': { slug: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (Super Cepat)' },

  '2': { slug: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' },
  '3.7': { slug: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash' },

  '3': { slug: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (Paling Cerdas & Mendalam)' },
  'pro': { slug: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (Paling Cerdas & Mendalam)' },
  '3.1': { slug: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (Paling Cerdas & Mendalam)' },

  '4': { slug: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (Coding Ahli)' },
  'sonnet': { slug: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (Coding Ahli)' },
  'claude': { slug: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (Coding Ahli)' },

  '5': { slug: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (Penalaran Kompleks)' },
  'opus': { slug: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (Penalaran Kompleks)' },

  '6': { slug: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B' },
  'gpt': { slug: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B' },
};

function resolveModel(input) {
  if (!input) return null;
  const clean = input.trim().toLowerCase().replace(/_/g, ' ');

  if (clean === 'default' || clean === '0' || clean === 'reset' || clean === 'auto') {
    return { slug: null, label: 'Default Laptop (Otomatis)' };
  }

  // Exact match from presets
  if (MODEL_PRESETS[clean]) {
    return MODEL_PRESETS[clean];
  }

  // Check if it already matches a slug directly (e.g. gemini-3.8-flash-high)
  const normalizedSlug = clean.replace(/\s+/g, '-');
  for (const p of Object.values(MODEL_PRESETS)) {
    if (p.slug === normalizedSlug) return p;
  }

  // Partial keyword matches
  if (clean.includes('3.8') || clean.includes('flash')) return MODEL_PRESETS['1'];
  if (clean.includes('pro') || clean.includes('3.1')) return MODEL_PRESETS['3'];
  if (clean.includes('sonnet') || clean.includes('claude')) return MODEL_PRESETS['4'];
  if (clean.includes('opus')) return MODEL_PRESETS['5'];
  if (clean.includes('gpt')) return MODEL_PRESETS['6'];

  return null;
}

// Clean ANSI terminal color sequences and format for WhatsApp
function cleanAndFormatOutput(rawText) {
  if (!rawText) return '';

  // 1. Strip ANSI escape sequences (colors, cursor movements)
  // eslint-disable-next-line no-control-regex
  let cleaned = rawText.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

  // 2. Clean internal file URLs [filename](file:///...) to [filename]
  cleaned = cleaned.replace(/\[([^\]]+)\]\(file:\/\/\/[^\)]+\)/g, '*$1*');

  // 3. Format Markdown headers to WhatsApp bold
  cleaned = cleaned.replace(/^### (.*$)/gim, '*$1*');
  cleaned = cleaned.replace(/^## (.*$)/gim, '*$1*');
  cleaned = cleaned.replace(/^# (.*$)/gim, '*$1*');

  // 4. Convert standard markdown bold **text** to WhatsApp *text*
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = [];
  cleaned = cleaned.replace(codeBlockRegex, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // Restore code blocks
  cleaned = cleaned.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[idx]);

  return cleaned.trim();
}

// Split long text into WhatsApp-friendly chunks (~3500 chars)
function splitIntoChunks(text, maxChunkSize = 3500) {
  if (!text || text.length <= maxChunkSize) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf('\n\n', maxChunkSize);
    if (splitIdx === -1 || splitIdx < maxChunkSize / 2) {
      splitIdx = remaining.lastIndexOf('\n', maxChunkSize);
    }
    if (splitIdx === -1 || splitIdx < maxChunkSize / 2) {
      splitIdx = remaining.lastIndexOf(' ', maxChunkSize);
    }
    if (splitIdx === -1) {
      splitIdx = maxChunkSize;
    }

    chunks.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }

  return chunks;
}

// Get path to agy.exe
function getAgyExecutable() {
  if (config.agyPath && fs.existsSync(config.agyPath)) {
    return config.agyPath;
  }
  const defaultLocal = path.join(
    process.env.LOCALAPPDATA || 'C:\\Users\\Administrator\\AppData\\Local',
    'agy\\bin\\agy.exe'
  );
  if (fs.existsSync(defaultLocal)) {
    return defaultLocal;
  }
  return 'agy';
}

/**
 * Run a prompt through Antigravity CLI on the laptop
 * @param {string} promptText
 * @param {object} options
 * @returns {Promise<{ text: string, chunks: string[], success: boolean, duration: string }>}
 */
function askAntigravity(promptText, options = {}) {
  return new Promise((resolve) => {
    if (isBusy) {
      return resolve({
        text: '⏳ *Antigravity sedang sibuk* memproses perintah sebelumnya.\nKetik `!stop` untuk membatalkan proses yang sedang berjalan, atau tunggu sebentar.',
        chunks: ['⏳ *Antigravity sedang sibuk* memproses perintah sebelumnya.\nKetik `!stop` untuk membatalkan proses yang sedang berjalan, atau tunggu sebentar.'],
        success: false,
        duration: '0s',
      });
    }

    const agyBin = getAgyExecutable();
    const workingDir = options.cwd || terminal.getCwd();
    const startTime = Date.now();

    // Prepare CLI args
    const args = [];
    // Use isolated project for WhatsApp bot so it does not load massive IDE history
    args.push('--project', 'wa-bot');

    if (!shouldStartNewConversation) {
      args.push('-c');
    } else {
      shouldStartNewConversation = false;
    }

    args.push('--dangerously-skip-permissions');
    args.push('--mode', 'accept-edits');

    if (customModel) {
      args.push('--model', customModel);
    }

    // Direct execution instruction so AI autonomously runs tools instead of asking for approval
    const executionWrapper = `[Instruksi: Eksekusi seluruh pembuatan file/folder, pengeditan kode, dan tugas yang diperlukan secara otomatis dan langsung sampai selesai tanpa meminta konfirmasi izin atau menunggu persetujuan review.]\n\n${promptText}`;

    args.push('-p', executionWrapper);

    isBusy = true;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    console.log(`[AGY] Executing in ${workingDir}: agy ${args.join(' ').substring(0, 80)}...`);

    const child = spawn(agyBin, args, {
      cwd: workingDir,
      env: process.env,
      shell: false,
    });

    activeProcess = child;

    const timeoutMs = options.timeoutMs || 180000;
    const timer = setTimeout(() => {
      if (activeProcess === child) {
        console.warn(`[AGY] Timeout reached (${timeoutMs / 1000}s). Killing process...`);
        try {
          child.kill('SIGKILL');
        } catch (_) {}
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      isBusy = false;
      activeProcess = null;
      console.error('[AGY Process Error]:', err);
      const errMsg = `❌ *Gagal memanggil Antigravity CLI*: ${err.message}\nPastikan \`agy\` terpasang di laptop.`;
      resolve({
        text: errMsg,
        chunks: [errMsg],
        success: false,
        duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
      });
    });

    child.on('close', async (code) => {
      clearTimeout(timer);
      isBusy = false;
      activeProcess = null;

      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      console.log(`[AGY] Finished with code ${code} (${duration})`);

      let rawOutput = stdoutBuffer.trim();
      let errorOutput = stderrBuffer.trim();

      // AUTO-RECOVERY: If model selection error occurs, reset to default and auto-retry once
      if (code !== 0 && (errorOutput.includes('invalid model selection') || errorOutput.includes('is not recognized as a known model'))) {
        console.warn('[AGY Auto-Recovery] Model invalid. Resetting to default session model and retrying...');
        customModel = null;
        if (!options.isRetry) {
          const retryRes = await askAntigravity(promptText, { ...options, isRetry: true });
          return resolve(retryRes);
        }
      }

      const fileChanges = tracker.getWorkspaceChanges(workingDir);
      let logsHeader = '';
      if (fileChanges.length > 0) {
        logsHeader = `📝 *Logs Perubahan File:*\n${fileChanges.join('\n')}\n\n`;
      }

      if (!rawOutput && errorOutput) {
        const cleanedErr = cleanAndFormatOutput(errorOutput);
        return resolve({
          text: `⚠️ *Antigravity Notice / Error (${duration}):*\n${logsHeader}${cleanedErr}`,
          chunks: [`⚠️ *Antigravity Notice / Error (${duration}):*\n${logsHeader}${cleanedErr}`],
          fileChanges,
          success: code === 0,
          duration,
        });
      }

      if (code === null && !rawOutput && !errorOutput) {
        return resolve({
          text: `${logsHeader}⏱️ *Waktu Proses Habis (Timeout ${duration}):*\nInstruksi memakan waktu lebih dari 3 menit atau terpotong. Cobalah kirim pesan yang lebih lengkap/spesifik atau ketik \`!new\` untuk mereset percakapan baru.`,
          chunks: [`${logsHeader}⏱️ *Waktu Proses Habis (Timeout ${duration}):*\nInstruksi memakan waktu lebih dari 3 menit atau terpotong. Cobalah kirim pesan yang lebih lengkap/spesifik atau ketik \`!new\` untuk mereset percakapan baru.`],
          fileChanges,
          success: false,
          duration,
        });
      }

      if (!rawOutput && !errorOutput) {
        return resolve({
          text: `${logsHeader}_Selesai tanpa output teks (Exit code: ${code}, Durasi: ${duration})_`,
          chunks: [`${logsHeader}_Selesai tanpa output teks (Exit code: ${code}, Durasi: ${duration})_`],
          fileChanges,
          success: true,
          duration,
        });
      }

      const formatted = logsHeader + cleanAndFormatOutput(rawOutput);
      const chunks = splitIntoChunks(formatted);

      resolve({
        text: formatted,
        chunks: chunks,
        fileChanges,
        success: code === 0,
        duration,
      });
    });
  });
}

function stopActiveProcess() {
  if (activeProcess) {
    try {
      activeProcess.kill('SIGKILL');
      activeProcess = null;
      isBusy = false;
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function resetConversation() {
  shouldStartNewConversation = true;
  return true;
}

function setModel(input) {
  const match = resolveModel(input);
  if (match) {
    customModel = match.slug;
    return match;
  }
  // If invalid, fallback to default
  customModel = null;
  return { slug: null, label: 'Default Laptop (Otomatis)' };
}

function getModel() {
  if (!customModel) return 'Default (Sesi Laptop Aktif)';
  for (const p of Object.values(MODEL_PRESETS)) {
    if (p.slug === customModel) return p.label;
  }
  return customModel;
}

function isAgentBusy() {
  return isBusy;
}

function getAvailableModelsMenu() {
  return `📋 *PILIHAN MODEL AI ANTIGRAVITY:*
─────────────────────────
1️⃣ \`!model 1\` : *Gemini 3.8 Flash* (Super cepat & ringan)
2️⃣ \`!model 2\` : *Gemini 3.7 Flash* (Cepat & seimbang)
3️⃣ \`!model 3\` : *Gemini 3.1 Pro* (Paling cerdas & mendalam)
4️⃣ \`!model 4\` : *Claude Sonnet 5.5* (Sangat ahli koding)
5️⃣ \`!model 5\` : *Claude Opus 5.5* (Penalaran kompleks)
0️⃣ \`!model 0\` : *Default Laptop* (Rekomendasi / Otomatis)

_Contoh pemakaian: Cukup ketik \`!model 1\` atau \`!model pro\`._`;
}

module.exports = {
  askAntigravity,
  stopActiveProcess,
  resetConversation,
  setModel,
  getModel,
  isAgentBusy,
  getAvailableModelsMenu,
  splitIntoChunks,
};
