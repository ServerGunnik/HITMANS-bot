'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

const MIN_BET = 10;
const MAX_BET = 50_000;

const DICE_EMOJI = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };

/** 2 kosci na gracza vs 2 kosci bota. Wyzsza suma wygrywa; remis = zwrot stawki. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('kosci')
    .setDescription('Rzut dwiema koscmi przeciw botowi')
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

    const player = [games.randomInt(1, 6), games.randomInt(1, 6)];
    const dealer = [games.randomInt(1, 6), games.randomInt(1, 6)];
    const playerSum = player[0] + player[1];
    const dealerSum = dealer[0] + dealer[1];

    let outcome;
    if (playerSum > dealerSum) outcome = 'win';
    else if (playerSum < dealerSum) outcome = 'loss';
    else outcome = 'tie';

    if (outcome !== 'tie') {
      games.resolveWager({
        guildId: guild.id,
        userId: user.id,
        wager,
        won: outcome === 'win',
        kind: 'kosci',
        reason: `${playerSum} vs ${dealerSum}`,
      });
    }

    const newBalance = economy.getBalance(guild.id, user.id);
    const color = outcome === 'win' ? COLORS.success : outcome === 'loss' ? COLORS.danger : COLORS.warning;
    const title =
      outcome === 'win'
        ? `🎲 Wygrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}!`
        : outcome === 'loss'
          ? `🎲 Przegrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}.`
          : '🎲 Remis — stawka wraca.';

    const container = panel({
      color,
      title,
      fields: [
        {
          name: `Ty (${playerSum})`,
          value: `${DICE_EMOJI[player[0]]} ${DICE_EMOJI[player[1]]}`,
          inline: true,
        },
        {
          name: `Bot (${dealerSum})`,
          value: `${DICE_EMOJI[dealer[0]]} ${DICE_EMOJI[dealer[1]]}`,
          inline: true,
        },
        { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
      ],
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
