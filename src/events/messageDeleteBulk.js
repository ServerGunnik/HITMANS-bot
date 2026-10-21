'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');
const { truncate } = require('../utils/format');

/** Log masowego czyszczenia wiadomosci (np. narzedziem moderacyjnym). */
module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    const guild = channel?.guild;
    if (!guild) return;
    if (serverLogs.isIgnored(guild, { channelId: channel.id })) return;

    const executor = await serverLogs.findExecutor(guild, AuditLogEvent.MessageBulkDelete, channel.id);

    const authors = new Map();
    for (const message of messages.values()) {
      if (!message.author) continue;
      authors.set(message.author.id, (authors.get(message.author.id) ?? 0) + 1);
    }

    const breakdown = [...authors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => `<@${userId}> — ${count}`)
      .join('\n');

    await serverLogs.send(guild, 'messages', {
      title: 'Masowe usuniecie wiadomosci',
      color: COLORS.danger,
      fields: [
        { name: 'Kanal', value: `${channel}`, inline: true },
        { name: 'Liczba wiadomosci', value: String(messages.size), inline: true },
        ...serverLogs.executorField(executor),
        ...(breakdown ? [{ name: 'Autorzy', value: truncate(breakdown, 900) }] : []),
      ],
    });
  },
};
