'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const giveawaysRepo = require('../../database/repositories/giveaways');
const giveawaysService = require('../../services/giveaways');
const { isAdmin } = require('../../utils/permissions');
const { V2_FLAGS, reply } = require('../../ui/components');
const { parseDuration } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Losowania z nagrodami')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Uruchamia nowe losowanie')
        .addStringOption((option) =>
          option.setName('nagroda').setDescription('Co losujemy').setMaxLength(200).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('czas')
            .setDescription('Po jakim czasie zakonczyc (np. 30m, 2h, 1d)')
            .setMaxLength(20)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('zwyciezcy')
            .setDescription('Ilu zwyciezcow (domyslnie 1)')
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false),
        )
        .addRoleOption((option) =>
          option
            .setName('wymagana_rola')
            .setDescription('Tylko osoby z ta rola moga dolaczyc')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reroll')
        .setDescription('Losuje ponownie zwyciezcow zakonczonego losowania')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID losowania').setMinValue(1).setRequired(true),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'start') {
      const prize = interaction.options.getString('nagroda', true).trim();
      const czas = interaction.options.getString('czas', true);
      const winnersCount = interaction.options.getInteger('zwyciezcy') ?? 1;
      const requiredRole = interaction.options.getRole('wymagana_rola');

      const durationMs = parseDuration(czas);
      if (!durationMs) {
        return reply.error(interaction, 'Nie rozumiem podanego czasu. Uzyj formatu jak `30m`, `2h`, `1d`.');
      }
      if (durationMs < 60 * 1000) {
        return reply.error(interaction, 'Minimalny czas losowania to 1 minuta.');
      }

      const channel = interaction.channel;
      const permissions = channel.permissionsFor(interaction.guild.members.me);
      if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
        return reply.error(interaction, 'Nie mam uprawnien do pisania na tym kanale.');
      }

      const giveaway = giveawaysRepo.create({
        guildId: interaction.guild.id,
        channelId: channel.id,
        authorId: interaction.user.id,
        prize,
        winnersCount,
        requiredRoleId: requiredRole?.id ?? null,
        endsAt: Date.now() + durationMs,
      });

      const message = await channel.send({
        components: [giveawaysService.buildPanel(giveaway)],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      giveawaysRepo.setMessage(giveaway.id, message.id);

      return reply.success(
        interaction,
        `Losowanie #${giveaway.id} opublikowane: ${message.url}`,
      );
    }

    if (subcommand === 'reroll') {
      const id = interaction.options.getInteger('id', true);
      const giveaway = giveawaysRepo.get(id);

      if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
        return reply.error(interaction, `Nie znalazlem losowania **#${id}** na tym serwerze.`);
      }
      if (!giveaway.closed) {
        return reply.error(interaction, 'To losowanie jeszcze trwa — reroll dziala tylko po zakonczeniu.');
      }
      if (giveaway.author_id !== interaction.user.id && !isAdmin(interaction.member)) {
        return reply.error(interaction, 'Tylko autor losowania lub administrator moze losowac ponownie.');
      }

      await interaction.deferReply({ ephemeral: true });
      const channel = await interaction.client.channels.fetch(giveaway.channel_id).catch(() => null);
      await giveawaysService.rerollGiveaway(interaction.client, giveaway.id, { announceChannel: channel });

      return reply.success(interaction, `Wykonano ponowne losowanie dla #${giveaway.id}.`);
    }
  },
};
