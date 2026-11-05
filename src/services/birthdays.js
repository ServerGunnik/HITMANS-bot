'use strict';

const birthdaysRepo = require('../database/repositories/birthdays');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { canManageRole } = require('../utils/permissions');
const { truncate } = require('../utils/format');
const logger = require('../utils/logger');

const TIME_ZONE = 'Europe/Warsaw';
/** Godzina (czasu polskiego), od ktorej wysylamy zyczenia. */
const POST_HOUR = 9;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIST = 25;

const MONTHS = [
  'Styczen',
  'Luty',
  'Marzec',
  'Kwiecien',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpien',
  'Wrzesien',
  'Pazdziernik',
  'Listopad',
  'Grudzien',
];

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Rozbija chwile na date i godzine w strefie Europe/Warsaw. */
function warsawParts(date = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** 'YYYY-MM-DD' — klucz dnia zapisywany w bazie. */
function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month, year) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Sprawdza poprawnosc daty urodzin. Bez roku dopuszczamy 29 lutego.
 * Zwraca { ok: true } albo { ok: false, reason }.
 */
function validate(day, month, year = null, currentYear = new Date().getUTCFullYear()) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return { ok: false, reason: 'Nieprawidlowy miesiac.' };
  if (year !== null && year !== undefined) {
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
      return { ok: false, reason: `Rok musi byc z zakresu 1900-${currentYear}.` };
    }
  }
  // Bez roku sprawdzamy wzgledem roku przestepnego, zeby 29.02 bylo dozwolone.
  const max = daysInMonth(month, year ?? 2000);
  if (!Number.isInteger(day) || day < 1 || day > max) {
    const label = year ? `${MONTHS[month - 1]} ${year}` : MONTHS[month - 1];
    return { ok: false, reason: `${label} ma tylko ${max} dni.` };
  }
  return { ok: true };
}

/** Dzien obchodow w danym roku — 29 lutego w latach nieprzestepnych to 28 lutego. */
function celebrationDate(entry, year) {
  if (entry.month === 2 && entry.day === 29 && !isLeapYear(year)) return { month: 2, day: 28 };
  return { month: entry.month, day: entry.day };
}

function isBirthdayOn(entry, today) {
  const date = celebrationDate(entry, today.year);
  return date.month === today.month && date.day === today.day;
}

/** Ile dni do najblizszych obchodow (0 = dzisiaj). */
function daysUntil(entry, today) {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  let date = celebrationDate(entry, today.year);
  let target = Date.UTC(today.year, date.month - 1, date.day);
  if (target < start) {
    date = celebrationDate(entry, today.year + 1);
    target = Date.UTC(today.year + 1, date.month - 1, date.day);
  }
  return Math.round((target - start) / DAY_MS);
}

/** Wiek konczony przy najblizszych obchodach (null, gdy brak roku). */
function upcomingAge(entry, today) {
  if (!entry.year) return null;
  const date = celebrationDate(entry, today.year);
  const passed = date.month < today.month || (date.month === today.month && date.day < today.day);
  return (passed ? today.year + 1 : today.year) - entry.year;
}

/** Urodziny w ciagu `days` dni, posortowane od najblizszych (takze przez przelom roku). */
function upcoming(entries, today, days = 30) {
  return entries
    .map((entry) => ({ ...entry, inDays: daysUntil(entry, today), age: upcomingAge(entry, today) }))
    .filter((entry) => entry.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays || String(a.user_id).localeCompare(String(b.user_id)));
}

/** Czy pora wyslac dzisiejsze zyczenia (po 9:00 i jeszcze nie wyslane). */
function shouldPost(today, lastPostedDate) {
  return today.hour >= POST_HOUR && lastPostedDate !== dateKey(today);
}

function formatDay(entry) {
  return `${String(entry.day).padStart(2, '0')}.${String(entry.month).padStart(2, '0')}`;
}

/** Karta z zyczeniami dla solenizantow. */
function buildWishes(entries, today) {
  const lines = entries.map((entry) => {
    const age = entry.year ? today.year - entry.year : null;
    return `🎂 <@${entry.user_id}>${age ? ` — konczy dzis **${age}** lat!` : ''}`;
  });

  return panel({
    color: COLORS.clan,
    title: '🎉 Wszystkiego najlepszego!',
    description:
      (entries.length === 1 ? 'Dzisiaj swoje urodziny obchodzi:' : 'Dzisiaj swoje urodziny obchodza:') +
      `\n${truncate(lines.join('\n'), 3000)}`,
    footer: 'Zlozcie zyczenia! • Swoja date ustawisz przez /urodziny ustaw',
  });
}

