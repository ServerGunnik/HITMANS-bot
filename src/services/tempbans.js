'use strict';

const moderation = require('../database/repositories/moderation');
const logger = require('../utils/logger');
const modlog = require('../utils/modlog');
const serverLogs = require('./serverLogs');

/** Zdejmuje bany czasowe, ktorych termin uplynal. Odporne na restart bota. */
async function processExpired(client) {
  const due = moderation.dueTempBans();
  if (due.length === 0) return 0;

  let removed = 0;
  for (const entry of due) {
    const guild = client.guilds.cache.get(entry.guild_id);
    if (!guild) {
      moderation.removeTempBan(entry.guild_id, entry.user_id);
      continue;
    }

    try {
      serverLogs.markBotAction(guild.id, entry.user_id, 'unban');
      await guild.bans.remove(entry.user_id, 'Uplynal czas bana czasowego');
      const user = await client.users.fetch(entry.user_id).catch(() => null);
      if (user) {
        await modlog.logAction(guild, {
          action: 'unban',
          user,
          moderator: null,
          reason: 'Automatyczne zdjecie bana czasowego',
        });
      }
      removed += 1;
    } catch (error) {
      logger.debug(`Nie udalo sie zdjac bana ${entry.user_id} (${entry.guild_id}):`, error.message);
    }

    moderation.removeTempBan(entry.guild_id, entry.user_id);
  }

  if (removed > 0) logger.info(`Zdjeto ${removed} banow czasowych.`);
  return removed;
}

/** Uruchamia cykliczne sprawdzanie (co minute). */
function start(client) {
  processExpired(client).catch((error) => logger.warn('Scheduler banow:', error.message));
  const timer = setInterval(
    () => processExpired(client).catch((error) => logger.warn('Scheduler banow:', error.message)),
    60 * 1000,
  );
  timer.unref();
  return timer;
}

module.exports = { start, processExpired };
