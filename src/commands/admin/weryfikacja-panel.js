'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const verification = require('../../services/verification');
const { V2_FLAGS, reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weryfikacja-panel')
    .setDescription('Publikuje panel weryfikacji z przyciskiem captcha')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Gdzie opublikowac panel (domyslnie biezacy)')
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
    const settings = guilds.get(interaction.guild.id);

    if (!settings.verification_enabled) {
      return reply.error(
        interaction,
        'Weryfikacja jest wylaczona. Wlacz komenda `/konfiguracja weryfikacja wlaczona:true`.',
      );
    }
    if (!settings.verification_role_id) {
      return reply.error(
        interaction,
        'Ustaw najpierw role weryfikacji: `/konfiguracja weryfikacja rola:@rola`.',
      );
    }

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.ViewChannel)) {
      return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
    }

    const container = verification.buildPanel({
      title: interaction.options.getString('tytul'),
      description: interaction.options.getString('opis'),
    });

    const message = await channel.send({
      components: [container],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    guilds.update(interaction.guild.id, { verification_channel_id: channel.id });

    return reply.success(interaction, `Panel weryfikacji opublikowany: ${message.url}`);
  },
};
