'use strict';

const logger = require('../utils/logger');
const modlog = require('../utils/modlog');
const serverLogs = require('./serverLogs');
const { COLORS, V2_FLAGS, panel, reply } = require('../ui/components');
const { humanDuration, truncate } = require('../utils/format');

const DM_META = {
  kick: { title: '👢 Zostales(as) wyrzucony(a) z serwera', color: COLORS.warning },
  ban: { title: '🔨 Zostales(as) zbanowany(a)', color: COLORS.danger },
  timeout: { title: '🔇 Zostales(as) wyciszony(a)', color: COLORS.warning },
  warn: { title: '⚠️ Otrzymales(as) ostrzezenie', color: COLORS.warning },
  mute_text: { title: '💬 Zostales(as) wyciszony(a) tekstowo', color: COLORS.warning },
  unmute_text: { title: '💬 Zdjeto Ci wyciszenie tekstowe', color: COLORS.success },
  mute_voice: { title: '🎙️ Zostales(as) wyciszony(a) na kanalach glosowych', color: COLORS.warning },
  unmute_voice: { title: '🎙️ Zdjeto Ci wyciszenie na kanalach glosowych', color: COLORS.success },
};

/** Powiadomienie prywatne dla ukaranego uzytkownika (best effort). */
async function notifyUser(guild, user, { action, reason, durationMs, extraFields = [] }) {
  const meta = DM_META[action] ?? { title: 'Akcja moderacyjna', color: COLORS.neutral };

  const container = panel({
    color: meta.color,
    title: meta.title,
    description: `Serwer: **${guild.name}**`,
    fields: [
      { name: 'Powod', value: truncate(reason || 'Nie podano', 900) },
      ...(durationMs ? [{ name: 'Czas trwania', value: humanDuration(durationMs), inline: true }] : []),
      ...extraFields,
    ],
    footer: guild.name,
  });

  try {
    await user.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wspolny przebieg akcji moderacyjnej: powiadomienie -> akcja -> log -> odpowiedz.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} options
 * @param {string} options.action        typ akcji (kick/ban/timeout/warn)
 * @param {import('discord.js').User} options.user  ukarany uzytkownik
 * @param {string} options.reason
 * @param {number} [options.durationMs]
 * @param {Function} options.perform     wlasciwa akcja na API Discorda
 * @param {Function} options.successText tekst potwierdzenia: (caseNumber, dmSent) => string
 */
async function runAction(interaction, { action, user, reason, durationMs, perform, successText, extraLogFields = [], dmFields = [] }) {
  const { guild } = interaction;

  const dmSent = await notifyUser(guild, user, { action, reason, durationMs, extraFields: dmFields });

  // Zdarzenie z bramy (guildBanAdd, guildMemberUpdate) potrafi dotrzec szybciej
  // niz zapis logu, dlatego znacznik stawiamy przed wykonaniem akcji.
  serverLogs.markBotAction(guild.id, user.id, action === 'untimeout' ? 'timeout' : action);

  try {
    await perform();
  } catch (error) {
    logger.error(`Akcja ${action} nie powiodla sie:`, error);
    return reply.error(interaction, `Nie udalo sie wykonac akcji: ${truncate(error.message, 300)}`);
  }

  // Pola logu moga zalezec od wyniku akcji (np. ID nowego ostrzezenia),
  // dlatego akceptujemy tez funkcje wyliczana po jej wykonaniu.
  const logFields = typeof extraLogFields === 'function' ? extraLogFields() : extraLogFields;

  const modCase = await modlog.logAction(guild, {
    action,
    user,
    moderator: interaction.user,
    reason,
    durationMs,
    extraFields: [
      ...logFields,
      { name: 'Powiadomienie DM', value: dmSent ? 'wyslane' : 'nie dotarlo', inline: true },
    ],
  });

  return reply.success(interaction, successText(modCase?.case_number, dmSent), { ephemeral: false });
}

module.exports = { runAction, notifyUser };
