import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = process.env.LOG_ROOT ?? './log';
const LEVEL_NUM = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVEL_NUM[process.env.LOG_LEVEL] ?? LEVEL_NUM.info;

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

function fmt(...args) {
  return args.map(a =>
    a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
}

function write(level, channel, ...args) {
  if (LEVEL_NUM[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  const msg = fmt(...args);
  (level === 'error' ? console.error : console.log)(
    `[${ts}] [${channel.toUpperCase()}] [${level.toUpperCase()}] ${msg}`
  );
  appendFileSync(join(LOG_DIR, `${channel}.log`), `[${ts}] [${level.toUpperCase()}] ${msg}\n`);
}

export function logger(channel) {
  return {
    debug: (...a) => write('debug', channel, ...a),
    info:  (...a) => write('info',  channel, ...a),
    warn:  (...a) => write('warn',  channel, ...a),
    error: (...a) => write('error', channel, ...a),
  };
}
