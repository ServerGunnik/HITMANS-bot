'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const serverLogs = require('../../services/serverLogs');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('przelej')
    .setDescription('Przelewa punkty klanowe innemu czlonkowi')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Odbiorca przelewu').setRequired(true))
    .addIntegerOption((option) =>
      option.setName('kwota').setDescription('Kwota przelewu').setMinValue(1).setMaxValue(1_000_000).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('powod').setDescription('Tytul przelewu (widoczny w historii)').setMaxLength(200).setRequired(false),
    ),

  cooldown: 5,

  async execute(interaction) {
    const { guild } = interaction;
    const settings = guilds.get(guild.id);

    if (!settings.economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const target = interaction.options.getUser('uzytkownik', true);
    const amount = interaction.options.getInteger('kwota', true);
    const reason = interaction.options.getString('powod');

    if (target.id === interaction.user.id) {
      return reply.error(interaction, 'Nie mozesz przelac punktow samemu sobie.');
    }
    if (target.bot) {
      return reply.error(interaction, 'Boty nie maja kont w ekonomii klanowej.');
    }

    const minimum = settings.economy_transfer_min ?? 1;
    if (amount < minimum) {
      return reply.error(
        interaction,
        `Minimalna kwota przelewu to ${economyService.formatCurrency(guild.id, minimum, { short: true })}.`,
      );
    }

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) return reply.error(interaction, 'Ten uzytkownik nie jest czlonkiem serwera.');

    const result = economy.transfer({
      guildId: guild.id,
      fromUserId: interaction.user.id,
      toUserId: target.id,
      amount,
      reason: reason ? truncate(reason, 200) : null,
    });

    if (!result.ok) {
      return reply.error(
        interaction,
        `Nie masz wystarczajacych srodkow. Twoje saldo: ${economyService.formatCurrency(guild.id, result.balance, { short: true })}.`,
      );
    }

    await serverLogs.logEconomy(guild, {
      title: 'Przelew miedzy czlonkami',
      fields: [
        { name: 'Nadawca', value: serverLogs.describeUser(interaction.user) },
        { name: 'Odbiorca', value: serverLogs.describeUser(target) },
        { name: 'Kwota', value: economyService.formatCurrency(guild.id, amount, { short: true }), inline: true },
        {
          name: 'Saldo nadawcy',
          value: economyService.formatCurrency(guild.id, result.balance, { short: true }),
          inline: true,
        },
        ...(reason ? [{ name: 'Tytul', value: truncate(reason, 300) }] : []),
      ],
      footer: `Transakcja #${result.transaction.id} • cofniecie: /ekonomia cofnij id:${result.transaction.id}`,
    });

    const container = panel({
      color: COLORS.success,
      title: '💸 Przelew wykonany',
      description: `${interaction.user} → ${target}`,
      fields: [
        { name: 'Kwota', value: economyService.formatCurrency(guild.id, amount), inline: true },
        {
          name: 'Twoje saldo',
          value: economyService.formatCurrency(guild.id, result.balance, { short: true }),
          inline: true,
        },
        ...(reason ? [{ name: 'Tytul', value: truncate(reason, 300) }] : []),
      ],
      footer: `Transakcja #${result.transaction.id} • zapisana w historii (/ekonomia historia)`,
    });

    return reply.panel(interaction, container, {
      ephemeral: false,
      allowedMentions: { users: [target.id] },
    });
  },
};
