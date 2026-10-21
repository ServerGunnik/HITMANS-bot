'use strict';

const {
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, button, panel, reply, row, V2_FLAGS } = require('../../ui/components');
const { build: customId } = require('../../utils/customId');

const NAMESPACE = 'bj';
const MIN_BET = 20;
const MAX_BET = 30_000;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function drawCard() {
  return { rank: games.pickRandom(RANKS), suit: games.pickRandom(SUITS) };
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handValue(cards) {
  let sum = cards.reduce((acc, card) => acc + cardValue(card), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces -= 1;
  }
  return sum;
}

function renderHand(cards, { hideSecond = false } = {}) {
  return cards
    .map((card, index) => (hideSecond && index === 1 ? '`??`' : `\`${card.rank}${card.suit}\``))
    .join(' ');
}

function buildBoard({ guild, user, wager, playerCards, dealerCards, hideDealer, status, newBalance }) {
  const playerSum = handValue(playerCards);
  const dealerVisible = hideDealer ? cardValue(dealerCards[0]) : handValue(dealerCards);

  return panel({
    color:
      status === 'win' ? COLORS.success
      : status === 'loss' ? COLORS.danger
      : status === 'push' ? COLORS.warning
      : COLORS.info,
    title: '🃏 Blackjack',
    description:
      status === 'active'
        ? `Stawka: **${economyService.formatCurrency(guild.id, wager, { short: true })}**`
        : status === 'win'
          ? `**Wygrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}!**`
          : status === 'loss'
            ? `**Przegrywasz ${economyService.formatCurrency(guild.id, wager, { short: true })}.**`
            : `**Remis** — stawka wraca.`,
    fields: [
      {
        name: `${user.username} (${playerSum})`,
        value: renderHand(playerCards),
      },
      {
        name: `Krupier ${hideDealer ? `(${dealerVisible}+?)` : `(${dealerVisible})`}`,
        value: renderHand(dealerCards, { hideSecond: hideDealer }),
      },
      ...(newBalance !== undefined
        ? [{ name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, newBalance, { short: true }), inline: true }]
        : []),
    ],
    rows:
      status === 'active'
        ? [
            row(
              button({ id: customId(NAMESPACE, 'hit', user.id), label: 'Dobierz', emoji: '➕', style: 'primary' }),
              button({ id: customId(NAMESPACE, 'stand', user.id), label: 'Pass', emoji: '✋', style: 'success' }),
            ),
          ]
        : [],
    footer: status === 'active' ? 'Kliknij Dobierz zeby wziac karte, Pass zeby zakonczyc.' : undefined,
  });
}

function playDealer(dealerCards) {
  while (handValue(dealerCards) < 17) {
    dealerCards.push(drawCard());
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Zagraj w 21 przeciw krupierowi')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('stawka').setDescription('Ile stawiasz').setMinValue(MIN_BET).setMaxValue(MAX_BET).setRequired(true),
    ),

  cooldown: 5,

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

    const playerCards = [drawCard(), drawCard()];
    const dealerCards = [drawCard(), drawCard()];

    // Natychmiastowy blackjack gracza.
    const playerBJ = handValue(playerCards) === 21;
    const dealerBJ = handValue(dealerCards) === 21;

    if (playerBJ || dealerBJ) {
      let status;
      let netProfit = 0;
      if (playerBJ && dealerBJ) status = 'push';
      else if (playerBJ) {
        status = 'win';
        netProfit = Math.floor(wager * 1.5); // blackjack 3:2
      } else status = 'loss';

      if (status !== 'push') {
        games.resolveWager({
          guildId: guild.id,
          userId: user.id,
          wager,
          won: status === 'win',
          netProfit,
          kind: 'blackjack',
          reason: playerBJ ? 'natychmiastowy blackjack' : 'blackjack krupiera',
        });
      }

      const newBalance = economy.getBalance(guild.id, user.id);
      return reply.panel(
        interaction,
        buildBoard({ guild, user, wager, playerCards, dealerCards, hideDealer: false, status, newBalance }),
        { ephemeral: false },
      );
    }

    await interaction.reply({
      components: [
        buildBoard({ guild, user, wager, playerCards, dealerCards, hideDealer: true, status: 'active' }),
      ],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 3 * 60 * 1000,
      filter: (i) => {
        if (i.user.id !== user.id) {
          i.reply({ content: 'To nie jest twoja gra.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return false;
        }
        return true;
      },
    });

    collector.on('collect', async (i) => {
      const parts = i.customId.split(':');
      const action = parts[1];

      if (action === 'hit') {
        playerCards.push(drawCard());
        const sum = handValue(playerCards);

        if (sum > 21) {
          collector.stop('bust');
          return;
        }

        await i.update({
          components: [
            buildBoard({ guild, user, wager, playerCards, dealerCards, hideDealer: true, status: 'active' }),
          ],
          flags: V2_FLAGS,
          allowedMentions: { parse: [] },
        });
      } else if (action === 'stand') {
        collector.stop('stand');
        // Update natychmiastowy zeby uniknac timeoutu — finalizacja w on end.
        await i.deferUpdate().catch(() => {});
      }
    });

    collector.on('end', async (_collected, reason) => {
      let status;
      let netProfit = 0;

      if (reason === 'bust') {
        status = 'loss';
      } else if (reason === 'stand') {
        playDealer(dealerCards);
        const playerSum = handValue(playerCards);
        const dealerSum = handValue(dealerCards);

        if (dealerSum > 21 || playerSum > dealerSum) {
          status = 'win';
          netProfit = wager;
        } else if (playerSum < dealerSum) {
          status = 'loss';
        } else {
          status = 'push';
        }
      } else {
        // timeout
        status = 'loss';
      }

      if (status !== 'push') {
        games.resolveWager({
          guildId: guild.id,
          userId: user.id,
          wager,
          won: status === 'win',
          netProfit,
          kind: 'blackjack',
          reason:
            reason === 'bust'
              ? 'bust'
              : reason === 'stand'
                ? `${handValue(playerCards)} vs ${handValue(dealerCards)}`
                : 'timeout',
        });
      }

      const newBalance = economy.getBalance(guild.id, user.id);
      await message
        .edit({
          components: [
            buildBoard({ guild, user, wager, playerCards, dealerCards, hideDealer: false, status, newBalance }),
          ],
          flags: V2_FLAGS,
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    });
  },
};
