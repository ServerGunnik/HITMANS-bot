'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

const pollsRepo = require('../database/repositories/polls');
const { COLORS, EMOJI, button, panel, row, V2_FLAGS } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { truncate, timestamp, plural } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'ankieta';
const MAX_OPTIONS = 10;
const MAX_OPTIONS_AS_BUTTONS = 5;

/** Znaki liter dla numeracji opcji A-J. */
const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];

/** Buduje pasek postepu z bloków unicode. */
function progressBar(value, total, width = 12) {
  if (total <= 0) return '─'.repeat(width);
  const filled = Math.round((value / total) * width);
  return '█'.repeat(filled) + '─'.repeat(width - filled);
}

function optionLine(option, votes, totalVotes, index, { showBars }) {
  const emoji = LETTERS[index] ?? '•';
  const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
  const suffix = showBars ? `\n> \`${progressBar(votes, totalVotes)}\` **${votes}** (${percentage}%)` : '';
  return `${emoji} ${option.label}${suffix}`;
}

/** Buduje kontener panelu ankiety — uzywany zarowno przy publikacji jak i przy odswiezaniu. */
function buildPanel(poll, { showResults } = {}) {
  const { options, uniqueVoters } = pollsRepo.tally(poll.id);
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  const revealResults = showResults ?? (!poll.anonymous || poll.closed);

  const meta = [];
  meta.push(poll.multi ? 'wielokrotny wybor' : 'pojedynczy wybor');
  meta.push(poll.anonymous ? 'anonimowa' : 'jawna');
  if (poll.ends_at) {
    meta.push(poll.closed ? `zamknieta ${timestamp(poll.ends_at, 'R')}` : `konczy sie ${timestamp(poll.ends_at, 'R')}`);
  }

  const blocks = [
    options.map((option, index) => optionLine(option, option.votes, totalVotes, index, { showBars: revealResults })).join('\n\n'),
  ];

  if (revealResults) {
    blocks.push(
      `\n**Lacznie:** ${totalVotes} ${plural(totalVotes, 'glos', 'glosy', 'glosow')} · ` +
        `${uniqueVoters} ${plural(uniqueVoters, 'osoba', 'osoby', 'osob')}`,
    );
  } else {
    blocks.push('\n*Wyniki sa ukryte do zamkniecia ankiety (anonimowa).*');
  }

  const rows = poll.closed ? [] : buildRows(poll, options);

  return panel({
    color: poll.closed ? COLORS.neutral : COLORS.primary,
    title: `${EMOJI.chart} ${truncate(poll.question, 200)}`,
    description: `-# Utworzone przez <@${poll.author_id}> · ${meta.join(' · ')}`,
    blocks,
    rows,
    footer: poll.closed
      ? 'Ankieta zakonczona.'
      : poll.multi
        ? 'Mozesz zaznaczyc kilka opcji. Kliknij ponownie aby wycofac glos.'
        : 'Wybierz jedna opcje. Kliknij ponownie aby wycofac glos.',
  });
}

function buildRows(poll, options) {
  const rows = [];

  if (options.length <= MAX_OPTIONS_AS_BUTTONS) {
    const buttons = options.map((option, index) =>
      button({
        id: customId(NAMESPACE, 'vote', poll.id, option.id),
        label: truncate(option.label, 40),
        emoji: LETTERS[index],
        style: 'secondary',
      }),
    );
    // Discord: max 5 przyciskow w wierszu
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(row(buttons.slice(i, i + 5)));
    }
  } else {
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId(NAMESPACE, 'vote', poll.id))
      .setPlaceholder('Wybierz opcje')
      .setMinValues(1)
      .setMaxValues(poll.multi ? options.length : 1)
      .addOptions(
        options.map((option, index) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncate(option.label, 100))
            .setValue(String(option.id))
            .setEmoji(LETTERS[index]),
        ),
      );
    rows.push(new ActionRowBuilder().addComponents(select));
  }

  rows.push(
    row(
      button({
        id: customId(NAMESPACE, 'results', poll.id),
        label: 'Wyniki',
        style: 'secondary',
        emoji: '📊',
      }),
      button({
        id: customId(NAMESPACE, 'close', poll.id),
        label: 'Zamknij ankiete',
        style: 'danger',
        emoji: '🔒',
      }),
    ),
  );

  return rows;
}

/** Odswieza wiadomosc panelu ankiety (po glosie / zamknieciu). */
async function refreshMessage(client, poll) {
  if (!poll.message_id) return;
  try {
    const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(poll.message_id).catch(() => null);
    if (!message) return;

    await message.edit({
      components: [buildPanel(poll)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.debug(`Nie udalo sie odswiezyc ankiety #${poll.id}:`, error.message);
  }
}

/** Zamknij ankiete i odswiez wiadomosc. */
async function closePoll(client, pollId) {
  const poll = pollsRepo.get(pollId);
  if (!poll || poll.closed) return null;
  pollsRepo.close(pollId);
  const closed = pollsRepo.get(pollId);
  await refreshMessage(client, closed);
  return closed;
}

module.exports = {
  NAMESPACE,
  MAX_OPTIONS,
  buildPanel,
  refreshMessage,
  closePoll,
};
