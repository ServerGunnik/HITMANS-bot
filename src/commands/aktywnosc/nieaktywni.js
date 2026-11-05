'use strict';

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const inactivity = require('../../services/inactivity');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nieaktywni')
    .setDescription('Czlonkowie klanu bez wiadomosci i rozmow glosowych od N dni (oficerowie)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((option) =>
      option
        .setName('dni')
        .setDescription('Ile dni bez aktywnosci (domyslnie 14)')
        .setMinValue(1)
        .setMaxValue(365)
        .setRequired(false),
    ),

  cooldown: 10,

  async execute(interaction) {
    if (!inactivity.isOfficer(interaction.member)) {
      return reply.error(interaction, 'Ta komenda jest dostepna tylko dla oficerow i administracji.');
    }

    const days = interaction.options.getInteger('dni') ?? inactivity.DEFAULT_DAYS;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await inactivity.collectInactive(interaction.guild, { days });
    return reply.panel(interaction, inactivity.buildInactivePanel(result));
  },
};
