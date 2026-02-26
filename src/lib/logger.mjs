import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_ROTATIONS = 3;
const LOG_DIR = 'log';

const loggers = new Map();

function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatArgs(...args) {
  return args.map(arg => {
    // Check if it's an object (but not null)
    if (arg !== null && typeof arg === 'object') {
      return JSON.stringify(arg);
    }
    // For numbers, booleans, strings - let native conversion handle it
    return String(arg);
  }).join(' ');
}

function formatLogMessage(level, message, maxLineSize = 10000) {
  const timestamp = formatTimestamp();  // your existing timestamp function

  // Split on any combination of \r\n, \n, \r (handles Windows/Unix/Mac line endings)
  const lines = message.split(/\r?\n/);

  // Format each line
  const formattedLines = lines.map((line) => {
    // Trim to check content, but preserve original whitespace in output
    if (line.trim() === '') {
      // Option A: Preserve empty lines as-is (cleaner logs)
      return '';
      // Option B: Prefix empty lines too → return `${timestamp} ${level}:`;
    }

    let lineT = line;
    if( lineT.length > maxLineSize ) {
      lineT = lineT.substring(0, maxLineSize) + '...';
    }
    return `${timestamp} ${level}: ${lineT}`;
  });

  // Join back with newlines
  let result = formattedLines.join('\n');

  // Preserve trailing newline from original message if present
  //if (message.endsWith('\n') || message.endsWith('\r\n')) {
  result += '\n';
  //}

  return result;
}

async function ensureLogDirectory() {
  try {
    await fs.access(LOG_DIR);
  } catch {
    await fs.mkdir(LOG_DIR, { recursive: true });
  }
}

async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function rotateLogFile(filePath, maxRotations) {
  // Delete the oldest rotation if it exists
  const oldestRotation = `${filePath}.${maxRotations}`;
  try {
    await fs.unlink(oldestRotation);
  } catch {
    // File doesn't exist, that's fine
  }

  // Shift all existing rotations
  for (let i = maxRotations - 1; i >= 1; i--) {
    const oldFile = `${filePath}.${i}`;
    const newFile = `${filePath}.${i + 1}`;
    try {
      await fs.rename(oldFile, newFile);
    } catch {
      // File doesn't exist, continue
    }
  }

  // Rename current log to .1
  try {
    await fs.rename(filePath, `${filePath}.1`);
  } catch {
    // File doesn't exist, that's fine
  }
}

async function writeLog(filePath, message, maxSize, maxRotations) {
  await ensureLogDirectory();

  const size = await getFileSize(filePath);
  if (size >= maxSize) {
    await rotateLogFile(filePath, maxRotations);
  }

  await fs.appendFile(filePath, message, 'utf8');
}

export async function createLogger(logicalName, options = {}) {
  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;
  const maxRotations = options.maxRotations || DEFAULT_MAX_ROTATIONS;
  const filePath = path.join(LOG_DIR, `${logicalName}.log`);
  const maxLineSize = options.maxLineSize || 10000; // Optional: max characters per line

  // Verify we can write to the log file during initialization
  // This catches permission/disk space issues early
  await ensureLogDirectory();
  try {
    await fs.access(filePath, fs.constants.W_OK);
  } catch {
    // File doesn't exist yet, try to create it
    await fs.appendFile(filePath, '', 'utf8');
  }

  const logger = {
    info(...args) {
      const message = formatArgs(...args);
      const formatted = formatLogMessage('INFO', message, maxLineSize);
      const promise = writeLog(filePath, formatted, maxSize, maxRotations);
      promise.catch(err => console.error('Logger error:', err));
      return promise;
    },

    debug(...args) {
      const message = formatArgs(...args);
      const formatted = formatLogMessage('DEBUG', message, maxLineSize);
      const promise = writeLog(filePath, formatted, maxSize, maxRotations);
      promise.catch(err => console.error('Logger error:', err));
      return promise;
    },

    warning(...args) {
      const message = formatArgs(...args);
      const formatted = formatLogMessage('WARNING', message,maxLineSize);
      const promise = writeLog(filePath, formatted, maxSize, maxRotations);
      promise.catch(err => console.error('Logger error:', err));
      return promise;
    },

    error(...args) {
      const message = formatArgs(...args);
      const formatted = formatLogMessage('ERROR', message,maxLineSize);
      const promise = writeLog(filePath, formatted, maxSize, maxRotations);
      promise.catch(err => console.error('Logger error:', err));
      return promise;
    },

    exception(error, additionalMessage = '') {
      const message = additionalMessage
        ? `${additionalMessage}\n${error.stack || error.toString()}`
        : error.stack || error.toString();
      const formatted = formatLogMessage('ERROR', message, maxLineSize);
      const promise = writeLog(filePath, formatted, maxSize, maxRotations);
      promise.catch(err => console.error('Logger error:', err));
      return promise;
    }
  };

  loggers.set(logicalName, logger);
  return logger;
}

export function getLogger(logicalName) {
  return loggers.get(logicalName);
}
