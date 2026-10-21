'use strict';

const { ActivityType, Events } = require('discord.js');

const logger = require('../utils/logger');
const automod = require('../services/automod');
const tempbans = require('../services/tempbans');
const economyService = require('../services/economy');
const shopService = require('../services/shop');
const serverLogs = require('../services/serverLogs');
const scheduler = require('../services/scheduler');
const voiceService = require('../services/voice');
const security = require('../services/security');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`Zalogowano jako ${client.user.tag} (ID: ${client.user.id})`);
    logger.info(`Obsluguje ${client.guilds.cache.size} serwerow.`);

    const updatePresence = () => {
      client.user.setPresence({
        status: 'online',
        activities: [
          {
            name: `klanem • ${client.guilds.cache.size} serwerow`,
            type: ActivityType.Watching,
          },
        ],
      });
    };

    updatePresence();
    setInterval(updatePresence, 15 * 60 * 1000).unref();
    setInterval(() => {
      automod.cleanup();
      serverLogs.cleanupBotActions();
      security.cleanup();
    }, 60 * 1000).unref();
    tempbans.start(client);
    economyService.startVoiceRewards(client);
    shopService.startExpiryScheduler(client);
    scheduler.start(client);
    voiceService.cleanupOrphans(client).catch((error) => logger.warn('Sprzatanie temp voice:', error.message));
  },
};
