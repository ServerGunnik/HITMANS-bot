'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const moderation = require('../../database/repositories/moderation');
const { canModerate, canManageRole } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');
const { humanDuration, parseDuration } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Wycisza uzytkownika — osobno na czacie i na kanalach glosowych')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('tekst')
        .setDescription('Nadaje role wyciszenia (blokuje pisanie na kanalach)')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Kogo wyciszyc').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('czas')
            .setDescription('Na jak dlugo (np. 30m, 2h, 1d). Pusty = na stale.')
            .setMaxLength(20)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('powod').setDescription('Powod wyciszenia').setMaxLength(500).setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('glos')
        .setDescription('Wycisza uzytkownika na kanalach glosowych (server mute)')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Kogo wyciszyc').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('czas')
            .setDescription('Na jak dlugo (np. 30m, 2h, 1d). Pusty = na stale.')
            .setMaxLength(20)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('powod').setDescription('Powod wyciszenia').setMaxLength(500).setRequired(false),
        ),
    ),

  async execute(interaction) {
    // Defer na starcie — czesc akcji ponizej (fetch member, roles) moze przekroczyc 3s okno Discorda.
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const target = interaction.options.getUser('uzytkownik', true);
    const reason = interaction.options.getString('powod') ?? 'Nie podano';
    const czas = interaction.options.getString('czas');

    let durationMs = null;
    if (czas) {
      durationMs = parseDuration(czas);
      if (!durationMs) {
        return reply.error(interaction, 'Nie rozumiem podanego czasu. Uzyj formatu jak `30m`, `2h`, `1d`.');
      }
      if (durationMs < 60 * 1000) {
        return reply.error(interaction, 'Minimalny czas wyciszenia to 1 minuta.');
      }
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const check = canModerate(interaction.member, member, { actionName: 'wyciszyc' });
    if (!check.ok) return reply.error(interaction, check.reason);

    if (subcommand === 'tekst') {
      const settings = guilds.get(interaction.guild.id);
      if (!settings.mute_role_id) {
        return reply.error(
          interaction,
          'Nie ustawiono roli wyciszenia. Ustaw: `/konfiguracja rola typ:wyciszenie rola:@Wyciszony`.',
        );
      }

      const role = interaction.guild.roles.cache.get(settings.mute_role_id);
      if (!role) {
        return reply.error(interaction, 'Skonfigurowana rola wyciszenia juz nie istnieje — ustaw ja ponownie.');
      }

      const roleCheck = canManageRole(interaction.guild, role);
      if (!roleCheck.ok) return reply.error(interaction, roleCheck.reason);

      if (member.roles.cache.has(role.id)) {
        return reply.error(interaction, `${target} juz ma role wyciszenia.`);
      }

      return runAction(interaction, {
        action: 'mute_text',
        user: target,
        reason,
        durationMs,
        perform: async () => {
          await member.roles.add(role, `Wyciszenie tekstowe przez ${interaction.user.tag}: ${reason}`);
          if (durationMs) {
            moderation.addMute({
              guildId: interaction.guild.id,
              userId: target.id,
              type: 'text',
              expiresAt: Date.now() + durationMs,
              reason,
              moderatorId: interaction.user.id,
            });
          } else {
            moderation.removeMute(interaction.guild.id, target.id, 'text');
          }
        },
        successText: () =>
          durationMs
            ? `**${target.tag}** wyciszony(a) tekstowo na **${humanDuration(durationMs)}**.`
            : `**${target.tag}** dostal(a) role wyciszenia — nie moze juz pisac.`,
      });
    }

    // glos
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return reply.error(interaction, 'Brakuje mi uprawnienia **Wyciszanie czlonkow**.');
    }
    if (!member.voice.channel) {
      return reply.error(interaction, `${target} nie jest podlaczony(a) do zadnego kanalu glosowego. Wyciszenie zadziala od nastepnego dolaczenia — chcesz go serwerowo oznaczyc?`);
    }
    if (member.voice.serverMute) {
      return reply.error(interaction, `${target} juz jest wyciszony(a) na glosowych.`);
    }

    return runAction(interaction, {
      action: 'mute_voice',
      user: target,
      reason,
      durationMs,
      perform: async () => {
        await member.voice.setMute(true, `Wyciszenie glosowe przez ${interaction.user.tag}: ${reason}`);
        if (durationMs) {
          moderation.addMute({
            guildId: interaction.guild.id,
            userId: target.id,
            type: 'voice',
            expiresAt: Date.now() + durationMs,
            reason,
            moderatorId: interaction.user.id,
          });
        } else {
          moderation.removeMute(interaction.guild.id, target.id, 'voice');
        }
      },
      successText: () =>
        durationMs
          ? `🎙️ **${target.tag}** wyciszony(a) glosowo na **${humanDuration(durationMs)}**.`
          : `🎙️ **${target.tag}** wyciszony(a) na kanalach glosowych.`,
    });
  },
};
