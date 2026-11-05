'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const levelsRepo = require('../../database/repositories/levels');
const levelsService = require('../../services/levels');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poziom')
    .setDescription('Pokazuje poziom, XP i miejsce w rankingu')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('uzytkownik').setDescription('Czyj poziom pokazac (domyslnie Twoj)').setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    if (!levelsRepo.getSettings(interaction.guild.id).enabled) {
      return reply.error(interaction, 'System poziomow jest wylaczony na tym serwerze.');
    }

    const target = interaction.options.getUser('uzytkownik') ?? interaction.user;
    if (target.bot) return reply.error(interaction, 'Boty nie zbieraja XP.');

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return reply.error(interaction, 'Ten uzytkownik nie jest czlonkiem tego serwera.');

    return reply.panel(interaction, levelsService.buildLevelCard(member), { ephemeral: false });
  },
};
