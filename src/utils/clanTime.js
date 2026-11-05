'use strict';

/**
 * Czas lokalny klanu (Europe/Warsaw) — daty urlopow i termin raportu tygodniowego.
 * Formaty z sama data (koniec dnia) obsluguje parseLeaveDate; wszystko, co ma
 * godzine ("jutro 20:00", "20.11 18:00"), trafia do wspolnego parseTime z utils/time.
 */
const { parseTime } = require('./time');

const TIME_ZONE = 'Europe/Warsaw';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
});

/** Rozbija znacznik czasu na czesci w strefie Europe/Warsaw (weekday: 0 = poniedzialek). */
function zonedParts(ms) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** Zamienia czas lokalny (Europe/Warsaw) na znacznik UTC w ms. */
function zonedToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function isValidDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const RELATIVE_UNITS = [
  [/^(h|g|godz|godzin|godziny|godzine)$/, HOUR_MS],
  [/^(d|dn|dni|dzien|dzień|dnia)$/, DAY_MS],
  [/^(t|w|tydz|tyg|tydzien|tydzień|tygodnie|tygodni)$/, 7 * DAY_MS],
];

/**
 * Parsuje date konca urlopu. Obslugiwane formaty:
 *  - `2026-11-20`        (koniec dnia w Polsce)
 *  - `20.11` / `20.11.2026` / `20/11` (bez roku: najblizsza przyszla data)
 *  - `za 7d`, `7d`, `za 2 tyg`, `za 12h`
 * Zwraca znacznik czasu (ms) albo null.
 */
function parseLeaveDate(input, now = Date.now()) {
  const value = String(input ?? '').trim().toLowerCase();
  if (!value) return null;

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    if (!isValidDate(year, month, day)) return null;
    return zonedToUtc(year, month, day, 23, 59, 59);
  }

  match = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\.?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year;
    if (match[3]) {
      year = Number(match[3]);
      if (year < 100) year += 2000;
    } else {
      year = zonedParts(now).year;
    }
    if (!isValidDate(year, month, day)) return null;
    let endsAt = zonedToUtc(year, month, day, 23, 59, 59);
    if (!match[3] && endsAt < now) {
      if (!isValidDate(year + 1, month, day)) return null;
      endsAt = zonedToUtc(year + 1, month, day, 23, 59, 59);
    }
    return endsAt;
  }

  match = value.match(/^(?:za\s*)?(\d{1,4})\s*([a-ząćęłńóśźż]+)$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = RELATIVE_UNITS.find(([pattern]) => pattern.test(match[2]));
    if (amount <= 0) return null;
    if (unit) return now + amount * unit[1];
    // nieznana tu jednostka (np. "minut") — sprobuje parseTime ponizej
  }

  // Pozostale formaty (z godzina) — ten sam parser co /event i /przypomnij.
  return parseTime(value, { now });
}

/** Klucz dnia (YYYY-MM-DD) z czesci daty. */
function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Ostatni termin raportu tygodniowego (domyslnie poniedzialek 10:00 Europe/Warsaw) <= now.
 * Zwraca { key, at, since } — key = data poniedzialku, since = termin tydzien wczesniej.
 */
function reportSlot(now = Date.now(), { weekday = 0, hour = 10 } = {}) {
  const local = zonedParts(now);
  const todayUtc = Date.UTC(local.year, local.month - 1, local.day);
  let offsetDays = (local.weekday - weekday + 7) % 7;

  const slotFor = (days) => {
    const date = new Date(todayUtc - days * DAY_MS);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    return { key: dateKey(y, m, d), at: zonedToUtc(y, m, d, hour, 0, 0) };
  };

  let slot = slotFor(offsetDays);
  if (slot.at > now) {
    offsetDays += 7;
    slot = slotFor(offsetDays);
  }
  const previous = slotFor(offsetDays + 7);
  return { key: slot.key, at: slot.at, since: previous.at };
}

module.exports = { TIME_ZONE, DAY_MS, zonedParts, zonedToUtc, parseLeaveDate, reportSlot };
