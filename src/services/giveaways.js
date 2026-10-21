'use strict';

const giveawaysRepo = require('../database/repositories/giveaways');
const { COLORS, EMOJI, button, panel, row, V2_FLAGS } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { plural, timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'giveaway';

function buildPanel(giveaway) {
  const entries = giveawaysRepo.entriesCount(giveaway.id);
  const meta = [];
  meta.push(`nagrody: **${giveaway.winners_count}**`);
  meta.push(giveaway.closed ? `zakonczone ${timestamp(giveaway.ends_at, 'R')}` : `konczy sie ${timestamp(giveaway.ends_at, 'R')}`);
  if (giveaway.required_role_id) meta.push(`wymagana rola: <@&${giveaway.required_role_id}>`);

  const blocks = [];
  if (giveaway.closed) {
    const winners = giveaway.winner_ids ?? [];
    blocks.push(
      winners.length > 0
        ? `🏆 **Zwyciezcy:** ${winners.map((id) => `<@${id}>`).join(', ')}`
        : '😔 Nikt sie nie zgłosił — brak zwyciezcow.',
    );
  }

  return panel({
    color: giveaway.closed ? COLORS.neutral : COLORS.clan,
    title: `🎉 Losowanie: ${truncate(giveaway.prize, 200)}`,
    description: `-# Organizuje <@${giveaway.author_id}> · ${meta.join(' · ')}`,
    blocks: [
      ...blocks,
      `**Uczestnicy:** ${entries} ${plural(entries, 'osoba', 'osoby', 'osob')}`,
    ],
    rows: giveaway.closed
      ? [
          row(
            button({
              id: customId(NAMESPACE, 'reroll', giveaway.id),
              label: 'Losuj ponownie',
              style: 'secondary',
              emoji: '🔄',
            }),
          ),
        ]
      : [
          row(
            button({
              id: customId(NAMESPACE, 'join', giveaway.id),
              label: 'Dolacz do losowania',
              style: 'success',
              emoji: '🎉',
            }),
            button({
              id: customId(NAMESPACE, 'leave', giveaway.id),
              label: 'Wycofaj sie',
              style: 'secondary',
              emoji: '↩️',
            }),
            button({
              id: customId(NAMESPACE, 'end', giveaway.id),
              label: 'Zakoncz teraz',
              style: 'danger',
              emoji: '🛑',
            }),
          ),
        ],
    footer: giveaway.closed
      ? 'Losowanie zakonczone. Autor / admin moze losowac ponownie.'
      : 'Kliknij "Dolacz" aby wziac udzial. Wygrywajacy zostana wylosowani po uplywie czasu.',
  });
}

/** Losuje N unikalnych zwyciezcow z puli. */
function drawWinners(userIds, count) {
  if (!userIds || userIds.length === 0) return [];
  const pool = [...userIds];
  const winners = [];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool[index]);
    pool.splice(index, 1);
  }
  return winners;
}

async function refreshMessage(client, giveaway) {
  if (!giveaway.message_id) return;
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (!message) return;

    await message.edit({
      components: [buildPanel(giveaway)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.debug(`Nie udalo sie odswiezyc giveaway #${giveaway.id}:`, error.message);
  }
}

/** Zamyka losowanie: losuje zwyciezcow, ogłasza w kanale, edytuje panel. */
async function finalizeGiveaway(client, giveawayId) {
  const giveaway = giveawaysRepo.get(giveawayId);
  if (!giveaway || giveaway.closed) return null;

  const entries = giveawaysRepo.entries(giveawayId);
  const winners = drawWinners(entries, giveaway.winners_count);
  giveawaysRepo.markClosed(giveawayId, winners);

  const closed = giveawaysRepo.get(giveawayId);
  await refreshMessage(client, closed);

  // Ogloszenie zwyciezcow ponizej oryginalnego panelu.
  try {
    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (channel && giveaway.message_id) {
      const mentions = winners.map((id) => `<@${id}>`).join(', ');
      const content = winners.length
        ? `🎉 Gratulacje ${mentions}! Wygrywacie **${giveaway.prize}**.`
        : `😔 Losowanie **${giveaway.prize}** zakonczone bez zwyciezcow (nikt nie dolaczyl).`;
      await channel.send({
        content,
        reply: { messageReference: giveaway.message_id, failIfNotExists: false },
        allowedMentions: { users: winners },
      });
    }
  } catch (error) {
    logger.debug(`Nie udalo sie ogłosic zwyciezcy giveaway #${giveawayId}:`, error.message);
  }

  return closed;
}

async function rerollGiveaway(client, giveawayId, { announceChannel } = {}) {
  const giveaway = giveawaysRepo.get(giveawayId);
  if (!giveaway) return null;

  const entries = giveawaysRepo.entries(giveawayId);
  const previous = new Set(giveaway.winner_ids ?? []);
  const pool = entries.filter((id) => !previous.has(id));
  const winners = drawWinners(pool.length > 0 ? pool : entries, giveaway.winners_count);
  giveawaysRepo.markClosed(giveawayId, winners);

  const refreshed = giveawaysRepo.get(giveawayId);
  await refreshMessage(client, refreshed);

  if (announceChannel) {
    const mentions = winners.map((id) => `<@${id}>`).join(', ');
    const content = winners.length
      ? `🔄 Ponowne losowanie **${giveaway.prize}** — wygrywa: ${mentions}!`
      : `🔄 Ponowne losowanie **${giveaway.prize}** — brak kandydatow.`;
    await announceChannel.send({ content, allowedMentions: { users: winners } });
  }

  return refreshed;
}

module.exports = {
  NAMESPACE,
  buildPanel,
  refreshMessage,
  finalizeGiveaway,
  rerollGiveaway,
  drawWinners,
};
