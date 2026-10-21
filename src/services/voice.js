'use strict';

const {
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  UserSelectMenuBuilder,
} = require('discord.js');

const guilds = require('../database/repositories/guilds');
const voiceRepo = require('../database/repositories/voice');
const { COLORS, EMOJI, button, panel, row, V2_FLAGS } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'kanal';
const EMPTY_GRACE_MS = 10 * 1000;

/** Kanaly ktore czekaja na usuniecie (pusty przez chwile) — key: channelId -> timeout id. */
const pendingDeletes = new Map();

function buildPanel(ownerId) {
  return panel({
    color: COLORS.info,
    title: `${EMOJI.chart ?? '🎙️'} Panel kontroli kanalu`,
    description:
      `Wlasciciel: <@${ownerId}>\n` +
      'Zarzadzaj kanalem przyciskami ponizej — dziala tylko dla wlasciciela (i adminow).',
    rows: [
      row(
        button({ id: customId(NAMESPACE, 'rename'), label: 'Zmien nazwe', style: 'secondary', emoji: '✏️' }),
        button({ id: customId(NAMESPACE, 'limit'), label: 'Limit osob', style: 'secondary', emoji: '👥' }),
        button({ id: customId(NAMESPACE, 'lock'), label: 'Zablokuj', style: 'secondary', emoji: '🔒' }),
        button({ id: customId(NAMESPACE, 'unlock'), label: 'Odblokuj', style: 'secondary', emoji: '🔓' }),
      ),
      row(
        button({ id: customId(NAMESPACE, 'transfer'), label: 'Przekaz wlasnosc', style: 'secondary', emoji: '👤' }),
        button({ id: customId(NAMESPACE, 'kick'), label: 'Wyrzuc osobe', style: 'danger', emoji: '🚫' }),
        button({ id: customId(NAMESPACE, 'close'), label: 'Zamknij kanal', style: 'danger', emoji: '🛑' }),
      ),
    ],
    footer: 'Kanal usuwa sie automatycznie po opuszczeniu przez ostatnia osobe.',
  });
}

function buildUserSelect(action, placeholder) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(customId(NAMESPACE, action))
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);
  return new ActionRowBuilder().addComponents(select);
}

/** Nazwa domyslna dla nowo utworzonego kanalu. */
function defaultName(displayName) {
  return truncate(`Kanal ${displayName}`, 100);
}

/** Tworzy nowy kanal glosowy w kategorii huba i przenosi do niego czlonka. */
async function createForMember(member, hubChannel) {
  const guild = member.guild;
  const settings = guilds.get(guild.id);
  const parentId = settings.voice_hub_category_id ?? hubChannel.parentId ?? null;

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    logger.warn('Brak uprawnien ManageChannels — nie moge utworzyc kanalu glosowego.');
    return null;
  }

  const existing = voiceRepo.findByOwner(guild.id, member.id);
  if (existing) {
    const channel = guild.channels.cache.get(existing.channel_id);
    if (channel) {
      await member.voice.setChannel(channel).catch(() => {});
      return channel;
    }
    voiceRepo.remove(existing.channel_id);
  }

  const channel = await guild.channels.create({
    name: defaultName(member.displayName),
    type: ChannelType.GuildVoice,
    parent: parentId,
    permissionOverwrites: [
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
          PermissionFlagsBits.PrioritySpeaker,
          PermissionFlagsBits.Connect,
        ],
      },
    ],
    reason: `Tymczasowy kanal glosowy dla ${member.user.tag}`,
  });

  voiceRepo.create({ channelId: channel.id, guildId: guild.id, ownerId: member.id });

  await member.voice.setChannel(channel).catch((error) => {
    logger.debug(`Nie moglem przeniesc ${member.user.tag}:`, error.message);
  });

  // Panel kontrolny w wewnetrznym czacie kanalu glosowego.
  try {
    const message = await channel.send({
      components: [buildPanel(member.id)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
    voiceRepo.setPanelMessage(channel.id, message.id);
  } catch (error) {
    logger.debug(`Nie moglem opublikowac panelu kanalu ${channel.id}:`, error.message);
  }

  return channel;
}

/** Usuwa kanal jesli jest pusty. Wywolywane po opoznieniu. */
async function deleteIfEmpty(guild, channelId) {
  pendingDeletes.delete(channelId);

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    voiceRepo.remove(channelId);
    return;
  }
  if (channel.members.size > 0) return;

  try {
    await channel.delete('Tymczasowy kanal glosowy — brak uczestnikow');
  } catch (error) {
    logger.debug(`Nie moglem usunac kanalu ${channelId}:`, error.message);
  }
  voiceRepo.remove(channelId);
}

function scheduleDelete(guild, channelId) {
  if (pendingDeletes.has(channelId)) return;
  const timer = setTimeout(() => deleteIfEmpty(guild, channelId), EMPTY_GRACE_MS);
  timer.unref?.();
  pendingDeletes.set(channelId, timer);
}

function cancelPendingDelete(channelId) {
  const timer = pendingDeletes.get(channelId);
  if (timer) {
    clearTimeout(timer);
    pendingDeletes.delete(channelId);
  }
}

/** Wybiera nowego wlasciciela — najdluzej podlaczonego czlonka. */
function pickNewOwner(channel) {
  const members = [...channel.members.values()].filter((member) => !member.user.bot);
  if (members.length === 0) return null;
  return members.sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0))[0];
}

