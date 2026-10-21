'use strict';

const guilds = require('../database/repositories/guilds');
const moderation = require('../database/repositories/moderation');
const logger = require('./logger');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { humanDuration, truncate } = require('./format');

const ACTION_META = {
  kick:     { label: 'Wyrzucenie',        emoji: '👢', color: COLORS.warning },
  ban:      { label: 'Ban',               emoji: '🔨', color: COLORS.danger },
  unban:    { label: 'Zdjecie bana',      emoji: '🕊️', color: COLORS.success },
  timeout:  { label: 'Wyciszenie',        emoji: '🔇', color: COLORS.warning },
  untimeout:{ label: 'Zdjecie wyciszenia',emoji: '🔊', color: COLORS.success },
  warn:     { label: 'Ostrzezenie',       emoji: '⚠️', color: COLORS.warning },
  unwarn:   { label: 'Usuniecie ostrzezenia', emoji: '🧹', color: COLORS.success },
  automod:  { label: 'Automoderacja',     emoji: '🤖', color: COLORS.info },
  role_add: { label: 'Nadanie roli',      emoji: '➕', color: COLORS.info },
  role_remove: { label: 'Odebranie roli', emoji: '➖', color: COLORS.info },
  promote:  { label: 'Awans',             emoji: '⬆️', color: COLORS.success },
  demote:   { label: 'Degradacja',        emoji: '⬇️', color: COLORS.warning },
  recruit_accept: { label: 'Zgloszenie zaakceptowane', emoji: '✅', color: COLORS.success },
  recruit_reject: { label: 'Zgloszenie odrzucone',     emoji: '⛔', color: COLORS.danger },
  mute_text:    { label: 'Wyciszenie tekstowe',           emoji: '💬', color: COLORS.warning },
  unmute_text:  { label: 'Zdjecie wyciszenia tekstowego', emoji: '💬', color: COLORS.success },
  mute_voice:   { label: 'Wyciszenie glosowe',            emoji: '🎙️', color: COLORS.warning },
  unmute_voice: { label: 'Zdjecie wyciszenia glosowego',  emoji: '🎙️', color: COLORS.success },
  clear:        { label: 'Czyszczenie wiadomosci',        emoji: '🧹', color: COLORS.info },
  anti_raid_lockdown: { label: 'ANTI-RAID: lockdown',     emoji: '🚨', color: COLORS.danger },
  anti_nuke_trigger:  { label: 'ANTI-NUKE: wykryto atak', emoji: '🚨', color: COLORS.danger },
  min_age_kick:       { label: 'Kick — konto za mlode',   emoji: '👶', color: COLORS.warning },
};

/**
 * Zapisuje akcje w bazie (numerowana sprawa) i wysyla wpis na kanal logow.
 * Brak skonfigurowanego kanalu nie jest bledem — akcja i tak trafia do bazy.
 */
async function logAction(guild, { action, user, moderator, reason, durationMs, extraFields = [], saveCase = true }) {
  const meta = ACTION_META[action] ?? { label: action, emoji: '📌', color: COLORS.neutral };

  let modCase = null;
  if (saveCase) {
    modCase = moderation.addCase({
      guildId: guild.id,
      action,
      userId: user.id,
      userTag: user.tag ?? user.username ?? null,
      moderatorId: moderator?.id ?? guild.client.user.id,
      reason,
      durationMs,
    });
  }

  const settings = guilds.get(guild.id);
  if (!settings.modlog_channel_id) return modCase;

  const channel = guild.channels.cache.get(settings.modlog_channel_id)
    ?? await guild.channels.fetch(settings.modlog_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return modCase;

  const fields = [
    { name: 'Uzytkownik', value: `${user} \`${user.tag ?? user.username ?? user.id}\` (\`${user.id}\`)` },
    { name: 'Moderator', value: moderator ? `${moderator} (\`${moderator.id}\`)` : 'Bot (automoderacja)', inline: true },
  ];
  if (durationMs) fields.push({ name: 'Czas trwania', value: humanDuration(durationMs), inline: true });
  fields.push({ name: 'Powod', value: truncate(reason || 'Nie podano', 900) });
  fields.push(...extraFields);

  const container = panel({
    color: meta.color,
    title: `${meta.emoji} ${meta.label}${modCase ? ` • Sprawa #${modCase.case_number}` : ''}`,
    fields,
    footer: `ID uzytkownika: ${user.id} • ${new Date().toLocaleString('pl-PL')}`,
  });

  try {
    await channel.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn(`Nie udalo sie wyslac logu moderacji na serwerze ${guild.id}:`, error.message);
  }

  return modCase;
}

/** Log zdarzen niezwiazanych z kara (np. rekrutacja) — bez numeru sprawy. */
async function logEvent(guild, options) {
  return logAction(guild, { ...options, saveCase: false });
}

module.exports = { logAction, logEvent, ACTION_META };
