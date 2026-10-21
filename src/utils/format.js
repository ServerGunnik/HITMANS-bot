'use strict';

/** Zamienia date na znacznik czasu Discorda, np. <t:1700000000:R>. */
function timestamp(date, style = 'f') {
  if (date === null || date === undefined) return 'brak danych';

  const ms = date instanceof Date ? date.getTime() : Number(date);
  // Daty Discorda sa zawsze po 2015 r., wiec 0 i wartosci ujemne traktujemy
  // jako brak danych (np. pusta kolumna last_message_at w bazie).
  if (!Number.isFinite(ms) || ms <= 0) return 'brak danych';

  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

const DURATION_UNITS = {
  s: 1000,
  sek: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  h: 60 * 60 * 1000,
  g: 60 * 60 * 1000,
  godz: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  t: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Parsuje zapis czasu typu "10m", "2h30m", "7d" na milisekundy.
 * Zwraca null, gdy tekst jest nieprawidlowy.
 */
function parseDuration(input) {
  if (!input) return null;
  const normalized = String(input).toLowerCase().replace(/\s+/g, '');
  const matches = normalized.match(/(\d+)(sek|min|godz|[smhgdwt])/g);
  if (!matches) return null;

  let total = 0;
  for (const match of matches) {
    const [, amount, unit] = match.match(/(\d+)(sek|min|godz|[smhgdwt])/);
    const multiplier = DURATION_UNITS[unit];
    if (!multiplier) return null;
    total += Number(amount) * multiplier;
  }
  return total > 0 ? total : null;
}

/** Zamienia milisekundy na czytelny tekst, np. "2 godz. 30 min". */
function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s';

  const units = [
    ['dni', 24 * 60 * 60 * 1000],
    ['godz.', 60 * 60 * 1000],
    ['min', 60 * 1000],
    ['s', 1000],
  ];

  const parts = [];
  let rest = ms;
  for (const [label, size] of units) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value} ${label}`);
      rest -= value * size;
    }
  }
  return parts.slice(0, 2).join(' ');
}

/** Skraca tekst do limitu znakow Discorda. */
function truncate(text, max = 1024) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Usuwa markdown, ktory moglby rozbic uklad wiadomosci bota. */
function sanitize(text) {
  return String(text ?? '')
    .replace(/[`*_~|>]/g, (match) => `\\${match}`)
    .replace(/@(everyone|here)/g, '@​$1');
}

/** Prosty wykres slupkowy z blokow unicode - uzywany w /stats. */
function sparkline(values) {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values, 1);
  return values.map((value) => blocks[Math.min(blocks.length - 1, Math.floor((value / max) * (blocks.length - 1)))]).join('');
}

/** Formatuje liczbe z separatorem tysiecy (1234567 -> "1 234 567"). */
function formatNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '0';
  return Math.trunc(number)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

function plural(count, one, few, many) {
  const n = Math.abs(count);
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

module.exports = {
  timestamp,
  parseDuration,
  humanDuration,
  truncate,
  sanitize,
  sparkline,
  plural,
  formatNumber,
};
