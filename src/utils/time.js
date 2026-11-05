'use strict';

const { parseDuration } = require('./format');

/**
 * Parser terminow wpisywanych przez uzytkownikow (wydarzenia, przypomnienia).
 * Wszystkie godziny interpretujemy w strefie Europe/Warsaw, niezaleznie od
 * strefy serwera, na ktorym dziala bot. Zwracamy znacznik czasu w ms (UTC).
 *
 * Obslugiwane formaty:
 *   2026-11-20 20:00 · 20.11.2026 20:00 · 20.11 20:00
 *   dzis 20:00 · jutro 20:00 · pojutrze o 18:30
 *   20:00 (dzis, a jesli juz minela — jutro)
 *   za 2h · za 1h30m · za 30 minut · 2h · 1d
 */

const ZONE = 'Europe/Warsaw';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Rozbija znacznik czasu na skladowe daty w strefie Europe/Warsaw. */
function zonedParts(ms) {
  const parts = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Przesuniecie strefy Europe/Warsaw wzgledem UTC (ms) w danej chwili. */
function offsetAt(ms) {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Zamienia czas "na zegarku w Warszawie" na znacznik UTC.
 * Zwraca null dla nieistniejacych dat (np. 31.02).
 */
function warsawToUtc(year, month, day, hour, minute) {
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const first = offsetAt(guess);
  let result = guess - first;
  const second = offsetAt(result);
  if (second !== first) result = guess - second;
  return result;
}

/** Dzisiejsza data w Warszawie przesunieta o `days` dni. */
function warsawDate(now, days = 0) {
  const today = zonedParts(now);
  const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Zamienia slowne jednostki ("2 godziny", "30 minut") na skroty rozumiane przez parseDuration. */
function normalizeUnits(value) {
  return value
    .replace(/(tygodni[ea]?|tydzie[nń])/g, 'w')
    .replace(/(godzin[aey]?|godz\.?)/g, 'h')
    .replace(/(minut[aey]?|min\.?)/g, 'm')
    .replace(/(sekund[aey]?|sek\.?)/g, 's')
    .replace(/(dni|dzie[nń]|doby|dob[aey]?)/g, 'd');
}

const TIME = '(\\d{1,2}):(\\d{2})';
const DAY_WORDS = { dzis: 0, 'dziś': 0, dzisiaj: 0, jutro: 1, pojutrze: 2 };

/**
 * Parsuje termin. Zwraca znacznik czasu (ms) albo null, gdy tekst jest niezrozumialy.
 * Nie sprawdza, czy termin jest w przyszlosci — to zadanie wywolujacego.
 */
function parseTime(input, { now = Date.now() } = {}) {
  if (input === null || input === undefined) return null;
  const value = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;

  // Czas wzgledny: "za 2h", "za 30 minut", "1h30m"
  const relative = value.match(/^(?:za\s*)?(.+)$/);
  const units = normalizeUnits(relative[1]).replace(/\s+/g, '');
  if (/^(\d+(sek|min|godz|[smhgdwt]))+$/.test(units)) {
    const duration = parseDuration(units);
    return duration ? now + duration : null;
  }

  let match = value.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:\\s*t\\s*|\\s+)(?:o\\s+)?${TIME}$`));
  if (match) {
    const [, year, month, day, hour, minute] = match.map(Number);
    return warsawToUtc(year, month, day, hour, minute);
  }

  match = value.match(new RegExp(`^(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?\\s+(?:o\\s+)?${TIME}$`));
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (match[3]) return warsawToUtc(Number(match[3]), month, day, hour, minute);

    // Bez roku: najblizszy taki dzien (w tym roku, a jesli minal — w przyszlym)
    const { year } = warsawDate(now);
    const thisYear = warsawToUtc(year, month, day, hour, minute);
    if (thisYear === null) return null;
    return thisYear > now ? thisYear : warsawToUtc(year + 1, month, day, hour, minute);
  }

  match = value.match(new RegExp(`^(dzis|dziś|dzisiaj|jutro|pojutrze)\\s+(?:o\\s+)?${TIME}$`));
  if (match) {
    const date = warsawDate(now, DAY_WORDS[match[1]]);
    return warsawToUtc(date.year, date.month, date.day, Number(match[2]), Number(match[3]));
  }

  match = value.match(new RegExp(`^(?:o\\s+)?${TIME}$`));
  if (match) {
    const today = warsawDate(now);
    const at = warsawToUtc(today.year, today.month, today.day, Number(match[1]), Number(match[2]));
    if (at === null) return null;
    if (at > now) return at;
    const tomorrow = warsawDate(now, 1);
    return warsawToUtc(tomorrow.year, tomorrow.month, tomorrow.day, Number(match[1]), Number(match[2]));
  }

  return null;
}

/** Formatuje znacznik czasu jako "RRRR-MM-DD GG:MM" w strefie Europe/Warsaw. */
function formatWarsaw(ms) {
  const p = zonedParts(ms);
  const pad = (number) => String(number).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Podpowiedz z obslugiwanymi formatami — do komunikatow bledow. */
const TIME_HELP = 'Przyklady: `2026-11-20 20:00`, `20.11 20:00`, `jutro 20:00`, `20:00`, `za 2h`, `za 30m`.';

module.exports = { ZONE, parseTime, formatWarsaw, warsawToUtc, TIME_HELP };
