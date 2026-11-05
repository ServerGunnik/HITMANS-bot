'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const ticketsRepo = require('../../database/repositories/supportTickets');
const tickets = require('../../services/supportTickets');
const { V2_FLAGS, reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Tickety pomocy: konfiguracja i panel z kategoriami')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('opublikuj')
        .setDescription('Publikuje panel ticketow na kanale')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Gdzie opublikowac panel (domyslnie biezacy)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((option) => option.setName('tytul').setDescription('Wlasny tytul panelu').setMaxLength(100))
        .addStringOption((option) => option.setName('opis').setDescription('Wlasny opis panelu').setMaxLength(1500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ustaw')
        .setDescription('Kategoria kanalow, rola obslugi i kanal transkrypcji')
        .addChannelOption((option) =>
          option
            .setName('kategoria')
            .setDescription('Kategoria, w ktorej powstaja kanaly ticketow')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rola-obslugi').setDescription('Rola, ktora widzi i obsluguje tickety').setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('kanal-logow')
            .setDescription('Kanal na transkrypcje zamknietych ticketow')
            .addChannelTypes(ChannelType.GuildText),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'ustaw') {
      const category = interaction.options.getChannel('kategoria');
      const role = interaction.options.getRole('rola-obslugi');
      const logChannel = interaction.options.getChannel('kanal-logow');

      const patch = { category_id: category.id, staff_role_id: role.id };
      if (logChannel) patch.log_channel_id = logChannel.id;
      const settings = ticketsRepo.updateSettings(guildId, patch);

      return reply.success(
        interaction,
        `Tickety pomocy beda tworzone w kategorii **${category.name}**, obsluguje je ${role}.\n` +
          (settings.log_channel_id
            ? `Transkrypcje trafia na <#${settings.log_channel_id}>.`
            : 'Nie ustawiono kanalu logow — transkrypcje trafia tylko do zglaszajacych (opcja `kanal-logow`).') +
          '\nOpublikuj panel: `/ticket-panel opublikuj`.',
      );
    }

    if (sub === 'opublikuj') {
      const settings = ticketsRepo.getSettings(guildId);
      if (!settings.category_id || !settings.staff_role_id) {
        return reply.error(interaction, 'Najpierw ustaw kategorie i role obslugi: `/ticket-panel ustaw`.');
      }

      const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
      const permissions = channel.permissionsFor?.(interaction.guild.members.me);
      if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.ViewChannel)) {
        return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
      }

      const message = await channel.send({
        components: [
          tickets.buildPanel({
            title: interaction.options.getString('tytul'),
            description: interaction.options.getString('opis'),
          }),
        ],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      return reply.success(interaction, `Panel ticketow opublikowany: ${message.url}`);
    }

    return reply.error(interaction, 'Nieznana podkomenda.');
  },
};
