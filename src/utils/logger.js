// ============================================
// Logger Utility
// Simple logger with timestamps & color coding
// ============================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function getTimestamp() {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatMessage(level, emoji, color, message, data) {
  const timestamp = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
  const levelTag = `${color}${colors.bright}[${level}]${colors.reset}`;
  const msg = `${timestamp} ${emoji} ${levelTag} ${message}`;

  if (data !== undefined) {
    console.log(msg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(msg);
  }
}

const logger = {
  info(message, data) {
    formatMessage('INFO', '📋', colors.blue, message, data);
  },

  success(message, data) {
    formatMessage('OK', '✅', colors.green, message, data);
  },

  warn(message, data) {
    formatMessage('WARN', '⚠️', colors.yellow, message, data);
  },

  error(message, data) {
    formatMessage('ERROR', '❌', colors.red, message, data);
  },

  incoming(from, message) {
    const timestamp = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
    console.log(
      `${timestamp} 📩 ${colors.cyan}${colors.bright}[INCOMING]${colors.reset} ` +
      `dari ${colors.magenta}${from}${colors.reset}: "${message}"`
    );
  },

  outgoing(to, message) {
    const timestamp = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
    const preview = message.length > 80 ? message.substring(0, 80) + '...' : message;
    console.log(
      `${timestamp} 📤 ${colors.green}${colors.bright}[OUTGOING]${colors.reset} ` +
      `ke ${colors.magenta}${to}${colors.reset}: "${preview}"`
    );
  },

  divider() {
    console.log(`${colors.gray}${'─'.repeat(60)}${colors.reset}`);
  },
};

module.exports = logger;
