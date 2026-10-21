'use strict';

/**
 * Rejestruje komendy slash w API Discorda.
 *
 *   npm run deploy            - rejestracja globalna (lub na serwerze z GUILD_ID)
 *   npm run deploy -- --clear - usuwa wszystkie zarejestrowane komendy
 */
const { Collection, REST, Routes } = require('discord.js');

const { config, assertConfig } = require('./config');
const logger = require('./utils/logger');
const { loadCommands, toApplicationCommands } = require('./handlers/commands');

async function deploy() {
  assertConfig();

  const clear = process.argv.includes('--clear');
  const stub = { commands: new Collection() };
  loadCommands(stub);

  const body = clear ? [] : toApplicationCommands(stub.commands);
  const rest = new REST({ version: '10' }).setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const scope = config.guildId ? `serwera ${config.guildId}` : 'globalnie';
  logger.info(clear ? `Usuwam komendy (${scope})...` : `Rejestruje ${body.length} komend (${scope})...`);

  const result = await rest.put(route, { body });
  logger.info(`Gotowe — aktywnych komend: ${result.length}.`);

  if (!config.guildId && !clear) {
    logger.info('Komendy globalne moga propagowac sie do ok. 1 godziny.');
  }
}

deploy().catch((error) => {
  logger.error('Rejestracja komend nie powiodla sie:', error);
  process.exit(1);
});
