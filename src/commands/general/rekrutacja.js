'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const recruitmentService = require('../../services/recruitment');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rekrutacja')
    .setDescription('Wypelnij formularz rekrutacyjny do klanu')
    .setContexts(InteractionContextType.Guild),

  cooldown: 10,

  async execute(interaction) {
    const check = recruitmentService.canApply(interaction.member);
    if (!check.ok) return reply.error(interaction, check.reason);

    const modal = recruitmentService.buildApplicationModal(interaction.guild);
    if (!modal) {
      return reply.error(interaction, 'Formularz nie ma jeszcze zadnych pytan. Poinformuj administracje.');
    }

    return interaction.showModal(modal);
  },
};
