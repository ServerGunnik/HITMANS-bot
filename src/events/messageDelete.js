'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');

/** Log usunietej wiadomosci wraz z ustaleniem, kto ja usunal. */
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;

    if (
      serverLogs.isIgnored(message.guild, {
        channelId: message.channelId,
        userId: message.author?.id,
        roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
      })
    ) {
      return;
    }

    // Wiadomosci spoza cache docieraja jako "partial" — bez tresci i autora.
    const partial = message.partial || !message.author;

    const executor = message.author
      ? await serverLogs.findExecutor(message.guild, AuditLogEvent.MessageDelete, message.author.id)
      : null;

    const attachments = message.attachments?.size
      ? [...message.attachments.values()].map((file) => `[${file.name}](${file.url})`).join(', ')
      : null;

    await serverLogs.send(message.guild, 'messages', {
      title: 'Wiadomosc usunieta',
      color: COLORS.danger,
      fields: [
        { name: 'Autor', value: message.author ? serverLogs.describeUser(message.author) : 'nieznany (poza cache)' },
        { name: 'Kanal', value: `${message.channel}`, inline: true },
        ...(message.createdAt ? [{ name: 'Wyslana', value: timestamp(message.createdAt, 'R'), inline: true }] : []),
        ...serverLogs.executorField(executor),
        {
          name: 'Tresc',
          value: partial && !message.content
            ? '*niedostepna — wiadomosc nie byla w pamieci bota*'
            : truncate(message.content || '*brak tresci*', 1500),
        },
        ...(attachments ? [{ name: 'Zalaczniki', value: truncate(attachments, 500) }] : []),
      ],
      footer: message.author ? `ID autora: ${message.author.id} • ID wiadomosci: ${message.id}` : undefined,
    });
  },
};
