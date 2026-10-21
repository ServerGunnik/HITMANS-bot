'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const shopRepo = require('../../database/repositories/shop');
const economyService = require('../../services/economy');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply } = require('../../ui/components');
const { formatNumber, humanDuration, timestamp } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('saldo')
    .setDescription('Sprawdza stan konta w walucie klanowej')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName('uzytkownik')
        .setDescription('Czyje saldo sprawdzic (tylko administracja)')
        .setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    const settings = guilds.get(interaction.guild.id);
    if (!settings.economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze (`/ekonomia ustaw wlaczona:true`).');
    }

    const requested = interaction.options.getUser('uzytkownik');

    if (requested && requested.id !== interaction.user.id && !isAdmin(interaction.member)) {
      return reply.error(interaction, 'Saldo innych czlonkow moze sprawdzac tylko administracja.');
    }

    const target = requested ?? interaction.user;
    if (target.bot) return reply.error(interaction, 'Boty nie maja kont w ekonomii klanowej.');

    const account = economy.getAccount(interaction.guild.id, target.id);
    const rank = economy.rankOf(interaction.guild.id, target.id);
    const tempRoles = shopRepo.activeTempRoles(interaction.guild.id, target.id);

    const container = panel({
      color: COLORS.clan,
      title: `💰 Saldo — ${target.username}`,
      description: economyService.formatCurrency(interaction.guild.id, account.balance),
      thumbnail: { url: target.displayAvatarURL({ size: 256 }) },
      fields: [
        {
          name: 'Pozycja w rankingu',
          value: rank ? `**${rank.position}** z ${rank.total}` : 'brak',
          inline: true,
        },
        { name: 'Lacznie zarobione', value: formatNumber(account.total_earned), inline: true },
        { name: 'Lacznie wydane', value: formatNumber(account.total_spent), inline: true },
        {
          name: 'Czas na kanalach glosowych',
          value: account.voice_minutes > 0 ? humanDuration(account.voice_minutes * 60 * 1000) : 'brak',
          inline: true,
        },
        {
          name: 'Ostatni zarobek',
          value: account.last_earn_at ? timestamp(account.last_earn_at, 'R') : 'brak',
          inline: true,
        },
        ...(tempRoles.length
          ? [
              {
                name: 'Aktywne zakupy czasowe',
                value: tempRoles
                  .map((entry) => `• **${entry.item_name}** — wygasa ${timestamp(entry.expires_at, 'R')}`)
                  .join('\n'),
              },
            ]
          : []),
      ],
      footer: 'Przelew: /przelej • Sklep: /sklep • Ranking: /ranking',
    });

    return reply.panel(interaction, container, { ephemeral: target.id !== interaction.user.id });
  },
};
