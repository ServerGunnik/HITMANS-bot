'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const moderation = require('../../database/repositories/moderation');
const { canModerate } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');
const { plural } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Nadaje ostrzezenie zapisywane w rejestrze uzytkownika')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo ostrzec').setRequired(true))
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod ostrzezenia').setMaxLength(500).setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('uzytkownik', true);
    const reason = interaction.options.getString('powod', true);

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const check = canModerate(interaction.member, member, { actionName: 'ostrzec' });
    if (!check.ok) return reply.error(interaction, check.reason);

    await interaction.deferReply();

    let warning = null;
    const total = () => moderation.countWarnings(interaction.guild.id, target.id);

    return runAction(interaction, {
      action: 'warn',
      user: target,
      reason,
      dmFields: [{ name: 'Lacznie ostrzezen', value: String(total() + 1), inline: true }],
      perform: () => {
        warning = moderation.addWarning({
          guildId: interaction.guild.id,
          userId: target.id,
          moderatorId: interaction.user.id,
          reason,
        });
      },
      extraLogFields: () => [{ name: 'Ostrzezenie', value: `ID: ${warning?.id ?? '—'}`, inline: true }],
      successText: (caseNumber) => {
        const count = total();
        return (
          `**${target.tag}** otrzymal(a) ostrzezenie — ma teraz **${count}** ` +
          `${plural(count, 'aktywne ostrzezenie', 'aktywne ostrzezenia', 'aktywnych ostrzezen')}.` +
          `${caseNumber ? ` Sprawa **#${caseNumber}**.` : ''}`
        );
      },
    });
  },
};
