'use strict';

const { AuditLogEvent, ChannelType, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const security = require('../services/security');
const { COLORS } = require('../ui/components');
const { truncate } = require('../utils/format');

/**
 * Logi kanalow. Plik eksportuje trzy event handlery (tworzenie, usuniecie,
 * edycja), bo dziela opis kanalu i sposob ustalania sprawcy.
 */

const TYPE_LABELS = {
  [ChannelType.GuildText]: 'tekstowy',
  [ChannelType.GuildVoice]: 'glosowy',
  [ChannelType.GuildCategory]: 'kategoria',
  [ChannelType.GuildAnnouncement]: 'ogloszeniowy',
  [ChannelType.GuildStageVoice]: 'scena',
  [ChannelType.GuildForum]: 'forum',
  [ChannelType.GuildMedia]: 'medialny',
};

function describeChannel(channel) {
  return `${channel} \`${channel.name}\` • ${TYPE_LABELS[channel.type] ?? 'inny'}`;
}

module.exports = [
  {
    name: Events.ChannelCreate,
    async execute(channel) {
      if (!channel.guild) return;
      const executor = await serverLogs.findExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

      await serverLogs.send(channel.guild, 'channels', {
        title: 'Kanal utworzony',
        color: COLORS.success,
        fields: [
          { name: 'Kanal', value: describeChannel(channel) },
          ...(channel.parent ? [{ name: 'Kategoria', value: channel.parent.name, inline: true }] : []),
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${channel.id}`,
      });
    },
  },
  {
    name: Events.ChannelDelete,
    async execute(channel) {
      if (!channel.guild) return;
      const executor = await serverLogs.findExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

      if (executor) {
        await security.recordNukeAction(channel.guild, executor, 'channel_delete').catch(() => {});
      }

      await serverLogs.send(channel.guild, 'channels', {
        title: 'Kanal usuniety',
        color: COLORS.danger,
        fields: [
          { name: 'Kanal', value: `\`${channel.name}\` • ${TYPE_LABELS[channel.type] ?? 'inny'}` },
          ...(channel.parent ? [{ name: 'Kategoria', value: channel.parent.name, inline: true }] : []),
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${channel.id}`,
      });
    },
  },
  {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
      if (!newChannel.guild) return;

      const changes = [];
      if (oldChannel.name !== newChannel.name) changes.push(`Nazwa: \`${oldChannel.name}\` → \`${newChannel.name}\``);
      if (oldChannel.topic !== newChannel.topic) {
        changes.push(`Temat: ${truncate(oldChannel.topic || '*brak*', 150)} → ${truncate(newChannel.topic || '*brak*', 150)}`);
      }
      if (oldChannel.nsfw !== newChannel.nsfw) changes.push(`NSFW: ${oldChannel.nsfw ? 'tak' : 'nie'} → ${newChannel.nsfw ? 'tak' : 'nie'}`);
      if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`Tryb powolny: ${oldChannel.rateLimitPerUser ?? 0}s → ${newChannel.rateLimitPerUser ?? 0}s`);
      }
      if (oldChannel.parentId !== newChannel.parentId) {
        changes.push(`Kategoria: ${oldChannel.parent?.name ?? '*brak*'} → ${newChannel.parent?.name ?? '*brak*'}`);
      }

      // Zmiany uprawnien maja wlasny, zwiezly wpis — pelny diff bylby nieczytelny.
      if (oldChannel.permissionOverwrites?.cache.size !== newChannel.permissionOverwrites?.cache.size) {
        changes.push('Zmieniono uprawnienia kanalu');
      }

      if (changes.length === 0) return;

      const executor = await serverLogs.findExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);

      await serverLogs.send(newChannel.guild, 'channels', {
        title: 'Kanal zmieniony',
        color: COLORS.info,
        fields: [
          { name: 'Kanal', value: describeChannel(newChannel) },
          { name: 'Zmiany', value: truncate(changes.map((change) => `• ${change}`).join('\n'), 1200) },
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${newChannel.id}`,
      });
    },
  },
];
