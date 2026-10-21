'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const activity = require('../../database/repositories/activity');
const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const { COLORS, panel, reply } = require('../../ui/components');
const { formatNumber, humanDuration } = require('../../utils/format');

const MEDALS = ['🥇', '🥈', '🥉'];

const MODES = {
  punkty: {
    label: 'Najbogatsi',
    emoji: '💰',
    sort: 'balance',
    value: (entry, guildId) => economyService.formatCurrency(guildId, entry.balance, { short: true }),
  },
  zarobione: {
    label: 'Najwiecej zarobionych punktow',
    emoji: '📈',
    sort: 'earned',
    value: (entry, guildId) => economyService.formatCurrency(guildId, entry.total_earned, { short: true }),
  },
  glosowe: {
    label: 'Najaktywniejsi na kanalach glosowych',
    emoji: '🔊',
    sort: 'voice',
    value: (entry) => humanDuration(entry.voice_minutes * 60 * 1000),
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ranking czlonkow klanu')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('typ')
        .setDescription('Co porownujemy (domyslnie: punkty)')
        .addChoices(
          { name: '💰 Punkty klanowe', value: 'punkty' },
          { name: '📈 Lacznie zarobione', value: 'zarobione' },
          { name: '💬 Aktywnosc na czacie', value: 'wiadomosci' },
          { name: '🔊 Czas na kanalach glosowych', value: 'glosowe' },
        )
        .setRequired(false),
    ),

  cooldown: 5,

  async execute(interaction) {
    const { guild } = interaction;
    const mode = interaction.options.getString('typ') ?? 'punkty';
    const settings = guilds.get(guild.id);

    // Ranking aktywnosci dziala niezaleznie od ekonomii.
    if (mode === 'wiadomosci') {
      const top = activity.topMembers(guild.id, 10);
      const own = activity.getMember(guild.id, interaction.user.id);

      const lines = top.length
        ? top.map(
            (entry, index) =>
              `${MEDALS[index] ?? `\`${index + 1}.\``} <@${entry.user_id}> — **${formatNumber(entry.messages)}** wiadomosci`,
          )
        : ['*Brak zapisanej aktywnosci.*'];

      return reply.panel(
        interaction,
        panel({
          color: COLORS.info,
          title: '💬 Ranking aktywnosci na czacie',
          blocks: [lines.join('\n')],
          fields: own
            ? [{ name: 'Twoj wynik', value: `**${formatNumber(own.messages)}** wiadomosci` }]
            : [],
          footer: `Serwer: ${guild.name}`,
        }),
        { ephemeral: false },
      );
    }

    if (!settings.economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const config = MODES[mode] ?? MODES.punkty;
    const top = economy.leaderboard(guild.id, { sort: config.sort, limit: 10 });
    const own = economy.rankOf(guild.id, interaction.user.id, config.sort);

    const lines = top.length
      ? top.map(
          (entry, index) =>
            `${MEDALS[index] ?? `\`${index + 1}.\``} <@${entry.user_id}> — ${config.value(entry, guild.id)}`,
        )
      : ['*Nikt nie ma jeszcze punktow na koncie.*'];

    const container = panel({
      color: COLORS.clan,
      title: `${config.emoji} ${config.label}`,
      description: `Waluta: ${settings.currency_emoji} ${settings.currency_name}`,
      blocks: [lines.join('\n')],
      fields: [
        ...(own
          ? [
              {
                name: 'Twoja pozycja',
                value: `**${own.position}** z ${own.total} — ${config.value(own.account, guild.id)}`,
              },
            ]
          : []),
        {
          name: 'W obiegu',
          value: economyService.formatCurrency(guild.id, economy.totalCirculation(guild.id), { short: true }),
          inline: true,
        },
        { name: 'Kont', value: formatNumber(economy.countAccounts(guild.id)), inline: true },
      ],
      footer: 'Inne rankingi: /ranking typ:',
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
