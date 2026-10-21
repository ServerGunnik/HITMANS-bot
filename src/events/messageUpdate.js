'use strict';

const { Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');
const { truncate } = require('../utils/format');

/** Log edycji wiadomosci (przed i po). */
module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return;

    // Zmiany osadzonych podgladow linkow nie sa edycja tresci.
    if (oldMessage.content === newMessage.content) return;

    if (
      serverLogs.isIgnored(newMessage.guild, {
        channelId: newMessage.channelId,
        userId: newMessage.author?.id,
        roleIds: newMessage.member ? [...newMessage.member.roles.cache.keys()] : [],
      })
    ) {
      return;
    }

    await serverLogs.send(newMessage.guild, 'messages', {
      title: 'Wiadomosc edytowana',
      color: COLORS.warning,
      fields: [
        { name: 'Autor', value: newMessage.author ? serverLogs.describeUser(newMessage.author) : 'nieznany' },
        { name: 'Kanal', value: `${newMessage.channel}`, inline: true },
        { name: 'Przejdz', value: `[do wiadomosci](${newMessage.url})`, inline: true },
        { name: 'Przed', value: truncate(oldMessage.content || '*niedostepne (poza cache)*', 900) },
        { name: 'Po', value: truncate(newMessage.content || '*brak tresci*', 900) },
      ],
      footer: newMessage.author ? `ID autora: ${newMessage.author.id}` : undefined,
    });
  },
};
