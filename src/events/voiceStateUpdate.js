'use strict';

const { Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const voiceService = require('../services/voice');
const logger = require('../utils/logger');
const { COLORS } = require('../ui/components');

/** Log ruchu na kanalach glosowych: wejscia, wyjscia i przenosiny. */
module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const guild = newState.guild ?? oldState.guild;
    const member = newState.member ?? oldState.member;
    if (!guild || !member || member.user.bot) return;

    voiceService
      .handleVoiceUpdate(oldState, newState)
      .catch((error) => logger.warn('Temp voice:', error.message));

    if (oldState.channelId === newState.channelId) return;

    if (
      serverLogs.isIgnored(guild, {
        channelId: newState.channelId ?? oldState.channelId,
        userId: member.id,
        roleIds: [...member.roles.cache.keys()],
      })
    ) {
      return;
    }

    const nameOf = (state) => {
      const name = state.channel?.name;
      return name ? `\`${name}\`` : '`usuniety kanal`';
    };

    let title;
    let color;
    const fields = [{ name: 'Czlonek', value: serverLogs.describeUser(member.user) }];

    if (!oldState.channelId) {
      title = 'Dolaczenie do kanalu glosowego';
      color = COLORS.success;
      fields.push({ name: 'Kanal', value: nameOf(newState), inline: true });
    } else if (!newState.channelId) {
      title = 'Opuszczenie kanalu glosowego';
      color = COLORS.warning;
      fields.push({ name: 'Kanal', value: nameOf(oldState), inline: true });
    } else {
      title = 'Zmiana kanalu glosowego';
      color = COLORS.info;
      fields.push(
        { name: 'Z', value: nameOf(oldState), inline: true },
        { name: 'Do', value: nameOf(newState), inline: true },
      );
    }

    await serverLogs.send(guild, 'voice', { title, color, fields, footer: `ID: ${member.id}` });
  },
};
