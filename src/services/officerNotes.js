'use strict';

const notes = require('../database/repositories/officerNotes');
const { COLORS, panel } = require('../ui/components');
const { plural, timestamp, truncate } = require('../utils/format');

/** Krotkie podsumowanie notatek do /profil (liczba + najnowsza) albo null, gdy brak. */
function summary(guildId, userId) {
  const total = notes.count(guildId, userId);
  if (total === 0) return null;
  const [latest] = notes.list(guildId, userId, { limit: 1 });
  return (
    `**${total}** ${plural(total, 'notatka', 'notatki', 'notatek')} • najnowsza ${timestamp(latest.created_at, 'R')} ` +
    `(<@${latest.author_id}>):\n> ${truncate(latest.content.replace(/\n+/g, ' '), 200)}\n` +
    '-# Pelna lista: `/notatka lista`'
  );
}

/** Panel z lista notatek o osobie (tylko dla kadry, zawsze ephemeral). */
function buildNotesPanel(user, list, total) {
  const blocks = [];
  let used = 0;
  for (const note of list) {
    const block =
      `**#${note.id}** • ${timestamp(note.created_at, 'f')} • <@${note.author_id}>\n` +
      `> ${truncate(note.content, 600).replace(/\n/g, '\n> ')}`;
    if (used + block.length > 3200) break;
    blocks.push(block);
    used += block.length;
  }

  return panel({
    color: COLORS.neutral,
    title: `🗒️ Notatki oficerow — ${user.username}`,
    description: total
      ? `${user} ma **${total}** ${plural(total, 'notatke', 'notatki', 'notatek')}.`
      : `Brak notatek o ${user}.`,
    blocks,
    footer:
      blocks.length < total
        ? `Pokazano ${blocks.length} najnowszych z ${total} • ID: ${user.id}`
        : `Widoczne tylko dla kadry • ID: ${user.id}`,
  });
}

/** Ephemeral panel z podsumowaniem notatek (dla publicznego /profil oglaganego przez oficera). */
function buildSummaryPanel(guildId, userId) {
  const value = summary(guildId, userId);
  if (!value) return null;
  return panel({ color: COLORS.neutral, title: '🗒️ Notatki oficerow', description: value, footer: 'Widoczne tylko dla Ciebie.' });
}

module.exports = { summary, buildNotesPanel, buildSummaryPanel };
