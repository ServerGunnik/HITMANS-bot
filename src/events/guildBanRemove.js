'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');

/** Log zdjecia bana (takze automatycznego, po uplywie bana czasowego). */
module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    if (serverLogs.consumeBotAction(ban.guild.id, ban.user.id, 'unban')) return;

    const executor = await serverLogs.findExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);

    await serverLogs.send(ban.guild, 'members', {
      title: 'Ban zdjety',
      color: COLORS.success,
      fields: [
        { name: 'Uzytkownik', value: serverLogs.describeUser(ban.user) },
        ...serverLogs.executorField(executor),
      ],
      footer: `ID: ${ban.user.id}`,
    });
  },
};
