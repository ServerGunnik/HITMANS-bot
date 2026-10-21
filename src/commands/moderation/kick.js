'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const { canModerate } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Wyrzuca uzytkownika z serwera')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo wyrzucic').setRequired(true))
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod wyrzucenia').setMaxLength(500).setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('uzytkownik', true);
    const reason = interaction.options.getString('powod') ?? 'Nie podano powodu';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const check = canModerate(interaction.member, member, { actionName: 'wyrzucic' });
    if (!check.ok) return reply.error(interaction, check.reason);

    if (!member.kickable) {
      return reply.error(interaction, 'Nie moge wyrzucic tej osoby — sprawdz moje uprawnienia i hierarchie rol.');
    }

    await interaction.deferReply();

    return runAction(interaction, {
      action: 'kick',
      user: target,
      reason,
      perform: () => member.kick(`${interaction.user.tag}: ${reason}`),
      successText: (caseNumber) =>
        `**${target.tag}** zostal(a) wyrzucony(a) z serwera.${caseNumber ? ` Sprawa **#${caseNumber}**.` : ''}`,
    });
  },
};
