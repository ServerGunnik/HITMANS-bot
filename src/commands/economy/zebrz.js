'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

/**
 * Zebranie o punkty. 60% na drobna wygrana, 40% na komiczne odrzucenie.
 * Cooldown 5 min chroni przed spamem.
 */
const SUCCESS_CHANCE = 0.6;

const SUCCESS_FLAVORS = [
  ({ amount }) => `Przechodzien wpakowal Ci **${amount}** do puszki.`,
  ({ amount }) => `Ochroniarz z sektora rzucil Ci **${amount}** za historie.`,
  ({ amount }) => `Kibol z drugiej druzyny mial dobry dzien — **${amount}** do puszki.`,
  ({ amount }) => `Sprzataczka klubowa rzucila drobne — **${amount}**.`,
];

const FAIL_FLAVORS = [
  'Nikt nie zwrocil na Ciebie uwagi. Puszka pusta.',
  'Podeszla ochrona, musiales spadac. Bez zarobku.',
  'Ludzie na trybunach mieli lepsze zainteresowania.',
  'Ktos wykrzyczal cos brzydkiego, ale pustych rak nie dodal.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zebrz')
    .setDescription('Poprosc kibicow o punkty (cooldown 5 min)')
    .setContexts(InteractionContextType.Guild),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const status = games.checkCooldown(guild.id, user.id, 'beg');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Zbyt czesto — nastepna proba za **${games.formatCooldown(status.remaining)}**.`,
      );
    }

    games.stampCooldown(guild.id, user.id, 'beg');

    if (Math.random() >= SUCCESS_CHANCE) {
      return reply.panel(
        interaction,
        panel({
          color: COLORS.warning,
          title: '🫳 Puszka pusta',
          description: games.pickRandom(FAIL_FLAVORS),
          footer: 'Sprobuj znowu za 5 minut.',
        }),
        { ephemeral: false },
      );
    }

    const amount = games.randomInt(10, 80);
    games.awardEarn({
      guildId: guild.id,
      userId: user.id,
      amount,
      kind: 'beg',
      reason: 'Zebranie na trybunach',
    });

    const balance = economyService.formatCurrency(
      guild.id,
      status.account.balance + amount,
      { short: true },
    );

    return reply.panel(
      interaction,
      panel({
        color: COLORS.success,
        title: '🪙 Puszka zabrzeczala',
        description: games.pickRandom(SUCCESS_FLAVORS)({ amount }),
        fields: [
          { name: 'Zebrales', value: economyService.formatCurrency(guild.id, amount), inline: true },
          { name: 'Twoje saldo', value: balance, inline: true },
        ],
        footer: 'Sprobuj znowu za 5 minut.',
      }),
      { ephemeral: false },
    );
  },
};
