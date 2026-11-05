'use strict';

const backup = require('./backup');
const updater = require('./updater');
const logger = require('../utils/logger');

/**
 * Zadania utrzymaniowe wywolywane z ticku schedulera (co 30 s).
 * Kazda usluga sama pilnuje swojego rytmu: kopia raz na dobe,
 * sprawdzanie aktualizacji co interwal.
 */
async function tick(client) {
  // Testy (node --test) moga wolac scheduler.tick() — nie robimy wtedy
  // kopii na dysku i nie pytamy gita.
  if (process.env.NODE_TEST_CONTEXT) return;

  await backup.tick().catch((error) => logger.warn('Kopia zapasowa bazy:', error.message));
  await updater.tick(client).catch((error) => logger.warn('Aktualizacja bota:', error.message));
}

module.exports = { tick };
