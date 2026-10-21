'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

const MIN_BET = 10;
const MAX_BET = 50_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('monetka')
    .setDescription('Rzut moneta — 50/50, wygrywasz 2x stawke')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('stawka').setDescription('Ile stawiasz').setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('strona')
        .setDescription('Na co stawiasz')
        .setRequired(true)
        .addChoices({ name: 'Orzel', value: 'orzel' }, { name: 'Reszka', value: 'reszka' }),
    ),

  cooldown: 3,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const wager = interaction.options.getInteger('stawka', true);
    const pick = interaction.options.getString('strona', true);
    const balance = economy.getBalance(guild.id, user.id);

    if (wager > balance) {
      return reply.error(
        interaction,
        `Za malo srodkow — masz ${economyService.formatCurrency(guild.id, balance, { short: true })}.`,
      );
    }

    const result = Math.random() < 0.5 ? 'orzel' : 'reszka';
    const won = pick === result;

    games.resolveWager({
      guildId: guild.id,
      userId: user.id,
      wager,
      won,
      kind: 'monetka',
      reason: `stawka ${pick}, wypadlo ${result}`,
    });

    const newBalance = economy.getBalance(guild.id, user.id);
    const emoji = result === 'orzel' ? '🦅' : '🪙';

    const container = panel({
      color: won ? COLORS.success : COLORS.danger,
      title: `${emoji} Wypadlo: ${result === 'orzel' ? 'ORZEL' : 'RESZKA'}`,
      description: won
        ? `**Wygrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}!**`
        : `**Przegrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}.**`,
      fields: [
        { name: 'Twoj typ', value: pick === 'orzel' ? '🦅 Orzel' : '🪙 Reszka', inline: true },
        { name: 'Wynik', value: result === 'orzel' ? '🦅 Orzel' : '🪙 Reszka', inline: true },
        { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
      ],
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
