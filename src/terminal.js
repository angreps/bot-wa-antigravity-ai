const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('../config');

// Track current working directory
let currentCwd = config.defaultCwd;

function getCwd() {
  return currentCwd;
}

function setCwd(newPath) {
  const resolved = path.resolve(currentCwd, newPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    currentCwd = resolved;
    return { success: true, cwd: currentCwd };
  }
  return { success: false, error: `Direktori tidak ditemukan: ${resolved}` };
}

function executeCommand(commandStr, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const trimmed = commandStr.trim();

    // Custom handling for 'cd' commands
    if (trimmed.startsWith('cd ') || trimmed === 'cd') {
      const target = trimmed.substring(2).trim() || os.homedir();
      const res = setCwd(target);
      if (res.success) {
        return resolve({
          stdout: `Direktori aktif diubah ke:\n${res.cwd}`,
          stderr: '',
          cwd: res.cwd,
          exitCode: 0,
        });
      } else {
        return resolve({
          stdout: '',
          stderr: res.error,
          cwd: currentCwd,
          exitCode: 1,
        });
      }
    }

    const shell = config.isWindows ? 'powershell.exe' : '/bin/bash';

    const child = exec(trimmed, {
      cwd: currentCwd,
      shell: shell,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4, // 4MB buffer
      env: process.env,
    }, (error, stdout, stderr) => {
      let out = (stdout || '').trim();
      let err = (stderr || '').trim();

      if (error && error.killed) {
        err = `[TIMEOUT] Perintah dibatalkan karena melebihi batas waktu (${timeoutMs / 1000}s)`;
      } else if (error && !err) {
        err = error.message;
      }

      // Format & truncate if too long for WhatsApp (max ~3500 chars)
      const MAX_LEN = 3500;
      if (out.length > MAX_LEN) {
        out = out.substring(0, MAX_LEN) + `\n\n...[Output dipotong, total ${out.length} karakter]`;
      }
      if (err.length > MAX_LEN) {
        err = err.substring(0, MAX_LEN) + `\n\n...[Error dipotong, total ${err.length} karakter]`;
      }

      resolve({
        stdout: out,
        stderr: err,
        cwd: currentCwd,
        exitCode: error ? (error.code || 1) : 0,
      });
    });
  });
}

function getSystemStatus() {
  // Fake RAM 16 GB dengan sisa banyak (penggunaan dinamis ~2.3 - 2.8 GB)
  const totalMem = 16.0;
  const baseUsed = 2.45 + (Math.sin(Date.now() / 60000) * 0.25);
  const usedMem = baseUsed.toFixed(2);
  const freeMem = (totalMem - usedMem).toFixed(2);
  const cpus = os.cpus();
  const uptimeHours = (os.uptime() / 3600).toFixed(1);
  const nodeUptimeHours = (process.uptime() / 3600).toFixed(2);

  return {
    os: 'Debian 12',
    platform: 'Debian 12',
    hostname: 'ai-antigravity',
    cpus: `${cpus.length}x ${cpus[0]?.model || 'Generic CPU'}`,
    memory: `${usedMem} GB / 16.00 GB (Sisa: ${freeMem} GB)`,
    systemUptime: `${uptimeHours} Jam`,
    nodeUptime: `${nodeUptimeHours} Jam`,
    nodeVersion: process.version,
    cwd: currentCwd,
  };
}

module.exports = {
  executeCommand,
  getCwd,
  setCwd,
  getSystemStatus,
};
