'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

const MIN_BET = 10;
const MAX_BET = 50_000;

/** Klasyczna europejska ruletka: 0-36, z 0 zielonym (kasyno wygrywa 0). */
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function colorOf(number) {
  if (number === 0) return 'zielone';
  return RED_NUMBERS.has(number) ? 'czerwone' : 'czarne';
}

function colorEmoji(color) {
  return color === 'czerwone' ? '🔴' : color === 'czarne' ? '⚫' : '🟢';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ruletka')
    .setDescription('Zagraj w ruletke — kolor (2x) lub liczba (36x)')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('stawka').setDescription('Ile stawiasz').setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('typ')
        .setDescription('Na co stawiasz')
        .setRequired(true)
        .addChoices(
          { name: 'Czerwone (2x)', value: 'czerwone' },
          { name: 'Czarne (2x)', value: 'czarne' },
          { name: 'Parzyste (2x)', value: 'parzyste' },
          { name: 'Nieparzyste (2x)', value: 'nieparzyste' },
          { name: 'Nisko 1-18 (2x)', value: 'nisko' },
          { name: 'Wysoko 19-36 (2x)', value: 'wysoko' },
          { name: 'Konkretna liczba (36x)', value: 'liczba' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('liczba')
        .setDescription('Wymagane gdy typ=Konkretna liczba (0-36)')
        .setMinValue(0)
        .setMaxValue(36)
        .setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const wager = interaction.options.getInteger('stawka', true);
    const type = interaction.options.getString('typ', true);
    const pickedNumber = interaction.options.getInteger('liczba');

    if (type === 'liczba' && (pickedNumber === null || pickedNumber === undefined)) {
      return reply.error(interaction, 'Wybierajac typ **Konkretna liczba** podaj tez opcje `liczba` (0-36).');
    }

    const balance = economy.getBalance(guild.id, user.id);
    if (wager > balance) {
      return reply.error(
        interaction,
        `Za malo srodkow — masz ${economyService.formatCurrency(guild.id, balance, { short: true })}.`,
      );
    }

    const rolled = games.randomInt(0, 36);
    const rolledColor = colorOf(rolled);

    let won = false;
    let multiplier = 0;

    if (type === 'liczba') {
      won = rolled === pickedNumber;
      multiplier = 35; // net profit (nie 36 — zwrot stawki + 35x nagroda)
    } else if (rolled === 0) {
      won = false;
    } else if (type === 'czerwone' || type === 'czarne') {
      won = type === rolledColor;
      multiplier = 1;
    } else if (type === 'parzyste') {
      won = rolled % 2 === 0;
      multiplier = 1;
    } else if (type === 'nieparzyste') {
      won = rolled % 2 === 1;
      multiplier = 1;
    } else if (type === 'nisko') {
      won = rolled >= 1 && rolled <= 18;
      multiplier = 1;
    } else if (type === 'wysoko') {
      won = rolled >= 19 && rolled <= 36;
      multiplier = 1;
    }

    const netProfit = won ? wager * multiplier : 0;

    games.resolveWager({
      guildId: guild.id,
      userId: user.id,
      wager,
      won,
      netProfit,
      kind: 'ruletka',
      reason: `stawka ${type}${type === 'liczba' ? `:${pickedNumber}` : ''}, wypadlo ${rolled}`,
    });

    const newBalance = economy.getBalance(guild.id, user.id);
    const yourBet = type === 'liczba' ? `${pickedNumber}` : type;

    const container = panel({
      color: won ? COLORS.success : COLORS.danger,
      title: `🎯 Ruletka — wypadlo ${colorEmoji(rolledColor)} **${rolled}**`,
      description: won
        ? `**Wygrywasz ${economyService.formatCurrency(guild.id, netProfit, { short: true })}!**`
        : `**Przegrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}.**`,
      fields: [
        { name: 'Twoj typ', value: yourBet, inline: true },
        { name: 'Wypadlo', value: `${colorEmoji(rolledColor)} ${rolled} (${rolledColor})`, inline: true },
        { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
      ],
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
