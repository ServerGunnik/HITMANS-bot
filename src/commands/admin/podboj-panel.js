'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const conquest = require('../../services/conquest');
const { V2_FLAGS, reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('podboj-panel')
    .setDescription('Publikuje panel do zlecania podbicia państw')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Gdzie opublikować panel (domyślnie bieżący)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option.setName('tytul').setDescription('Własny tytuł panelu').setMaxLength(100).setRequired(false),
    )
    .addStringOption((option) =>
      option.setName('opis').setDescription('Własny opis panelu').setMaxLength(1500).setRequired(false),
    ),

  async execute(interaction) {
    const settings = guilds.get(interaction.guild.id);

    if (!settings.conquest_category_id) {
      return reply.error(
        interaction,
        'Najpierw ustaw kategorię ticketów: `/konfiguracja podboj kategoria:@KATEGORIA`.',
      );
    }
    if (!settings.conquest_staff_role_id) {
      return reply.error(
        interaction,
        'Najpierw ustaw rolę staffu obsługującego tickety: `/konfiguracja podboj staff:@rola`.',
      );
    }

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.ViewChannel)) {
      return reply.error(interaction, `Nie mam uprawnień do pisania na kanale ${channel}.`);
    }

    const container = conquest.buildPanel({
      title: interaction.options.getString('tytul'),
      description: interaction.options.getString('opis'),
    });

    const message = await channel.send({
      components: [container],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    return reply.success(interaction, `Panel opublikowany: ${message.url}`);
  },
};
