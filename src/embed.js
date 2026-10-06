/**
 * WhatsApp Visual Embed & Card Styler
 * Provides aesthetic unicode borders, badges, and card formatting for WhatsApp messages.
 */

// Modern Unicode Border Styles
const BORDERS = {
  rounded: {
    top: '╭───',
    mid: '├───',
    bottom: '╰───',
    line: '│ ',
    horiz: '─',
    end: '╯',
  },
  box: {
    top: '┌───',
    mid: '├───',
    bottom: '└───',
    line: '│ ',
    horiz: '─',
    end: '┘',
  },
  double: {
    top: '╔═══',
    mid: '╠═══',
    bottom: '╚═══',
    line: '║ ',
    horiz: '═',
    end: '╝',
  }
};

/**
 * Format content into a stylish WhatsApp Embed Card
 * @param {object} options
 * @param {string} options.title - Header title with emoji
 * @param {string} [options.subtitle] - Optional subtitle/badge
 * @param {string|string[]} options.body - Main text or list of lines
 * @param {Array<{ title: string, value: string }>} [options.fields] - Key-value field sections
 * @param {string} [options.footer] - Footer text (e.g. Model / Timestamp)
 * @param {string} [options.style='rounded'] - Border style ('rounded' | 'box' | 'double')
 * @returns {string} Formatted WhatsApp message
 */
function createEmbed({
  title = 'ANTIGRAVITY AI',
  subtitle = null,
  body = '',
  fields = [],
  footer = null,
  style = 'rounded',
}) {
  const b = BORDERS[style] || BORDERS.rounded;
  const lines = [];

  // 1. Header Card
  const headerBadge = subtitle ? ` [ ${subtitle} ]` : '';
  lines.push(`${b.top}「 ${title}${headerBadge} 」`);
  lines.push(b.line);

  // 2. Body Content
  if (body) {
    const bodyStr = Array.isArray(body) ? body.join('\n') : String(body);
    const bodyLines = bodyStr.split('\n');

    for (const bl of bodyLines) {
      if (bl.trim() === '') {
        lines.push(b.line);
      } else {
        lines.push(`${b.line}${bl}`);
      }
    }
  }

  // 3. Optional Fields
  if (fields && fields.length > 0) {
    for (const field of fields) {
      lines.push(b.line);
      lines.push(`${b.mid}「 ${field.title} 」`);
      lines.push(b.line);
      const valLines = String(field.value).split('\n');
      for (const vl of valLines) {
        lines.push(`${b.line}${vl}`);
      }
    }
  }

  // 4. Footer Section
  if (footer) {
    lines.push(b.line);
    lines.push(`${b.mid}「 ℹ️ ${footer} 」`);
    lines.push(`${b.bottom}${'─'.repeat(24)}`);
  } else {
    lines.push(b.line);
    lines.push(`${b.bottom}${'─'.repeat(26)}`);
  }

  return lines.join('\n');
}

/**
 * Quick embed for AI responses
 */
function formatAiResponse(text, { model = 'Gemini 3.1 Pro', duration = '0s', quoted = null, fileChanges = [] } = {}) {
  const b = BORDERS.rounded;
  const lines = [];

  lines.push(`${b.top}「 🧠 *ANTIGRAVITY AI* 」`);
  lines.push(b.line);

  if (quoted) {
    const previewQuoted = quoted.length > 120 ? quoted.substring(0, 120) + '...' : quoted;
    lines.push(`${b.line}💬 _Mereply: "${previewQuoted}"_`);
    lines.push(b.line);
  }

  // File Changes if any
  if (fileChanges && fileChanges.length > 0) {
    lines.push(`${b.mid}「 📝 *Perubahan File Workspace* 」`);
    lines.push(b.line);
    for (const ch of fileChanges) {
      lines.push(`${b.line}${ch}`);
    }
    lines.push(b.line);
  }

  // Main text lines
  const textLines = text.split('\n');
  for (const l of textLines) {
    if (l.trim() === '') {
      lines.push(b.line);
    } else {
      lines.push(`${b.line}${l}`);
    }
  }

  lines.push(b.line);
  lines.push(`${b.mid}「 ⚡ *${model}* • ⏱️ ${duration} 」`);
  lines.push(`${b.bottom}${'─'.repeat(24)}`);

  return lines.join('\n');
}

/**
 * Format notification / alert embed
 */
function formatAlert(title, message, type = 'info') {
  const icons = {
    info: '💡',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    lock: '🔒',
    gear: '⚙️',
  };
  const icon = icons[type] || '📌';
  return createEmbed({
    title: `${icon} *${title}*`,
    body: message,
    footer: 'Antigravity Laptop Assistant',
  });
}

module.exports = {
  createEmbed,
  formatAiResponse,
  formatAlert,
  BORDERS,
};
