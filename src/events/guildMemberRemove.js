'use strict';

const { Events } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const recruitment = require('../database/repositories/recruitment');
const serverLogs = require('../services/serverLogs');
const logger = require('../utils/logger');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');

/**
 * Log wyjscia czlonka z serwera, a dodatkowo — gdy odchodzacy mial otwarte
 * zgloszenie rekrutacyjne — informacja na kanale logow moderacji.
 */
module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const roles = member.roles?.cache
      ?.filter((role) => role.id !== member.guild.id)
      .map(String)
      .join(' ');

    await serverLogs.send(member.guild, 'members', {
      title: 'Czlonek opuscil serwer',
      color: COLORS.warning,
      thumbnail: member.user ? { url: member.user.displayAvatarURL({ size: 256 }) } : undefined,
      fields: [
        { name: 'Uzytkownik', value: member.user ? serverLogs.describeUser(member.user) : `\`${member.id}\`` },
        ...(member.joinedAt ? [{ name: 'Dolaczyl(a)', value: timestamp(member.joinedAt, 'R'), inline: true }] : []),
        { name: 'Czlonkow na serwerze', value: String(member.guild.memberCount), inline: true },
        ...(roles ? [{ name: 'Role', value: truncate(roles, 900) }] : []),
      ],
      footer: `ID: ${member.id}`,
    });

    if (member.user?.bot) return;

    const pending = recruitment.getPendingApplication(member.guild.id, member.id);
    if (!pending) return;

    const settings = guilds.get(member.guild.id);
    if (!settings.modlog_channel_id) return;

    const channel =
      member.guild.channels.cache.get(settings.modlog_channel_id) ??
      (await member.guild.channels.fetch(settings.modlog_channel_id).catch(() => null));
    if (!channel?.isTextBased()) return;

    const container = panel({
      color: COLORS.warning,
      title: '🚪 Kandydat opuscil serwer',
      fields: [
        { name: 'Uzytkownik', value: `\`${member.user?.tag ?? member.id}\` (\`${member.id}\`)` },
        { name: 'Zgloszenie', value: `#${pending.id} • zlozone ${timestamp(pending.created_at, 'R')}`, inline: true },
      ],
      footer: 'Zgloszenie nadal oczekuje na decyzje.',
    });

    await channel
      .send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch((error) => logger.debug('Nie udalo sie wyslac logu o wyjsciu kandydata:', error.message));
  },
};
