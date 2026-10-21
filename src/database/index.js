'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { config } = require('../config');
const logger = require('../utils/logger');
const { applyMigrations } = require('./migrations');

let db = null;

/**
 * Otwiera (i przy pierwszym uruchomieniu tworzy) baze SQLite,
 * a nastepnie wykonuje schemat z pliku schema.sql.
 */
function init() {
  if (db) return db;

  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  applyMigrations(db);

  logger.info(`Baza danych gotowa: ${config.databasePath}`);
  return db;
}

/** Zwraca aktywne polaczenie (inicjalizuje je leniwie przy pierwszym uzyciu). */
function getDb() {
  return db ?? init();
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { init, getDb, close };
