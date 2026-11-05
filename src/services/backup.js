'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../config');
const { getDb } = require('../database');
const logger = require('../utils/logger');

/**
 * Kopie zapasowe bazy SQLite. Uzywamy db.backup() z better-sqlite3 —
 * kopia jest spojna nawet przy aktywnym trybie WAL i trwajacych zapisach.
 */

const FILE_PATTERN = /^nlbot-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Limit zalacznika Discorda (bez Nitro / boostow). */
const ATTACHMENT_LIMIT = 8 * 1024 * 1024;

let running = null;

function fileName(date = new Date()) {
  const iso = date.toISOString();
  return `nlbot-${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '-')}.db`;
}

/** Lista kopii od najnowszej: [{ name, path, size, createdAt }]. */
function list(dir = config.backupDir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return files
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, size: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Czas ostatniej kopii (ms) albo null. */
function lastBackupAt(dir = config.backupDir) {
  return list(dir)[0]?.createdAt ?? null;
}

/** Usuwa kopie starsze niz BACKUP_RETENTION_DAYS. Zwraca liczbe usunietych plikow. */
function cleanup({ dir = config.backupDir, retentionDays = config.backupRetentionDays, now = Date.now() } = {}) {
  let removed = 0;
  for (const backup of list(dir)) {
    if (now - backup.createdAt <= retentionDays * DAY_MS) continue;
    try {
      fs.unlinkSync(backup.path);
      removed += 1;
    } catch (error) {
      logger.warn(`Nie udalo sie usunac starej kopii ${backup.name}:`, error.message);
    }
  }
  return removed;
}

/**
 * Tworzy nowa kopie bazy i sprzata stare. Rownolegle wywolania
 * czekaja na te sama operacje zamiast tworzyc kilka plikow naraz.
 */
async function create({ dir = config.backupDir, db = getDb() } = {}) {
  if (running) return running;

  running = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName());
    await db.backup(target);
    const size = fs.statSync(target).size;
    const removed = cleanup({ dir });
    logger.info(`Utworzono kopie bazy: ${path.basename(target)} (${size} B), usunieto starych: ${removed}.`);
    return { name: path.basename(target), path: target, size, createdAt: Date.now(), removed };
  })();

  try {
    return await running;
  } finally {
    running = null;
  }
}

/** Wywolywane przez scheduler — robi kopie, gdy ostatnia ma ponad dobe. */
let lastAttemptAt = 0;

async function tick({ now = Date.now() } = {}) {
  const last = lastBackupAt();
  if (last && now - last < DAY_MS) return null;
  // Po nieudanej probie (np. brak miejsca) nie ponawiamy co 30 s, tylko co godzine.
  if (now - lastAttemptAt < 60 * 60 * 1000) return null;
  lastAttemptAt = now;
  return create();
}

module.exports = { ATTACHMENT_LIMIT, FILE_PATTERN, fileName, list, lastBackupAt, cleanup, create, tick };