/** Lista nadchodzacych urodzin. */
function buildList(guildName, list, days = 30) {
  const shown = list.slice(0, MAX_LIST);
  const lines = shown.map((entry) => {
    const when = entry.inDays === 0 ? '**dzisiaj** 🎂' : entry.inDays === 1 ? 'jutro' : `za ${entry.inDays} dni`;
    const age = entry.age ? ` • ${entry.age} lat` : '';
    return `\`${formatDay(entry)}\` <@${entry.user_id}> — ${when}${age}`;
  });

  return panel({
    color: COLORS.clan,
    title: '🎂 Nadchodzace urodziny',
    description: lines.length
      ? truncate(lines.join('\n'), 3500)
      : `Nikt na **${guildName}** nie ma urodzin w ciagu najblizszych ${days} dni.`,
    footer:
      list.length > shown.length
        ? `Pokazano ${shown.length} z ${list.length}. • /urodziny ustaw — dodaj swoja date`
        : '/urodziny ustaw — dodaj swoja date',
  });
}

/** Zdejmuje role urodzinowe nadane poprzedniego dnia (lub wczesniej). */
async function removeExpiredRoles(client, todayKey) {
  for (const grant of birthdaysRepo.expiredRoleGrants(todayKey)) {
    const guild = client.guilds.cache.get(grant.guild_id);
    if (guild) {
      const member = await guild.members.fetch(grant.user_id).catch(() => null);
      if (member?.roles.cache.has(grant.role_id)) {
        await member.roles
          .remove(grant.role_id, 'Koniec dnia urodzin')
          .catch((error) => logger.debug(`Rola urodzinowa ${grant.user_id}:`, error.message));
      }
    }
    birthdaysRepo.removeRoleGrant(grant.guild_id, grant.user_id, grant.role_id);
  }
}

/** Wysyla zyczenia na jednym serwerze i nadaje role na dzien. */
async function postForGuild(guild, settings, today) {
  const todays = birthdaysRepo.listByGuild(guild.id).filter((entry) => isBirthdayOn(entry, today));
  if (todays.length === 0) return 0;

  const present = [];
  for (const entry of todays) {
    const member = await guild.members.fetch(entry.user_id).catch(() => null);
    if (member) present.push({ entry, member });
  }
  if (present.length === 0) return 0;

  const channel = guild.channels.cache.get(settings.channel_id);
  if (channel?.isTextBased()) {
    await channel.send({
      components: [buildWishes(present.map((item) => item.entry), today)],
      flags: V2_FLAGS,
      allowedMentions: { users: present.map((item) => item.member.id) },
    });
  } else {
    logger.warn(`Urodziny: kanal ${settings.channel_id} na ${guild.id} nie istnieje.`);
  }

  const role = settings.role_id ? guild.roles.cache.get(settings.role_id) : null;
  if (role && canManageRole(guild, role).ok) {
    for (const { member } of present) {
      try {
        await member.roles.add(role, 'Urodziny');
        birthdaysRepo.addRoleGrant(guild.id, member.id, role.id, dateKey(today));
      } catch (error) {
        logger.debug(`Nie nadano roli urodzinowej ${member.id}:`, error.message);
      }
    }
  }

  return present.length;
}

/** Wywolywane przez scheduler co 30 s. */
async function tick(client, now = new Date()) {
  const today = warsawParts(now);
  const key = dateKey(today);

  await removeExpiredRoles(client, key);

  for (const settings of birthdaysRepo.listConfigured()) {
    if (!shouldPost(today, settings.last_posted_date)) continue;
    const guild = client.guilds.cache.get(settings.guild_id);
    if (!guild) continue;
    // Najpierw zapisujemy dzien — restart w trakcie wysylki nie zdubluje zyczen.
    if (!birthdaysRepo.claimDay(guild.id, key)) continue;

    try {
      const count = await postForGuild(guild, settings, today);
      if (count > 0) logger.info(`Urodziny: wyslano zyczenia (${count}) na ${guild.name}.`);
    } catch (error) {
      logger.warn(`Urodziny na ${guild.id}:`, error.message);
    }
  }
}

module.exports = {
  TIME_ZONE,
  POST_HOUR,
  MONTHS,
  warsawParts,
  dateKey,
  isLeapYear,
  daysInMonth,
  validate,
  celebrationDate,
  isBirthdayOn,
  daysUntil,
  upcomingAge,
  upcoming,
  shouldPost,
  formatDay,
  buildWishes,
  buildList,
  tick,
};
