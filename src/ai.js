const fs = require('fs');
const path = require('path');
const config = require('../config');
const terminal = require('./terminal');

// In-memory conversation history per sender
const chatHistoryMap = new Map();

let activeApiKey = config.geminiApiKey;
let activeModel = config.geminiModel;

const SYSTEM_INSTRUCTION = `Anda adalah Antigravity Container Agent, asisten AI otonom yang terhubung langsung ke mesin / container ini (Windows PowerShell / Node.js).
Lingkungan saat ini:
- Direktori kerja default: ${config.defaultCwd}
- Project utama: bot-rcon (BBMusic Discord Bot & Web Streaming Platform) dan bbmusic-samp (SA-MP Pawn include & filterscript)
- Server VPS produksi: 43.173.15.219 (user: exeren)

Anda memiliki TOOLS (Function Calling) untuk berinteraksi langsung dengan container ini:
1. run_command: Jalankan perintah terminal apa pun di container (git, dir, npm, node, dll).
2. read_file: Baca isi file apa pun di dalam container.
3. write_file: Buat atau edit file di dalam container.
4. list_directory: Cek daftar file di folder.
5. get_system_status: Cek RAM, CPU, Uptime container.

Gunakan tools ini secara aktif saat user meminta Anda memeriksa kode, menjalankan perintah, mencari bug, atau mengelola server.
Format balasan untuk WhatsApp:
- Gunakan *teks tebal* untuk penekanan (bukan **teks**).
- Gunakan _teks miring_ untuk istilah.
- Gunakan \`\`\`kode blok\`\`\` untuk baris kode atau log.
- Jawab ringkas, jelas, dan akurat dalam Bahasa Indonesia.`;

const TOOL_DECLARATIONS = [
  {
    name: 'run_command',
    description: 'Jalankan perintah shell atau PowerShell di dalam container ini (misal: git status, dir, node script.js)',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Perintah shell yang akan dieksekusi' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Baca isi file di dalam workspace container ini',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: { type: 'STRING', description: 'Path relatif atau absolut file yang ingin dibaca' }
      },
      required: ['filePath']
    }
  },
  {
    name: 'write_file',
    description: 'Tulis atau edit file di dalam workspace container ini',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: { type: 'STRING', description: 'Path file target' },
        content: { type: 'STRING', description: 'Isi lengkap file' }
      },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'Lihat daftar file dan folder di dalam container',
    parameters: {
      type: 'OBJECT',
      properties: {
        dirPath: { type: 'STRING', description: 'Path direktori (kosongkan untuk direktori aktif)' }
      }
    }
  },
  {
    name: 'get_system_status',
    description: 'Ambil status spesifikasi sistem, RAM, CPU, dan uptime container',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  }
];

function setApiKey(newKey) {
  activeApiKey = newKey.trim();
  return activeApiKey;
}

function getApiKey() {
  return activeApiKey;
}

function clearHistory(userJid) {
  chatHistoryMap.delete(userJid);
}

function formatForWhatsApp(text) {
  if (!text) return '';
  return text
    .replace(/^### (.*$)/gim, '*$1*')
    .replace(/^## (.*$)/gim, '*$1*')
    .replace(/^# (.*$)/gim, '*$1*')
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .trim();
}

// Execute tool in this container
async function executeToolCall(toolName, args) {
  console.log(`[Tool Call] ${toolName}:`, JSON.stringify(args));
  try {
    if (toolName === 'run_command') {
      const res = await terminal.executeCommand(args.command || '');
      return {
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        exitCode: res.exitCode
      };
    }

    if (toolName === 'read_file') {
      const target = path.resolve(terminal.getCwd(), args.filePath || '');
      if (!fs.existsSync(target)) {
        return { error: `File tidak ditemukan: ${args.filePath}` };
      }
      const content = fs.readFileSync(target, 'utf8');
      const truncated = content.length > 5000 ? content.substring(0, 5000) + '\n\n...[Isi dipotong]' : content;
      return { content: truncated };
    }

    if (toolName === 'write_file') {
      const target = path.resolve(terminal.getCwd(), args.filePath || '');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, args.content || '', 'utf8');
      return { success: true, message: `File berhasil ditulis: ${args.filePath}` };
    }

    if (toolName === 'list_directory') {
      const targetDir = args.dirPath ? path.resolve(terminal.getCwd(), args.dirPath) : terminal.getCwd();
      if (!fs.existsSync(targetDir)) return { error: `Folder tidak ditemukan: ${args.dirPath}` };
      const items = fs.readdirSync(targetDir);
      return {
        directory: targetDir,
        items: items.slice(0, 40)
      };
    }

    if (toolName === 'get_system_status') {
      return terminal.getSystemStatus();
    }

    return { error: `Tool ${toolName} tidak dikenal.` };
  } catch (err) {
    return { error: `Gagal menjalankan tool: ${err.message}` };
  }
}

async function promptAI(userJid, userMessage) {
  if (!activeApiKey) {
    return '⚠️ *API Key Gemini belum disetel!*\nSilakan setel API key Anda dengan mengetik:\n`!setkey AIzaSyxxxxxxxxxxxxxxxxxxxxxx`\n\n_Dapatkan gratis di https://aistudio.google.com/apikey_';
  }

  let history = chatHistoryMap.get(userJid) || [];

  history.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  if (history.length > 20) {
    history = history.slice(history.length - 20);
    chatHistoryMap.set(userJid, history);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${activeApiKey}`;

  // Autonomous agent loop: allow up to 4 sequential tool calls
  let iterations = 0;
  const maxIterations = 4;

  while (iterations < maxIterations) {
    iterations++;

    const payload = {
      contents: history,
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      tools: [{
        functionDeclarations: TOOL_DECLARATIONS
      }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048,
      },
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        return `❌ *Error Gemini AI (${res.status})*:\n${data?.error?.message || 'Gagal'}`;
      }

      const candidate = data.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      if (!part) {
        return '⚠️ AI tidak mengembalikan respon yang valid.';
      }

      // Check if model requests a tool call
      if (part.functionCall) {
        const fCall = part.functionCall;
        const toolResult = await executeToolCall(fCall.name, fCall.args || {});

        // Save model turn with function call
        history.push({
          role: 'model',
          parts: [{ functionCall: fCall }]
        });

        // Save tool response as user turn
        history.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: fCall.name,
              response: { result: toolResult }
            }
          }]
        });

        chatHistoryMap.set(userJid, history);
        continue; // Next turn to let model analyze tool output
      }

      // Final text response
      const replyText = part.text || '';
      history.push({
        role: 'model',
        parts: [{ text: replyText }]
      });
      chatHistoryMap.set(userJid, history);

      return formatForWhatsApp(replyText);
    } catch (err) {
      return `❌ *Gagal menghubungi AI*:\n${err.message}`;
    }
  }

  return '⚠️ Batas iterasi tool tercapai.';
}

module.exports = {
  promptAI,
  clearHistory,
  setApiKey,
  getApiKey,
  formatForWhatsApp,
};
