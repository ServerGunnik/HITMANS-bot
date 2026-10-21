'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** Aktywny plik logu — zmieniany automatycznie po polnocy. */
let stream = null;
let streamDay = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Usuwa pliki logow starsze niz LOG_RETENTION_DAYS. */
function cleanupOldFiles() {
  const maxAge = config.logRetentionDays * 24 * 60 * 60 * 1000;

  try {
    for (const file of fs.readdirSync(config.logDir)) {
      if (!/^bot-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;

      const fullPath = path.join(config.logDir, file);
      if (Date.now() - fs.statSync(fullPath).mtimeMs > maxAge) fs.unlinkSync(fullPath);
    }
  } catch {
    // Brak katalogu lub brak uprawnien — logowanie do pliku jest opcjonalne.
  }
}

function getStream() {
  if (!config.logToFile) return null;

  const day = today();
  if (stream && streamDay === day) return stream;

  try {
    fs.mkdirSync(config.logDir, { recursive: true });
    stream?.end();
    stream = fs.createWriteStream(path.join(config.logDir, `bot-${day}.log`), { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
    streamDay = day;
    cleanupOldFiles();
    return stream;
  } catch {
    return null;
  }
}

/** Zamienia argumenty (w tym bledy i obiekty) na jedna linie tekstu. */
function stringify(args) {
  return args
    .map((argument) => {
      if (argument instanceof Error) return argument.stack ?? argument.message;
      if (typeof argument === 'object' && argument !== null) {
        try {
          return JSON.stringify(argument);
        } catch {
          return String(argument);
        }
      }
      return String(argument);
    })
    .join(' ')
    .replace(ANSI_PATTERN, '');
}

function log(level, ...args) {
  if ((LEVELS[level] ?? LEVELS.info) > threshold) return;

  const time = timestamp();
  const prefix = `${COLORS[level]}[${time}] [${level.toUpperCase()}]${RESET}`;
  const stream_ = level === 'error' ? console.error : console.log;
  stream_(prefix, ...args);

  const file = getStream();
  if (file) file.write(`[${time}] [${level.toUpperCase()}] ${stringify(args)}\n`);
}

/** Zamyka plik logu (wywolywane przy zamykaniu bota). */
function close() {
  stream?.end();
  stream = null;
  streamDay = null;
}

module.exports = {
  error: (...args) => log('error', ...args),
  warn: (...args) => log('warn', ...args),
  info: (...args) => log('info', ...args),
  debug: (...args) => log('debug', ...args),
  close,
};
