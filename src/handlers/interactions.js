'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

const DIRECTORIES = {
  buttons: 'buttons',
  modals: 'modals',
  selects: 'selects',
};

/**
 * Laduje handlery komponentow (przyciski, modale, selecty).
 * Kazdy plik eksportuje { namespace, execute(interaction, args, client) },
 * gdzie `namespace` to pierwszy czlon customId (np. "rekrutacja:accept:12").
 */
function loadComponentHandlers(client) {
  const base = path.join(__dirname, '..', 'interactions');

  for (const [collection, folder] of Object.entries(DIRECTORIES)) {
    const directory = path.join(base, folder);
    if (!fs.existsSync(directory)) continue;

    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js'))) {
      const handler = require(path.join(directory, file));
      if (!handler?.namespace || typeof handler.execute !== 'function') {
        logger.warn(`Pomijam handler ${folder}/${file} — brak "namespace" lub "execute".`);
        continue;
      }
      client[collection].set(handler.namespace, handler);
      logger.debug(`Zaladowano handler ${folder}:${handler.namespace}`);
    }
  }

  logger.info(
    `Zaladowano handlery komponentow: ${client.buttons.size} przyciskow, ` +
      `${client.modals.size} modali, ${client.selects.size} selectow.`,
  );
}

module.exports = { loadComponentHandlers };
