'use strict';

const { Client, Collection, GatewayIntentBits, Options, Partials } = require('discord.js');

const { config, assertConfig } = require('./config');
const database = require('./database');
const logger = require('./utils/logger');
const { loadCommands } = require('./handlers/commands');
const { loadEvents } = require('./handlers/events');
const { loadComponentHandlers } = require('./handlers/interactions');

function buildClient() {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ];

  if (config.enablePresenceIntent) intents.push(GatewayIntentBits.GuildPresences);

  const client = new Client({
    intents,
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
    allowedMentions: { parse: ['users'], repliedUser: false },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      // Obecnosci cache'ujemy tylko wtedy, gdy /stats ma z nich korzystac.
      ...(config.enablePresenceIntent ? {} : { PresenceManager: 0 }),
    }),
  });

  client.commands = new Collection();
  client.buttons = new Collection();
  client.modals = new Collection();
  client.selects = new Collection();
  client.cooldowns = new Collection();

  return client;
}

async function main() {
  assertConfig();
  database.init();

  const client = buildClient();
  loadCommands(client);
  loadComponentHandlers(client);
  loadEvents(client);

  const shutdown = (signal) => {
    logger.info(`Otrzymano ${signal} — zamykam bota...`);
    client.destroy();
    database.close();
    logger.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('Nieobsluzone odrzucenie promise:', error));
  process.on('uncaughtException', (error) => logger.error('Nieobsluzony wyjatek:', error));

  await client.login(config.token);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Nie udalo sie uruchomic bota:', error);
    process.exit(1);
  });
}

module.exports = { buildClient, main };
