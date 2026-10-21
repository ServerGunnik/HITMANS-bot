'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const serverLogs = require('../../services/serverLogs');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

/**
 * Ustawia saldo uzytkownika na dokladna kwote.
 * Roznica wobec obecnego salda idzie do ksiegi jako admin_add / admin_remove,
 * dzieki czemu wpis jest cofalny przez /ekonomia cofnij.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ustaw-saldo')
    .setDescription('Ustawia saldo uzytkownika na dokladna kwote')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName('uzytkownik').setDescription('Komu ustawiasz saldo').setRequired(true))
    .addIntegerOption((option) =>
      option.setName('kwota').setDescription('Docelowe saldo').setMinValue(0).setMaxValue(1_000_000_000).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod (widoczny w historii)').setMaxLength(200).setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    const { guild } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze (`/ekonomia ustaw wlaczona:true`).');
    }

    const target = interaction.options.getUser('uzytkownik', true);
    const targetBalance = interaction.options.getInteger('kwota', true);
    const reason = interaction.options.getString('powod');

    if (target.bot) return reply.error(interaction, 'Boty nie maja kont w ekonomii klanowej.');

    const currentBalance = economy.getBalance(guild.id, target.id);
    const delta = targetBalance - currentBalance;

    if (delta === 0) {
      return reply.info(
        interaction,
        `**${target.username}** juz ma dokladnie ${economyService.formatCurrency(guild.id, targetBalance, { short: true })}.`,
      );
    }

    const payload = {
      guildId: guild.id,
      userId: target.id,
      amount: Math.abs(delta),
      actorId: interaction.user.id,
      reason: reason ? truncate(reason, 200) : `Ustawienie salda na ${targetBalance}`,
    };

    const result = delta > 0 ? economy.grant(payload) : economy.take(payload);

    if (!result.ok) {
      return reply.error(interaction, `Nie udalo sie zaktualizowac salda **${target.tag}**.`);
    }

    await serverLogs.logEconomy(guild, {
      title: 'Ustawienie salda',
      fields: [
        { name: 'Czlonek', value: serverLogs.describeUser(target) },
        { name: 'Administrator', value: serverLogs.describeUser(interaction.user) },
        {
          name: 'Poprzednie saldo',
          value: economyService.formatCurrency(guild.id, currentBalance, { short: true }),
          inline: true,
        },
        {
          name: 'Nowe saldo',
          value: economyService.formatCurrency(guild.id, result.balance, { short: true }),
          inline: true,
        },
        {
          name: 'Zmiana',
          value: (delta > 0 ? '+' : '') + economyService.formatCurrency(guild.id, delta, { short: true }),
          inline: true,
        },
        ...(reason ? [{ name: 'Powod', value: truncate(reason, 300) }] : []),
      ],
      footer: `Transakcja #${result.transaction.id} • cofniecie: /ekonomia cofnij id:${result.transaction.id}`,
    });

    const container = panel({
      color: COLORS.success,
      title: '⚖️ Saldo ustawione',
      description: `${target} • wykonal(a): ${interaction.user}`,
      fields: [
        {
          name: 'Poprzednie saldo',
          value: economyService.formatCurrency(guild.id, currentBalance, { short: true }),
          inline: true,
        },
        {
          name: 'Nowe saldo',
          value: economyService.formatCurrency(guild.id, result.balance),
          inline: true,
        },
        {
          name: 'Zmiana',
          value: (delta > 0 ? '+' : '') + economyService.formatCurrency(guild.id, delta, { short: true }),
          inline: true,
        },
        ...(reason ? [{ name: 'Powod', value: truncate(reason, 300) }] : []),
      ],
      footer: `Transakcja #${result.transaction.id} • cofniecie: /ekonomia cofnij id:${result.transaction.id}`,
    });

    return reply.panel(interaction, container, { ephemeral: false, allowedMentions: { users: [target.id] } });
  },
};
