'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const security = require('../services/security');
const { COLORS } = require('../ui/components');

/**
 * Log bana nadanego poza botem (np. recznie w Discordzie).
 * Bany z komendy /ban maja juz wpis w logu moderacji, wiec je pomijamy.
 */
module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    if (serverLogs.consumeBotAction(ban.guild.id, ban.user.id, 'ban')) return;

    const executor = await serverLogs.findExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    if (executor) {
      await security.recordNukeAction(ban.guild, executor, 'member_ban').catch(() => {});
    }

    await serverLogs.send(ban.guild, 'members', {
      title: 'Uzytkownik zbanowany',
      color: COLORS.danger,
      fields: [
        { name: 'Uzytkownik', value: serverLogs.describeUser(ban.user) },
        ...serverLogs.executorField(executor),
        ...(ban.reason ? [{ name: 'Powod', value: ban.reason }] : []),
      ],
      footer: `ID: ${ban.user.id}`,
    });
  },
};
