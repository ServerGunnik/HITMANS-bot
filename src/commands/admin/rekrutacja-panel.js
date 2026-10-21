'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const recruitment = require('../../database/repositories/recruitment');
const recruitmentService = require('../../services/recruitment');
const { V2_FLAGS, reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rekrutacja-panel')
    .setDescription('Publikuje panel rekrutacji z przyciskiem do formularza')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Gdzie opublikowac panel (domyslnie biezacy kanal)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option.setName('tytul').setDescription('Wlasny tytul panelu').setMaxLength(100).setRequired(false),
    )
    .addStringOption((option) =>
      option.setName('opis').setDescription('Wlasny opis panelu').setMaxLength(1500).setRequired(false),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const settings = guilds.get(interaction.guild.id);

    if (recruitment.countQuestions(interaction.guild.id, 'applicant') === 0) {
      return reply.error(
        interaction,
        'Formularz kandydata nie ma jeszcze pytan. Dodaj je komenda `/pytania panel` lub `/pytania domyslne`.',
      );
    }

    if (!settings.applications_channel_id) {
      return reply.error(
        interaction,
        'Najpierw ustaw kanal zgloszen: `/konfiguracja kanal typ:zgloszenia kanal:#kanal`.',
      );
    }

    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.ViewChannel)) {
      return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
    }

    const container = recruitmentService.buildRecruitmentPanel(interaction.guild, {
      title: interaction.options.getString('tytul'),
      description: interaction.options.getString('opis'),
    });

    const message = await channel.send({
      components: [container],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    return reply.success(interaction, `Panel rekrutacji opublikowany: ${message.url}`);
  },
};
