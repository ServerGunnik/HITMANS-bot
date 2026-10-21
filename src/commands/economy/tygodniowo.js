'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

const REWARD = 8_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tygodniowo')
    .setDescription('Odbierz nagrode tygodniowa (raz na 7 dni)')
    .setContexts(InteractionContextType.Guild),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const status = games.checkCooldown(guild.id, user.id, 'weekly');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Tygodniowka juz odebrana. Wroc za **${games.formatCooldown(status.remaining)}**.`,
      );
    }

    games.awardEarn({
      guildId: guild.id,
      userId: user.id,
      amount: REWARD,
      kind: 'weekly',
      reason: 'Nagroda tygodniowa',
    });
    games.stampCooldown(guild.id, user.id, 'weekly');

    const balance = economyService.formatCurrency(
      guild.id,
      status.account.balance + REWARD,
      { short: true },
    );

    const container = panel({
      color: COLORS.success,
      title: '📦 Nagroda tygodniowa',
      description: 'Zgarnales pakiet tygodniowy. Wroc za tydzien po kolejny.',
      fields: [
        { name: 'Wygrana', value: economyService.formatCurrency(guild.id, REWARD), inline: true },
        { name: 'Twoje saldo', value: balance, inline: true },
      ],
      footer: 'Kolejna paczka za 7 dni.',
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
