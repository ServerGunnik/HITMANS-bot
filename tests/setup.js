'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Kazdy przebieg testow dostaje wlasna, tymczasowa baze SQLite.
 * Musi to byc ustawione przed pierwszym require() modulow bota.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlbot-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.CLIENT_ID = 'test-client';
process.env.DISCORD_TOKEN = 'test-token';
process.env.LOG_LEVEL = 'error';

// Na Windowsie nie da sie usunac otwartego pliku bazy — najpierw zamykamy
// polaczenie, a ewentualny blad sprzatania nie moze oblac calego testu.
process.on('exit', () => {
  try {
    require('../src/database').close();
  } catch {
    // baza mogla nie zostac otwarta
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // katalog tymczasowy posprzata system
  }
});

module.exports = { dir };
