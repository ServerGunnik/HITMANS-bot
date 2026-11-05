'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const starboardRepo = require('../../database/repositories/starboard');
const { STAR } = require('../../services/starboard');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Tablica najlepszych wiadomosci (reakcje ⭐)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Ustawia kanal starboardu i wlacza funkcje')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal, na ktory trafiaja wyroznione wiadomosci')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('prog')
        .setDescription('Ile gwiazdek potrzeba, aby wiadomosc trafila na starboard')
        .addIntegerOption((option) =>
          option.setName('liczba').setDescription('Liczba gwiazdek (domyslnie 3)').setMinValue(1).setMaxValue(50).setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('wylacz').setDescription('Wylacza starboard (karty zostaja na kanale)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'kanal') {
      const channel = interaction.options.getChannel('kanal');
      const permissions = channel.permissionsFor?.(interaction.guild.members.me);
      if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages))) {
        return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
      }

      const settings = starboardRepo.updateSettings(guildId, { channel_id: channel.id, enabled: true });
      return reply.success(
        interaction,
        `Starboard wlaczony na ${channel}. Wiadomosci z **${settings.threshold}** ${STAR} trafia tam automatycznie.\n` +
          '-# Nie licza sie gwiazdki autora wiadomosci ani botow.',
      );
    }

    if (sub === 'prog') {
      const threshold = interaction.options.getInteger('liczba');
      const settings = starboardRepo.updateSettings(guildId, { threshold });
      return reply.success(
        interaction,
        `Prog starboardu: **${threshold}** ${STAR}.` +
          (settings.enabled ? '' : '\nStarboard jest wylaczony — wlacz go przez `/starboard kanal`.'),
      );
    }

    if (sub === 'wylacz') {
      starboardRepo.updateSettings(guildId, { enabled: false });
      return reply.success(interaction, 'Starboard wylaczony. Istniejace karty pozostaja na kanale.');
    }

    return reply.error(interaction, 'Nieznana podkomenda.');
  },
};