async function transferOwnership(channel, newOwner, { silent = false } = {}) {
  const record = voiceRepo.get(channel.id);
  if (!record) return;

  const previousOwnerId = record.owner_id;

  try {
    if (previousOwnerId && previousOwnerId !== newOwner.id) {
      await channel.permissionOverwrites.delete(previousOwnerId, 'Przekazanie wlasnosci kanalu').catch(() => {});
    }
    await channel.permissionOverwrites.edit(newOwner.id, {
      ManageChannels: true,
      MoveMembers: true,
      MuteMembers: true,
      DeafenMembers: true,
      PrioritySpeaker: true,
      Connect: true,
    });
  } catch (error) {
    logger.debug(`Nie moglem zaktualizowac overrides kanalu ${channel.id}:`, error.message);
  }

  voiceRepo.transferOwner(channel.id, newOwner.id);

  if (!silent) {
    await channel.send({
      components: [
        panel({
          color: COLORS.info,
          description: `👑 Nowy wlasciciel kanalu: ${newOwner}.`,
        }),
      ],
      flags: V2_FLAGS,
      allowedMentions: { users: [newOwner.id] },
    }).catch(() => {});
  }
}

/** Wywolywane z eventu voiceStateUpdate — obsluguje huba i sprzatanie temp-kanalow. */
async function handleVoiceUpdate(oldState, newState) {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  if (!guild || !member || member.user.bot) return;

  const settings = guilds.get(guild.id);

  // Dolaczenie do huba -> stworz kanal dla uzytkownika.
  if (settings.voice_hub_channel_id && newState.channelId === settings.voice_hub_channel_id) {
    const hubChannel = guild.channels.cache.get(settings.voice_hub_channel_id);
    if (hubChannel) await createForMember(member, hubChannel);
  }

  // Opuszczenie temp-kanalu -> sprawdz, czy zamykac lub przekazac wlasnosc.
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const record = voiceRepo.get(oldState.channelId);
    if (record) {
      const channel = guild.channels.cache.get(oldState.channelId);
      if (!channel) {
        voiceRepo.remove(oldState.channelId);
        return;
      }

      const humanMembers = [...channel.members.values()].filter((entry) => !entry.user.bot);

      if (humanMembers.length === 0) {
        scheduleDelete(guild, oldState.channelId);
      } else if (record.owner_id === member.id) {
        const newOwner = pickNewOwner(channel);
        if (newOwner) await transferOwnership(channel, newOwner);
      }
    }
  }

  // Ktos wrocil do pustego temp-kanalu (byl zaplanowany do usuniecia) -> anuluj usuwanie.
  if (newState.channelId) {
    const record = voiceRepo.get(newState.channelId);
    if (record) cancelPendingDelete(newState.channelId);
  }
}

/** Sprzatanie po restarcie: usuwa martwe wpisy z bazy i puste kanaly. */
async function cleanupOrphans(client) {
  const records = voiceRepo.listAllChannels();
  for (const record of records) {
    const guild = client.guilds.cache.get(record.guild_id);
    if (!guild) {
      voiceRepo.remove(record.channel_id);
      continue;
    }
    const channel = guild.channels.cache.get(record.channel_id);
    if (!channel) {
      voiceRepo.remove(record.channel_id);
      continue;
    }
    const humans = [...channel.members.values()].filter((member) => !member.user.bot);
    if (humans.length === 0) {
      await channel.delete('Sprzatanie po restarcie — pusty tymczasowy kanal').catch(() => {});
      voiceRepo.remove(record.channel_id);
    }
  }
}

module.exports = {
  NAMESPACE,
  buildPanel,
  buildUserSelect,
  createForMember,
  handleVoiceUpdate,
  transferOwnership,
  pickNewOwner,
  cleanupOrphans,
  scheduleDelete,
  cancelPendingDelete,
};
