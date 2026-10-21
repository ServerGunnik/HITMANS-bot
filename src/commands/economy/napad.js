'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');
const { humanDuration } = require('../../utils/format');

/**
 * Duzy napad na innego gracza:
 *  - szansa 35% (mniejsza niz /kradziez, bo stawka wyzsza),
 *  - lup do 45% salda ofiary (min 500),
 *  - grzywna za wpadke = 50% salda napastnika,
 *  - ochrona ofiary 60 min,
 *  - cooldown 4h.
 */
const SUCCESS_CHANCE = 0.35;
const STEAL_PERCENT_MAX = 0.45;
const STEAL_MIN = 500;
const FINE_PERCENT = 0.5;
const VICTIM_SHIELD_MS = 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('napad')
    .setDescription('Wielki napad na inna osobe (cooldown 4h, duze ryzyko)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName('ofiara').setDescription('Kogo napadasz').setRequired(true)),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const target = interaction.options.getUser('ofiara', true);
    if (target.id === user.id) return reply.error(interaction, 'Nie napadniesz sam siebie.');
    if (target.bot) return reply.error(interaction, 'Boty nie noscza punktow w portfelu.');

    const status = games.checkCooldown(guild.id, user.id, 'heist');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Musisz sie schowac. Nastepny napad za **${games.formatCooldown(status.remaining)}**.`,
      );
    }

    const victim = economy.getAccount(guild.id, target.id);
    if (victim.rob_shield_until && victim.rob_shield_until > Date.now()) {
      return reply.warning(
        interaction,
        `**${target.username}** jest pod ochrona jeszcze przez ${humanDuration(victim.rob_shield_until - Date.now())}.`,
      );
    }

    if (victim.balance < STEAL_MIN * 2) {
      return reply.warning(
        interaction,
        `**${target.username}** ma za male konto na napad. Wybierz kogos majetnego.`,
      );
    }

    if (status.account.balance < STEAL_MIN) {
      return reply.warning(
        interaction,
        `Potrzebujesz co najmniej ${economyService.formatCurrency(guild.id, STEAL_MIN, { short: true })} na kaucje.`,
      );
    }

    games.stampCooldown(guild.id, user.id, 'heist');

    if (Math.random() >= SUCCESS_CHANCE) {
      const fine = Math.max(500, Math.floor(status.account.balance * FINE_PERCENT));
      const applied = Math.min(fine, status.account.balance);

      if (applied > 0) {
        games.stealFine({
          guildId: guild.id,
          robberId: user.id,
          amount: applied,
          reason: `Nieudany napad na ${target.tag}`,
        });
      }

      const newBalance = economy.getBalance(guild.id, user.id);
      return reply.panel(
        interaction,
        panel({
          color: COLORS.danger,
          title: '🚔 Nieudany napad',
          description: `Policja przyjechala szybciej niz sie spodziewales. Napad na **${target.username}** spalony.`,
          fields: [
            { name: 'Kaucja', value: economyService.formatCurrency(guild.id, applied, { short: true }), inline: true },
            { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
          ],
          footer: 'Cooldown 4h.',
        }),
        { ephemeral: false, allowedMentions: { users: [target.id] } },
      );
    }

    const stealMax = Math.floor(victim.balance * STEAL_PERCENT_MAX);
    const amount = games.randomInt(STEAL_MIN, Math.max(STEAL_MIN, stealMax));

    games.stealFrom({
      guildId: guild.id,
      robberId: user.id,
      victimId: target.id,
      amount,
      reason: `Napad na ${target.tag}`,
    });
    games.setRobShield(guild.id, target.id, VICTIM_SHIELD_MS);

    const newBalance = economy.getBalance(guild.id, user.id);
    return reply.panel(
      interaction,
      panel({
        color: COLORS.success,
        title: '💰 Udany napad!',
        description: `Zgarnales **${economyService.formatCurrency(guild.id, amount, { short: true })}** od <@${target.id}>.`,
        fields: [
          { name: 'Twoje nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
          { name: 'Ofiara chroniona przez', value: '60 minut', inline: true },
        ],
        footer: 'Cooldown 4h.',
      }),
      { ephemeral: false, allowedMentions: { users: [target.id] } },
    );
  },
};
