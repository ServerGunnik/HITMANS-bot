'use strict';

const { Events } = require('discord.js');

const starboard = require('../services/starboard');
const starboardRepo = require('../database/repositories/starboard');
const logger = require('../utils/logger');

/**
 * Starboard: reakcje ⭐ (takze na starszych wiadomosciach — dzieki partials)
 * aktualizuja karte na kanale starboardu.
 */
module.exports = [
  {
    name: Events.MessageReactionAdd,
    execute: (reaction) => starboard.handleReaction(reaction),
  },
  {
    name: Events.MessageReactionRemove,
    execute: (reaction) => starboard.handleReaction(reaction),
  },
  {
    name: Events.MessageReactionRemoveEmoji,
    execute: (reaction) => starboard.handleReaction(reaction),
  },
  {
    name: Events.MessageReactionRemoveAll,
    async execute(message) {
      if (!message.guild || !starboardRepo.getPost(message.id)) return;
      await starboard.sync(message).catch((error) => logger.debug('Starboard:', error.message));
    },
  },
  {
    name: Events.MessageDelete,
    async execute(message) {
      if (!message.guild || !starboardRepo.getPost(message.id)) return;
      await starboard.removeCard(message.guild, message.id);
    },
  },
];
