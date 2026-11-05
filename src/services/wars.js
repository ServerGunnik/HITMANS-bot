'use strict';

const warsRepo = require('../database/repositories/wars');
const { COLORS, panel } = require('../ui/components');
const { mentionList } = require('../utils/mentions');
const { sanitize, timestamp, truncate } = require('../utils/format');

const RESULT_META = {
  win: { label: 'Wygrana', emoji: '🏆', color: COLORS.success },
  loss: { label: 'Przegrana', emoji: '💀', color: COLORS.danger },
  draw: { label: 'Remis', emoji: '🤝', color: COLORS.warning },
};

const MEDALS = ['🥇', '🥈', '🥉'];

/** Procent wygranych (remisy licza sie do mianownika). */
function winRate({ wins, total }) {
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}

function battleLine(war) {
  const meta = RESULT_META[war.result];
  const score = war.score ? ` **${sanitize(war.score)}**` : '';
  const people = war.participant_count ?? war.participants?.length ?? 0;
  return `\`#${war.id}\` ${meta.emoji} ${meta.label}${score} vs **${sanitize(truncate(war.opponent, 60))}** · ${timestamp(war.fought_at, 'd')} · 👥 ${people}`;
}

/** Karta zapisanej bitwy. */
function buildWarCard(war) {
  const meta = RESULT_META[war.result];
  return panel({
    color: meta.color,
    title: `${meta.emoji} ${meta.label} vs ${sanitize(truncate(war.opponent, 100))}`,
    description: `-# Zapisal(a) <@${war.recorded_by}> · ${timestamp(war.fought_at, 'f')}`,
    fields: [
      war.score ? { name: 'Wynik', value: sanitize(war.score), inline: true } : null,
      war.event_id ? { name: 'Wydarzenie', value: `#${war.event_id}`, inline: true } : null,
      { name: `Uczestnicy (${war.participants.length})`, value: mentionList(war.participants, 40) },
    ],
    footer: `Bitwa #${war.id}`,
  });
}

/** Statystyki klanu: bilans W/L/D, procent wygranych i ostatnie bitwy. */
function buildStatsPanel(guild, { opponent } = {}) {
  const stats = warsRepo.summary(guild.id, { opponent });
  const recent = warsRepo.recent(guild.id, { limit: 10, opponent });

  return panel({
    color: COLORS.clan,
    title: opponent ? `⚔️ Wojny vs ${sanitize(truncate(opponent, 80))}` : `⚔️ Wojny klanu — ${guild.name}`,
    fields: [
      { name: 'Bitwy', value: `**${stats.total}**`, inline: true },
      { name: 'Bilans (W/P/R)', value: `🏆 **${stats.wins}** · 💀 **${stats.losses}** · 🤝 **${stats.draws}**`, inline: true },
      { name: 'Procent wygranych', value: `**${winRate(stats)}%**`, inline: true },
      { name: 'Ostatnie bitwy', value: recent.length ? recent.map(battleLine).join('\n') : '*Brak zapisanych bitew.*' },
    ],
    footer: 'Nowa bitwa: /wojna wynik · ranking graczy: /wojna ranking',
  });
}

/** Ranking graczy wg udzialu w bitwach albo wygranych. */
function buildRankingPanel(guild, { by = 'battles' } = {}) {
  const top = warsRepo.ranking(guild.id, { by, limit: 15 });
  const lines = top.map((entry, index) => {
    const place = MEDALS[index] ?? `**${index + 1}.**`;
    const rate = winRate({ wins: entry.wins, total: entry.battles });
    return `${place} <@${entry.user_id}> — bitwy: **${entry.battles}** · wygrane: **${entry.wins}** (${rate}%)`;
  });

  return panel({
    color: COLORS.clan,
    title: by === 'wins' ? '🏆 Ranking — wygrane bitwy' : '⚔️ Ranking — udzial w bitwach',
    description: lines.length ? lines.join('\n') : '*Brak zapisanych bitew.*',
    footer: guild.name,
  });
}

/** Krotkie podsumowanie do /profil — null, gdy gracz nie bral udzialu w bitwach. */
function profileSummary(guildId, userId) {
  const stats = warsRepo.memberStats(guildId, userId);
  if (!stats || stats.battles === 0) return null;
  return (
    `Bitwy: **${stats.battles}** • Wygrane: **${stats.wins}** (${winRate({ wins: stats.wins, total: stats.battles })}%)` +
    ` • Przegrane: **${stats.losses}** • Remisy: **${stats.draws}**`
  );
}

module.exports = { RESULT_META, winRate, battleLine, buildWarCard, buildStatsPanel, buildRankingPanel, profileSummary };
