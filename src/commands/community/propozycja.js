'use strict';

const {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const suggestionsRepo = require('../../database/repositories/suggestions');
const suggestionsService = require('../../services/suggestions');
const { COLORS, panel, reply } = require('../../ui/components');
const { timestamp, truncate } = require('../../utils/format');
const logger = require('../../utils/logger');

const propozycja = {
  data: new SlashCommandBuilder()
    .setName('propozycja')
    .setDescription('Zglasza propozycje dla serwera / klanu')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('tresc')
        .setDescription('Twoja propozycja')
        .setMinLength(10)
        .setMaxLength(suggestionsService.MAX_CONTENT)
        .setRequired(true),
    ),

  cooldown: 30,

  async execute(interaction) {
    const channelId = suggestionsRepo.getChannel(interaction.guild.id);
    const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
    if (!channel) {
      return reply.error(interaction, 'Kanal propozycji nie jest ustawiony. Administrator moze go ustawic: `/propozycje kanal`.');
    }

    const permissions = channel.permissionsFor?.(interaction.guild.members.me);
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
      return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const suggestion = suggestionsRepo.create({
      guildId: interaction.guild.id,
      channelId: channel.id,
      authorId: interaction.user.id,
      content: interaction.options.getString('tresc', true).trim(),
    });

    try {
      const { message, threadId } = await suggestionsService.publish(channel, suggestion);
      return reply.success(
        interaction,
        `Propozycja **#${suggestion.id}** opublikowana: ${message.url}` +
          (threadId ? `\nDyskusja toczy sie w watku <#${threadId}>.` : ''),
      );
    } catch (error) {
      logger.warn(`Nie udalo sie opublikowac propozycji #${suggestion.id}:`, error.message);
      suggestionsRepo.remove(suggestion.id);
      return reply.error(interaction, 'Nie udalo sie opublikowac propozycji. Sprobuj ponownie pozniej.');
    }
  },
};

const STATUS_OPTIONS = [
  { name: 'Przyjeta', value: 'przyjeta' },
  { name: 'Odrzucona', value: 'odrzucona' },
  { name: 'W realizacji', value: 'w-realizacji' },
];

const propozycje = {
  data: new SlashCommandBuilder()
    .setName('propozycje')
    .setDescription('Zarzadzanie propozycjami (admin)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Ustawia kanal propozycji (bez opcji = wylacza)')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal, na ktory trafiaja propozycje')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Zmienia status propozycji i powiadamia autora')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Numer propozycji').setAutocomplete(true).setMinValue(1).setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('status').setDescription('Nowy status').addChoices(...STATUS_OPTIONS).setRequired(true),
        )
        .addStringOption((option) => option.setName('powod').setDescription('Uzasadnienie decyzji').setMaxLength(500)),
    ),

  async autocomplete(interaction) {
    const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
    const choices = suggestionsRepo
      .listRecent(interaction.guild.id, 100)
      .filter((entry) => `${entry.id} ${entry.content}`.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((entry) => ({
        name: truncate(`#${entry.id} [${suggestionsService.STATUS_META[entry.status].label}] ${entry.content.replace(/\s+/g, ' ')}`, 100),
        value: entry.id,
      }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'kanal') {
      const channel = interaction.options.getChannel('kanal');
      suggestionsRepo.setChannel(interaction.guild.id, channel?.id ?? null);
      return channel
        ? reply.success(interaction, `Propozycje beda publikowane na kanale ${channel}.`)
        : reply.warning(interaction, 'Kanal propozycji zostal wylaczony — `/propozycja` nie bedzie dzialac.');
    }

    // status
    const suggestion = suggestionsRepo.getForGuild(interaction.guild.id, interaction.options.getInteger('id', true));
    if (!suggestion) return reply.error(interaction, 'Nie znalazlem propozycji o tym numerze.');

    const status = suggestionsService.STATUS_CHOICES[interaction.options.getString('status', true)];
    const reason = interaction.options.getString('powod')?.trim() || null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await suggestionsService.changeStatus(interaction.guild, suggestion, {
      status,
      reason,
      moderatorId: interaction.user.id,
    });
    const meta = suggestionsService.STATUS_META[status];

    return reply.panel(
      interaction,
      panel({
        color: meta.color,
        title: `${meta.emoji} Propozycja #${suggestion.id}: ${meta.label}`,
        fields: [
          { name: 'Karta', value: result.cardUpdated ? 'zaktualizowana' : '⚠️ nie udalo sie odswiezyc wiadomosci', inline: true },
          { name: 'Autor', value: result.dmSent ? 'powiadomiony w DM' : '⚠️ DM niedostarczony (zablokowane wiadomosci)', inline: true },
          { name: 'Zgloszona', value: timestamp(suggestion.created_at, 'R'), inline: true },
        ],
      }),
    );
  },
};

module.exports = [propozycja, propozycje];
