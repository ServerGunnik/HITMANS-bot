'use strict';

const { Events } = require('discord.js');

const activity = require('../database/repositories/activity');
const automod = require('../services/automod');
const economyService = require('../services/economy');
const logger = require('../utils/logger');

/** Automoderacja, zliczanie aktywnosci (/stats, /profil) i nagrody ekonomii. */
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    try {
      const handled = await automod.run(message);
      if (handled) return;
    } catch (error) {
      logger.warn('Automoderacja zglosila blad:', error.message);
    }

    try {
      activity.trackMessage(message.guild.id, message.author.id);
    } catch (error) {
      logger.debug('Nie udalo sie zapisac aktywnosci:', error.message);
    }

    try {
      economyService.rewardMessage(message);
    } catch (error) {
      logger.debug('Nie udalo sie naliczyc nagrody za wiadomosc:', error.message);
    }
  },
};
