'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const moderation = require('../../database/repositories/moderation');
const { canModerate, canManageRole } = require('../../utils/permissions');
const { runAction } = require('../../services/moderation');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Zdejmuje wyciszenie z uzytkownika (tekst lub glos)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('tekst')
        .setDescription('Odbiera role wyciszenia')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Komu zdjac wyciszenie').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('powod').setDescription('Powod').setMaxLength(500).setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('glos')
        .setDescription('Zdejmuje wyciszenie glosowe')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Komu zdjac wyciszenie glosowe').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('powod').setDescription('Powod').setMaxLength(500).setRequired(false),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const target = interaction.options.getUser('uzytkownik', true);
    const reason = interaction.options.getString('powod') ?? 'Nie podano';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return reply.error(interaction, `${target} nie jest juz na tym serwerze.`);

    const check = canModerate(interaction.member, member, { actionName: 'zdjac wyciszenie' });
    if (!check.ok) return reply.error(interaction, check.reason);

    await interaction.deferReply();

    if (subcommand === 'tekst') {
      const settings = guilds.get(interaction.guild.id);
      if (!settings.mute_role_id) {
        return reply.error(interaction, 'Nie skonfigurowano roli wyciszenia — nie mam czego zdejmowac.');
      }

      const role = interaction.guild.roles.cache.get(settings.mute_role_id);
      if (!role) return reply.error(interaction, 'Skonfigurowana rola wyciszenia juz nie istnieje.');

      const roleCheck = canManageRole(interaction.guild, role);
      if (!roleCheck.ok) return reply.error(interaction, roleCheck.reason);

      if (!member.roles.cache.has(role.id)) {
        return reply.error(interaction, `${target} nie ma roli wyciszenia.`);
      }

      return runAction(interaction, {
        action: 'unmute_text',
        user: target,
        reason,
        perform: async () => {
          await member.roles.remove(role, `Zdjecie wyciszenia tekstowego przez ${interaction.user.tag}: ${reason}`);
          moderation.removeMute(interaction.guild.id, target.id, 'text');
        },
        successText: () => `💬 **${target.tag}** moze znowu pisac.`,
      });
    }

    // glos
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return reply.error(interaction, 'Brakuje mi uprawnienia **Wyciszanie czlonkow**.');
    }
    if (!member.voice.channel) {
      return reply.error(interaction, `${target} nie jest podlaczony(a) do kanalu glosowego.`);
    }
    if (!member.voice.serverMute) {
      return reply.error(interaction, `${target} nie jest wyciszony(a) serwerowo.`);
    }

    return runAction(interaction, {
      action: 'unmute_voice',
      user: target,
      reason,
      perform: async () => {
        await member.voice.setMute(false, `Zdjecie wyciszenia glosowego przez ${interaction.user.tag}: ${reason}`);
        moderation.removeMute(interaction.guild.id, target.id, 'voice');
      },
      successText: () => `🎙️ **${target.tag}** moze znowu mowic na kanalach glosowych.`,
    });
  },
};
