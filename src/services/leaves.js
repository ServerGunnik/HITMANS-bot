'use strict';

const activityRepo = require('../database/repositories/clanActivity');
const guilds = require('../database/repositories/guilds');
const leavesRepo = require('../database/repositories/leaves');
const { checkSelfAssignableRole } = require('../utils/permissions');
const logger = require('../utils/logger');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { plural, timestamp, truncate } = require('../utils/format');

const MAX_LEAVE_DAYS = 365;

const END_REASONS = {
  manual: 'zakonczony przez czlonka',
  expired: 'uplynal termin',
  officer: 'zakonczony przez oficera',
};

/** Kanal powiadomien kadry: wlasny kanal oficerow albo kanal logow moderacji. */
function officerChannelId(guildId) {
  return activityRepo.getSettings(guildId).officer_channel_id ?? guilds.get(guildId).modlog_channel_id ?? null;
}

/** Wysyla panel na kanal oficerow (brak kanalu nie jest bledem). */
async function notifyOfficers(guild, container) {
  const channelId = officerChannelId(guild.id);
  if (!channelId) return false;

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch?.(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return false;

  try {
    await channel.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.debug(`Nie udalo sie wyslac powiadomienia o urlopie (${guild.id}):`, error.message);
    return false;
  }
}

function leaveRole(guild) {
  const roleId = activityRepo.getSettings(guild.id).leave_role_id;
  return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}

/** Panel powiadomienia o zgloszonym / zakonczonym urlopie. */
function buildLeaveNotice(leave, { type = 'start', updated = false } = {}) {
  if (type === 'start') {
    return panel({
      color: COLORS.info,
      title: updated ? '🏖️ Urlop zaktualizowany' : '🏖️ Nowy urlop',
      fields: [
        { name: 'Czlonek', value: `<@${leave.user_id}>`, inline: true },
        { name: 'Do', value: `${timestamp(leave.ends_at, 'D')} (${timestamp(leave.ends_at, 'R')})`, inline: true },
        { name: 'Powod', value: truncate(leave.reason, 500) },
      ],
      footer: `Urlop #${leave.id}`,
    });
  }

  return panel({
    color: COLORS.success,
    title: '👋 Koniec urlopu',
    fields: [
      { name: 'Czlonek', value: `<@${leave.user_id}>`, inline: true },
      { name: 'Powod zakonczenia', value: END_REASONS[leave.end_reason] ?? leave.end_reason ?? '—', inline: true },
      ...(leave.ended_by && leave.end_reason === 'officer' ? [{ name: 'Oficer', value: `<@${leave.ended_by}>`, inline: true }] : []),
      { name: 'Trwal', value: `${timestamp(leave.starts_at, 'D')} – ${timestamp(leave.ended_at, 'D')}` },
    ],
    footer: `Urlop #${leave.id}`,
  });
}

/**
 * Zglasza urlop czlonka: zapis w bazie, rola urlopowa (jesli ustawiona) i powiadomienie kadry.
 * Zwraca { leave, updated, roleWarning }.
 */
async function startLeave(guild, member, { endsAt, reason }) {
  const role = leaveRole(guild);
  let roleId = null;
  let roleWarning = null;

  if (role) {
    const check = checkSelfAssignableRole(guild, role);
    if (!check.ok) {
      roleWarning = check.reason;
    } else {
      try {
        if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Urlop czlonka klanu');
        roleId = role.id;
      } catch (error) {
        roleWarning = `Nie udalo sie nadac roli urlopowej: ${error.message}`;
      }
    }
  }

  const { leave, updated } = leavesRepo.start({ guildId: guild.id, userId: member.id, reason, endsAt, roleId });
  await notifyOfficers(guild, buildLeaveNotice(leave, { type: 'start', updated }));
  return { leave, updated, roleWarning };
}

/** Konczy urlop: zdejmuje role urlopowa i powiadamia kadre. */
async function endLeave(guild, leave, { reason = 'manual', endedBy = null } = {}) {
  const ended = leavesRepo.end(guild.id, leave.id, { reason, endedBy });
  if (!ended) return null;

  if (ended.role_id) {
    const member = await guild.members.fetch(ended.user_id).catch(() => null);
    const role = guild.roles.cache.get(ended.role_id);
    if (member && role && member.roles.cache.has(role.id)) {
      await member.roles
        .remove(role, 'Koniec urlopu')
        .catch((error) => logger.debug(`Nie udalo sie zdjac roli urlopowej ${ended.user_id}:`, error.message));
    }
  }

  await notifyOfficers(guild, buildLeaveNotice(ended, { type: 'end' }));
  return ended;
}

/** Scheduler: zamyka urlopy, ktorych termin minal. */
async function processDue(client, now = Date.now()) {
  for (const leave of leavesRepo.due(now)) {
    const guild = client.guilds.cache.get(leave.guild_id);
    try {
      if (!guild) {
        leavesRepo.end(leave.guild_id, leave.id, { reason: 'expired', now });
        continue;
      }
      await endLeave(guild, leave, { reason: 'expired' });
      logger.info(`Zakonczono urlop #${leave.id} (${leave.user_id}, ${leave.guild_id}).`);
    } catch (error) {
      logger.warn(`Blad zamykania urlopu #${leave.id}:`, error.message);
    }
  }
}

/** Panel /urlop lista. */
function buildLeaveList(leaves) {
  const lines = leaves.map(
    (leave) =>
      `\`#${leave.id}\` <@${leave.user_id}> — do ${timestamp(leave.ends_at, 'D')} (${timestamp(leave.ends_at, 'R')})\n` +
      `> ${truncate(leave.reason.replace(/\n+/g, ' '), 120)}`,
  );

  const shown = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > 3200) break;
    shown.push(line);
    used += line.length + 1;
  }

  return panel({
    color: COLORS.info,
    title: `🏖️ Urlopy (${leaves.length})`,
    description: leaves.length
      ? shown.join('\n')
      : 'Nikt nie jest teraz na urlopie.',
    footer:
      shown.length < leaves.length
        ? `Pokazano ${shown.length} z ${leaves.length} ${plural(leaves.length, 'urlopu', 'urlopow', 'urlopow')}`
        : 'Urlopy koncza sie automatycznie po uplywie terminu.',
  });
}

module.exports = {
  MAX_LEAVE_DAYS,
  officerChannelId,
  notifyOfficers,
  buildLeaveNotice,
  buildLeaveList,
  startLeave,
  endLeave,
  processDue,
};
