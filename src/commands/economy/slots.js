'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

const MIN_BET = 10;
const MAX_BET = 20_000;

/**
 * Klasyczne 3-bebnowe automaty. Symbole wazone — najlepsze (💎) rzadko wypadaja.
 * Multiplier = ile stawki dodatkowo dostajesz (netto zysk, nie zwrot ze stawka).
 */
const SYMBOLS = [
  ['🍒', 40], // najczestszy
  ['🍋', 30],
  ['🍊', 20],
  ['🔔', 10],
  ['⭐', 6],
  ['7️⃣', 3],
  ['💎', 1], // najrzadszy
];

const TRIPLE_MULTIPLIERS = {
  '🍒': 3,
  '🍋': 5,
  '🍊': 8,
  '🔔': 12,
  '⭐': 20,
  '7️⃣': 50,
  '💎': 100,
};

function spin() {
  return games.pickWeighted(SYMBOLS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Zakrec bebenami — 3 rzedy, wysoka wygrana za tripla')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('stawka').setDescription('Ile stawiasz').setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true),
    ),

  cooldown: 3,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const wager = interaction.options.getInteger('stawka', true);
    const balance = economy.getBalance(guild.id, user.id);

    if (wager > balance) {
      return reply.error(
        interaction,
        `Za malo srodkow — masz ${economyService.formatCurrency(guild.id, balance, { short: true })}.`,
      );
    }

    const reels = [spin(), spin(), spin()];
    const [a, b, c] = reels;

    let netProfit = 0;
    let outcome = 'loss';

    if (a === b && b === c) {
      netProfit = wager * TRIPLE_MULTIPLIERS[a];
      outcome = 'triple';
    } else if (a === b || b === c || a === c) {
      // dwa te same = zwrot stawki (breakeven)
      netProfit = 0;
      outcome = 'pair';
    }

    if (outcome === 'triple') {
      games.resolveWager({
        guildId: guild.id,
        userId: user.id,
        wager,
        won: true,
        netProfit,
        kind: 'slots',
        reason: `triple ${a}`,
      });
    } else if (outcome === 'loss') {
      games.resolveWager({
        guildId: guild.id,
        userId: user.id,
        wager,
        won: false,
        kind: 'slots',
        reason: `${a}${b}${c}`,
      });
    }
    // pair = brak transakcji, stawka nie zostaje ruszona (breakeven)

    const newBalance = economy.getBalance(guild.id, user.id);
    let color;
    let title;
    if (outcome === 'triple') {
      color = COLORS.success;
      title = `🎰 TRIPLE ${a}${a}${a} — wygrywasz ${economyService.formatCurrency(guild.id, netProfit, { short: true })}!`;
    } else if (outcome === 'pair') {
      color = COLORS.warning;
      title = '🎰 Dwa te same — stawka wraca.';
    } else {
      color = COLORS.danger;
      title = `🎰 Bez trafien — przegrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}.`;
    }

    const container = panel({
      color,
      title,
      description: `## [ ${a} | ${b} | ${c} ]`,
      fields: [
        { name: 'Stawka', value: economyService.formatCurrency(guild.id, wager, { short: true }), inline: true },
        { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
      ],
      footer: 'Multipliery: 🍒×3 🍋×5 🍊×8 🔔×12 ⭐×20 7️⃣×50 💎×100',
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
