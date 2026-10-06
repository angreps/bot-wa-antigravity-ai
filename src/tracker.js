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

function getWorkspaceChanges(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return [];
  const results = [];

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

        let sizeStr = '';
        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            sizeStr = formatBytes(stat.size);
          }
        } catch (_) {}

        let icon = '✏️';
        let action = 'Modified';

        if (statusCode.includes('?') || statusCode.includes('A')) {
          icon = '📄';
          action = 'Created';
        } else if (statusCode.includes('D')) {
          icon = '🗑️';
          action = 'Deleted';
        } else if (statusCode.includes('R')) {
          icon = '🔄';
          action = 'Renamed';
        }

        results.push(`• ${icon} \`${filePath}\` (${action}${sizeStr ? ' - ' + sizeStr : ''})`);
      }
    }
  } catch (_) {
    // Non-git directory or error, ignore
  }

  return results;
}

module.exports = {
  formatBytes,
  getWorkspaceChanges,
};
