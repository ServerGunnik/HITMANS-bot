'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const { canModerate } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');
const { humanDuration, parseDuration } = require('../../utils/format');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limit Discorda: 28 dni

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Wycisza uzytkownika na okreslony czas')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo wyciszyc').setRequired(true))
    .addStringOption((option) =>
      option
        .setName('czas')
        .setDescription('Czas wyciszenia, np. 10m, 2h, 1d (max 28d, "0" zdejmuje wyciszenie)')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod wyciszenia').setMaxLength(500).setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('uzytkownik', true);
    const czas = interaction.options.getString('czas', true);
    const reason = interaction.options.getString('powod') ?? 'Nie podano powodu';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const check = canModerate(interaction.member, member, { actionName: 'wyciszyc' });
    if (!check.ok) return reply.error(interaction, check.reason);

    if (!member.moderatable) {
      return reply.error(interaction, 'Nie moge wyciszyc tej osoby — sprawdz moje uprawnienia i hierarchie rol.');
    }

    // "0" / "zdejmij" zdejmuje aktywne wyciszenie.
    if (['0', 'zdejmij', 'off', 'usun'].includes(czas.toLowerCase())) {
      if (!member.isCommunicationDisabled()) {
        return reply.error(interaction, 'Ta osoba nie jest obecnie wyciszona.');
      }

      await interaction.deferReply();
      return runAction(interaction, {
        action: 'untimeout',
        user: target,
        reason,
        perform: () => member.timeout(null, `${interaction.user.tag}: ${reason}`),
        successText: () => `Wyciszenie uzytkownika **${target.tag}** zostalo zdjete.`,
      });
    }

    const durationMs = parseDuration(czas);
    if (!durationMs) {
      return reply.error(interaction, 'Nieprawidlowy format czasu. Przyklady: `10m`, `2h`, `1d`, `2h30m`.');
    }
    if (durationMs > MAX_TIMEOUT_MS) {
      return reply.error(interaction, 'Maksymalny czas wyciszenia to **28 dni**.');
    }

    await interaction.deferReply();

    return runAction(interaction, {
      action: 'timeout',
      user: target,
      reason,
      durationMs,
      perform: () => member.timeout(durationMs, `${interaction.user.tag}: ${reason}`),
      successText: (caseNumber) =>
        `**${target.tag}** zostal(a) wyciszony(a) na **${humanDuration(durationMs)}**.` +
        `${caseNumber ? ` Sprawa **#${caseNumber}**.` : ''}`,
    });
  },
};
