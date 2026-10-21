'use strict';

const fs = require('node:fs');
const path = require('node:path');

const logger = require('../utils/logger');

/** Rekurencyjnie zbiera sciezki do plikow .js w katalogu. */
function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

/**
 * Laduje wszystkie komendy z src/commands (kazda komenda = osobny plik
 * eksportujacy { data, execute, autocomplete? }).
 */
function loadCommands(client) {
  const directory = path.join(__dirname, '..', 'commands');
  const files = collectFiles(directory);

  for (const file of files) {
    delete require.cache[require.resolve(file)];
    const exported = require(file);

    // Plik moze eksportowac jedna komende albo tablice komend
    // (np. /dodaj-punkty i /odejmij-punkty dziela ta sama logike).
    const commands = Array.isArray(exported) ? exported : [exported];

    for (const command of commands) {
      if (!command?.data || typeof command.execute !== 'function') {
        logger.warn(`Pomijam ${path.relative(directory, file)} — brak pola "data" lub funkcji "execute".`);
        continue;
      }

      client.commands.set(command.data.name, command);
      logger.debug(`Zaladowano komende /${command.data.name}`);
    }
  }

  logger.info(`Zaladowano ${client.commands.size} komend.`);
  return client.commands;
}

/** Zwraca tablice komend w formacie JSON gotowym do rejestracji w API. */
function toApplicationCommands(commands) {
  return [...commands.values()].map((command) => command.data.toJSON());
}

module.exports = { loadCommands, toApplicationCommands, collectFiles };
