const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getGitStatusMap(cwd) {
  const map = new Map();
  if (!cwd || !fs.existsSync(cwd)) return map;

  try {
    const gitOut = execSync('git status --short', {
      cwd,
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (gitOut) {
      const lines = gitOut.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const statusCode = line.substring(0, 2).trim();
        const filePath = line.substring(2).trim().replace(/^"|"$/g, '');
        const fullPath = path.resolve(cwd, filePath);

        let mtime = 0;
        let size = 0;
        let isDir = false;

        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            mtime = stat.mtimeMs;
            size = stat.size;
            isDir = stat.isDirectory();
          }
        } catch (_) {}

        map.set(filePath, { statusCode, mtime, size, isDir });
      }
    }
  } catch (_) {}

  return map;
}

function takeSnapshot(cwd) {
  return {
    time: Date.now(),
    statusMap: getGitStatusMap(cwd),
  };
}

function getWorkspaceChanges(cwd, beforeSnapshot) {
  if (!cwd || !fs.existsSync(cwd)) return [];
  const results = [];

  const afterMap = getGitStatusMap(cwd);
  const beforeMap = beforeSnapshot?.statusMap || new Map();
  const startTime = beforeSnapshot?.time || 0;

  for (const [filePath, afterInfo] of afterMap.entries()) {
    const beforeInfo = beforeMap.get(filePath);

    // If it existed before with same status and modification time, it was not changed during this turn
    if (beforeInfo) {
      if (beforeInfo.statusCode === afterInfo.statusCode && Math.abs(beforeInfo.mtime - afterInfo.mtime) < 500) {
        continue;
      }
    } else if (startTime > 0 && afterInfo.mtime > 0 && afterInfo.mtime < startTime - 1000) {
      // Existed before start time, ignore
      continue;
    }

    const fullPath = path.resolve(cwd, filePath);
    let sizeStr = '';
    let isDir = afterInfo.isDir;

    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        isDir = stat.isDirectory();
        if (!isDir) {
          sizeStr = formatBytes(stat.size);
        }
      }
    } catch (_) {}

    let icon = isDir ? '📁' : '✏️';
    let action = isDir ? 'Folder' : 'Modified';

    if (afterInfo.statusCode.includes('?') || afterInfo.statusCode.includes('A')) {
      icon = isDir ? '📁' : '📄';
      action = isDir ? 'Folder' : 'Created';
    } else if (afterInfo.statusCode.includes('D')) {
      icon = '🗑️';
      action = 'Deleted';
    } else if (afterInfo.statusCode.includes('R')) {
      icon = '🔄';
      action = 'Renamed';
    }

    results.push(`• ${icon} \`${filePath}\` (${action}${sizeStr ? ' - ' + sizeStr : ''})`);
  }

  // Check for deleted items that were in beforeMap but not in afterMap
  for (const [filePath] of beforeMap.entries()) {
    if (!afterMap.has(filePath)) {
      if (!fs.existsSync(path.resolve(cwd, filePath))) {
        results.push(`• 🗑️ \`${filePath}\` (Deleted)`);
      }
    }
  }

  return results;
}

module.exports = {
  formatBytes,
  takeSnapshot,
  getWorkspaceChanges,
};
