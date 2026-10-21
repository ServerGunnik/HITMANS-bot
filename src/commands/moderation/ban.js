'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const moderationRepo = require('../../database/repositories/moderation');
const { canModerate } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');
const { parseDuration, humanDuration } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banuje uzytkownika na serwerze')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo zbanowac').setRequired(true))
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod bana').setMaxLength(500).setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('usun_wiadomosci')
        .setDescription('Ile dni wiadomosci usunac (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('czas')
        .setDescription('Czas bana, np. 7d, 12h (puste = na stale)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('uzytkownik', true);
    const reason = interaction.options.getString('powod') ?? 'Nie podano powodu';
    const deleteDays = interaction.options.getInteger('usun_wiadomosci') ?? 0;
    const durationInput = interaction.options.getString('czas');

    let durationMs = null;
    if (durationInput) {
      durationMs = parseDuration(durationInput);
      if (!durationMs) {
        return reply.error(interaction, 'Nieprawidlowy format czasu. Przyklady: `30m`, `12h`, `7d`, `2h30m`.');
      }
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (member) {
      const check = canModerate(interaction.member, member, { actionName: 'zbanowac' });
      if (!check.ok) return reply.error(interaction, check.reason);
      if (!member.bannable) {
        return reply.error(interaction, 'Nie moge zbanowac tej osoby — sprawdz moje uprawnienia i hierarchie rol.');
      }
    }

    const existing = await interaction.guild.bans.fetch(target.id).catch(() => null);
    if (existing) return reply.error(interaction, 'Ten uzytkownik jest juz zbanowany.');

    await interaction.deferReply();

    return runAction(interaction, {
      action: 'ban',
      user: target,
      reason,
      durationMs,
      dmFields: durationMs ? [] : [{ name: 'Rodzaj', value: 'Ban staly', inline: true }],
      extraLogFields: [
        { name: 'Usuniete wiadomosci', value: deleteDays > 0 ? `z ${deleteDays} dni` : 'brak', inline: true },
        { name: 'Rodzaj', value: durationMs ? `czasowy (${humanDuration(durationMs)})` : 'staly', inline: true },
      ],
      perform: async () => {
        await interaction.guild.bans.create(target.id, {
          reason: `${interaction.user.tag}: ${reason}`,
          deleteMessageSeconds: deleteDays * 24 * 60 * 60,
        });

        // Ban czasowy zapisujemy w bazie - scheduler zdejmie go takze po restarcie bota.
        if (durationMs) {
          moderationRepo.addTempBan({
            guildId: interaction.guild.id,
            userId: target.id,
            expiresAt: Date.now() + durationMs,
            reason,
          });
        }
      },
      successText: (caseNumber) =>
        `**${target.tag}** zostal(a) zbanowany(a)${durationMs ? ` na ${humanDuration(durationMs)}` : ' na stale'}.` +
        `${caseNumber ? ` Sprawa **#${caseNumber}**.` : ''}`,
    });
  },
};
