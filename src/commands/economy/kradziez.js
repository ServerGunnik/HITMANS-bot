'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');
const { humanDuration } = require('../../utils/format');

/**
 * Drobna kradziez z portfela. Szansa 50%. Skala:
 *  - kradniesz max 20% salda ofiary (i nie mniej niz 50)
 *  - grzywna za wpadke = 30% twojego salda
 *  - po udanej kradziezy ofiara ma 15 min ochrony
 */
const SUCCESS_CHANCE = 0.5;
const STEAL_PERCENT_MAX = 0.2;
const STEAL_MIN = 50;
const FINE_PERCENT = 0.3;
const VICTIM_SHIELD_MS = 15 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kradziez')
    .setDescription('Sprobuj ukrasc punkty innej osobie (cooldown 30 min, ryzyko grzywny)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option.setName('ofiara').setDescription('Kogo okradasz').setRequired(true)),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const target = interaction.options.getUser('ofiara', true);
    if (target.id === user.id) return reply.error(interaction, 'Sam siebie nie okradniesz.');
    if (target.bot) return reply.error(interaction, 'Boty nie noscza punktow w portfelu.');

    const status = games.checkCooldown(guild.id, user.id, 'rob');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Za goraco. Odczekaj **${games.formatCooldown(status.remaining)}** przed nastepna proba.`,
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
        `**${target.username}** ma zbyt puste konto — nie ma czego kras.`,
      );
    }

    games.stampCooldown(guild.id, user.id, 'rob');

    if (Math.random() >= SUCCESS_CHANCE) {
      const fine = Math.max(50, Math.floor(status.account.balance * FINE_PERCENT));
      const applied = Math.min(fine, status.account.balance);

      if (applied > 0) {
        games.stealFine({
          guildId: guild.id,
          robberId: user.id,
          amount: applied,
          reason: `Zlapany przy probie kradziezy od ${target.tag}`,
        });
      }

      const newBalance = economy.getBalance(guild.id, user.id);
      return reply.panel(
        interaction,
        panel({
          color: COLORS.danger,
          title: '🚨 Wpadles!',
          description: `Ochrona zlapala Cie przy probie okradania **${target.username}**.`,
          fields: [
            { name: 'Grzywna', value: economyService.formatCurrency(guild.id, applied, { short: true }), inline: true },
            { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
          ],
          footer: 'Cooldown 30 min.',
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
      reason: `Kradziez od ${target.tag}`,
    });
    games.setRobShield(guild.id, target.id, VICTIM_SHIELD_MS);

    const newBalance = economy.getBalance(guild.id, user.id);
    return reply.panel(
      interaction,
      panel({
        color: COLORS.success,
        title: '🥷 Udany skok',
        description: `Ukrales **${economyService.formatCurrency(guild.id, amount, { short: true })}** od <@${target.id}>.`,
        fields: [
          { name: 'Twoje nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true },
          { name: 'Ofiara chroniona przez', value: '15 minut', inline: true },
        ],
        footer: 'Cooldown 30 min.',
      }),
      { ephemeral: false, allowedMentions: { users: [target.id] } },
    );
  },
};
