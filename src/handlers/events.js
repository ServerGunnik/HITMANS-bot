'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

/**
 * Laduje event handlery z src/events. Kazdy plik eksportuje
 * { name, once?, execute(...args, client) }.
 */
function loadEvents(client) {
  const directory = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(directory)) return 0;

  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.js'));
  let loaded = 0;

  for (const file of files) {
    const exported = require(path.join(directory, file));

    // Plik moze eksportowac jeden handler albo tablice (np. logi kanalow:
    // channelCreate, channelDelete i channelUpdate dziela ten sam modul).
    const events = Array.isArray(exported) ? exported : [exported];

    for (const event of events) {
      if (!event?.name || typeof event.execute !== 'function') {
        logger.warn(`Pomijam event ${file} — brak pola "name" lub funkcji "execute".`);
        continue;
      }

      const listener = (...args) =>
        Promise.resolve(event.execute(...args, client)).catch((error) =>
          logger.error(`Blad w evencie ${event.name}:`, error),
        );

      if (event.once) client.once(event.name, listener);
      else client.on(event.name, listener);

      loaded += 1;
      logger.debug(`Zaladowano event ${event.name}${event.once ? ' (once)' : ''}`);
    }
  }

  logger.info(`Zaladowano ${loaded} event handlerow.`);
  return loaded;
}

module.exports = { loadEvents };
