'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

/**
 * Nagroda dobowa. Streak liczy sie, gdy odbierasz w ciagu 36h od poprzedniego —
 * mnoznik rosnie do 7 (tydzien), potem zatrzymuje sie.
 */
const BASE_REWARD = 1_000;
const STREAK_BONUS_PER_DAY = 200;
const MAX_STREAK_BONUS_DAYS = 7;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dziennie')
    .setDescription('Odbierz nagrode dobowa (raz na 24h)')
    .setContexts(InteractionContextType.Guild),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const status = games.checkCooldown(guild.id, user.id, 'daily');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Juz odebrales dzisiejsza nagrode. Wroc za **${games.formatCooldown(status.remaining)}**.`,
      );
    }

    const streak = games.bumpDailyStreak(guild.id, user.id, status.account.last_daily_at);
    const bonusDays = Math.min(streak - 1, MAX_STREAK_BONUS_DAYS);
    const bonus = bonusDays * STREAK_BONUS_PER_DAY;
    const payout = BASE_REWARD + bonus;

    games.awardEarn({
      guildId: guild.id,
      userId: user.id,
      amount: payout,
      kind: 'daily',
      reason: `Nagroda dobowa (streak ${streak})`,
    });
    games.stampCooldown(guild.id, user.id, 'daily');

    const balance = economyService.formatCurrency(
      guild.id,
      status.account.balance + payout,
      { short: true },
    );

    const container = panel({
      color: COLORS.success,
      title: '🎁 Nagroda dobowa',
      description:
        `Odebrales dzisiejszy pakiet. Streak: **${streak} ${streak === 1 ? 'dzien' : 'dni'}** ` +
        `${streak > 1 ? '🔥' : ''}`,
      fields: [
        { name: 'Baza', value: economyService.formatCurrency(guild.id, BASE_REWARD, { short: true }), inline: true },
        {
          name: 'Bonus za streak',
          value: bonus > 0
            ? `${economyService.formatCurrency(guild.id, bonus, { short: true })} (${bonusDays} dni)`
            : 'brak (od jutra)',
          inline: true,
        },
        { name: 'Razem', value: economyService.formatCurrency(guild.id, payout), inline: true },
        { name: 'Twoje saldo', value: balance, inline: true },
      ],
      footer:
        streak >= MAX_STREAK_BONUS_DAYS + 1
          ? 'Streak w maksymalnej wersji — utrzymuj tempo!'
          : 'Odbieraj codziennie, zeby powiekszyc bonus (max +1400 na dzien).',
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
