'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');
const { truncate } = require('../utils/format');

/** Log zmian ustawien serwera. */
module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    const changes = [];

    if (oldGuild.name !== newGuild.name) changes.push(`Nazwa: \`${oldGuild.name}\` → \`${newGuild.name}\``);
    if (oldGuild.ownerId !== newGuild.ownerId) changes.push(`Wlasciciel: <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`);
    if (oldGuild.iconURL() !== newGuild.iconURL()) changes.push('Zmieniono ikone serwera');
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
      changes.push(`Kanal AFK: ${oldGuild.afkChannel?.name ?? '*brak*'} → ${newGuild.afkChannel?.name ?? '*brak*'}`);
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
      changes.push(`Poziom weryfikacji: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
    }

    if (changes.length === 0) return;

    const executor = await serverLogs.findExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);

    await serverLogs.send(newGuild, 'server', {
      title: 'Ustawienia serwera zmienione',
      color: COLORS.info,
      fields: [
        { name: 'Zmiany', value: truncate(changes.map((change) => `• ${change}`).join('\n'), 1200) },
        ...serverLogs.executorField(executor),
      ],
    });
  },
};
