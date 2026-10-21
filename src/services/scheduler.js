'use strict';

const pollsRepo = require('../database/repositories/polls');
const giveawaysRepo = require('../database/repositories/giveaways');
const moderation = require('../database/repositories/moderation');
const guilds = require('../database/repositories/guilds');
const pollsService = require('./polls');
const giveawaysService = require('./giveaways');
const verification = require('./verification');
const modlog = require('../utils/modlog');
const logger = require('../utils/logger');

const INTERVAL_MS = 30 * 1000;

async function processExpiredMutes(client) {
  const due = moderation.dueMutes();
  for (const mute of due) {
    const guild = client.guilds.cache.get(mute.guild_id);
    if (!guild) {
      moderation.removeMute(mute.guild_id, mute.user_id, mute.type);
      continue;
    }

    const member = await guild.members.fetch(mute.user_id).catch(() => null);
    const user = member?.user ?? (await client.users.fetch(mute.user_id).catch(() => null));

    try {
      if (mute.type === 'text') {
        const settings = guilds.get(guild.id);
        const role = settings.mute_role_id ? guild.roles.cache.get(settings.mute_role_id) : null;
        if (role && member && member.roles.cache.has(role.id)) {
          await member.roles.remove(role, 'Automatyczne zdjecie wyciszenia tekstowego (uplynal czas)');
        }
      } else if (mute.type === 'voice') {
        if (member && member.voice.channel && member.voice.serverMute) {
          await member.voice.setMute(false, 'Automatyczne zdjecie wyciszenia glosowego (uplynal czas)');
        }
      }

      if (user) {
        await modlog.logEvent(guild, {
          action: mute.type === 'text' ? 'unmute_text' : 'unmute_voice',
          user,
          moderator: null,
          reason: 'Automatyczne — uplynal czas wyciszenia',
        }).catch(() => {});
      }
      logger.info(`Zdjeto wyciszenie ${mute.type} — ${mute.user_id} (${mute.guild_id}).`);
    } catch (error) {
      logger.debug(`Auto-unmute ${mute.type} ${mute.user_id}:`, error.message);
    }

    moderation.removeMute(mute.guild_id, mute.user_id, mute.type);
  }
}

async function tick(client) {
  const pollIds = pollsRepo.dueForClosing();
  for (const id of pollIds) {
    try {
      await pollsService.closePoll(client, id);
      logger.info(`Zamknieto ankiete #${id} (uplynal czas).`);
    } catch (error) {
      logger.warn(`Blad zamykania ankiety #${id}:`, error.message);
    }
  }

  const giveawayIds = giveawaysRepo.dueForClosing();
  for (const id of giveawayIds) {
    try {
      await giveawaysService.finalizeGiveaway(client, id);
      logger.info(`Zakonczono losowanie #${id}.`);
    } catch (error) {
      logger.warn(`Blad zakanczania losowania #${id}:`, error.message);
    }
  }

  await processExpiredMutes(client).catch((error) => logger.warn('Scheduler mutow:', error.message));

  verification.cleanup();
}

function start(client) {
  tick(client).catch((error) => logger.warn('Scheduler ankiet/losowan:', error.message));
  const timer = setInterval(
    () => tick(client).catch((error) => logger.warn('Scheduler ankiet/losowan:', error.message)),
    INTERVAL_MS,
  );
  timer.unref();
  return timer;
}

module.exports = { start, tick };
