'use strict';

const { PermissionFlagsBits } = require('discord.js');

const activityRepo = require('../database/repositories/clanActivity');
const guilds = require('../database/repositories/guilds');
const leavesRepo = require('../database/repositories/leaves');
const roles = require('../database/repositories/roles');
const { isAdmin } = require('../utils/permissions');
const { COLORS, panel } = require('../ui/components');
const { plural, timestamp } = require('../utils/format');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;

/**
 * Oficer = administrator, osoba z uprawnieniem moderowania czlonkow
 * albo posiadacz najwyzszego stopnia hierarchii klanu.
 */
function isOfficer(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ModerateMembers)) return true;

  const hierarchy = roles.list(member.guild.id);
  if (hierarchy.length < 2) return false;
  const top = hierarchy.reduce((best, entry) => (entry.level > best.level ? entry : best), hierarchy[0]);
  return member.roles?.cache?.has(top.role_id) ?? false;
}

/** Czy osoba nalezy do klanu (rola czlonka albo dowolna rola z hierarchii). */
function isClanMember(member, { memberRoleId = null, hierarchyRoleIds = [] } = {}) {
  if (!member || member.user?.bot) return false;
  const cache = member.roles?.cache;
  if (!cache) return false;
  if (memberRoleId && cache.has(memberRoleId)) return true;
  return hierarchyRoleIds.some((roleId) => cache.has(roleId));
}

/**
 * Czysta funkcja: wybiera nieaktywnych z listy czlonkow.
 * members: [{ id, joinedAt }], activity: Map(userId -> { lastActiveAt }), onLeave: Map(userId -> urlop).
 * Osoby, ktore dolaczyly w ciagu ostatnich N dni, nie sa uznawane za nieaktywne.
 */
function findInactive(members, activity, { days = DEFAULT_DAYS, now = Date.now(), onLeave = new Map() } = {}) {
  const threshold = now - days * DAY_MS;
  const inactive = [];
  const away = [];

  for (const member of members) {
    const lastActiveAt = activity.get(member.id)?.lastActiveAt ?? null;
    if (lastActiveAt && lastActiveAt >= threshold) continue;
    if (member.joinedAt && member.joinedAt >= threshold) continue;

    const entry = { id: member.id, lastActiveAt, joinedAt: member.joinedAt ?? null };
    if (onLeave.has(member.id)) away.push({ ...entry, leave: onLeave.get(member.id) });
    else inactive.push(entry);
  }

  const byLastSeen = (a, b) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
  inactive.sort(byLastSeen);
  away.sort(byLastSeen);
  return { inactive, away, threshold };
}

/** Pobiera czlonkow klanu z serwera i liczy nieaktywnych. */
async function collectInactive(guild, { days = DEFAULT_DAYS, now = Date.now() } = {}) {
  let members = guild.members.cache;
  if (typeof guild.members.fetch === 'function' && (guild.memberCount ?? 0) <= 10000) {
    const fetched = await guild.members.fetch().catch(() => null);
    if (typeof fetched?.values === 'function') members = fetched;
  }

  const settings = guilds.get(guild.id);
  const hierarchyRoleIds = roles.list(guild.id).map((entry) => entry.role_id);
  const clan = [...members.values()].filter((member) =>
    isClanMember(member, { memberRoleId: settings.member_role_id, hierarchyRoleIds }),
  );

  const onLeave = new Map(leavesRepo.listActive(guild.id).map((leave) => [leave.user_id, leave]));
  const result = findInactive(
    clan.map((member) => ({ id: member.id, joinedAt: member.joinedTimestamp ?? member.joinedAt?.getTime?.() ?? null })),
    activityRepo.lastActivityMap(guild.id),
    { days, now, onLeave },
  );

  return { ...result, total: clan.length, days, configured: Boolean(settings.member_role_id || hierarchyRoleIds.length) };
}

/** Dokleja linie dopoki mieszcza sie w budzecie znakow; reszte podsumowuje. */
function fitLines(lines, budget) {
  const shown = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) break;
    shown.push(line);
    used += line.length + 1;
  }
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`*…i ${hidden} ${plural(hidden, 'kolejna osoba', 'kolejne osoby', 'kolejnych osob')}*`);
  return shown.join('\n');
}

function lastSeen(entry) {
  if (entry.lastActiveAt) return `ostatnio ${timestamp(entry.lastActiveAt, 'R')}`;
  return `brak aktywnosci (na serwerze od ${timestamp(entry.joinedAt, 'D')})`;
}

/** Panel wyniku /nieaktywni. */
function buildInactivePanel(result) {
  const { inactive, away, total, days } = result;

  const inactiveLines = inactive.map((entry, index) => `\`${index + 1}.\` <@${entry.id}> — ${lastSeen(entry)}`);
  const awayLines = away.map(
    (entry) => `🏖️ <@${entry.id}> — ${lastSeen(entry)} • urlop do ${timestamp(entry.leave.ends_at, 'D')}`,
  );

  const blocks = [];
  if (inactiveLines.length) blocks.push(`**Nieaktywni (${inactive.length})**\n${fitLines(inactiveLines, 2400)}`);
  if (awayLines.length) blocks.push(`**Na urlopie (${away.length})**\n${fitLines(awayLines, 900)}`);

  const description = !result.configured
    ? 'Brak skonfigurowanej roli czlonka i hierarchii — ustaw je przez `/konfiguracja` lub `/setup`.'
    : inactive.length === 0 && away.length === 0
      ? `Wszyscy czlonkowie klanu (**${total}**) byli aktywni w ciagu ostatnich **${days}** dni. 🎉`
      : `**${inactive.length}** z **${total}** ${plural(total, 'czlonka', 'czlonkow', 'czlonkow')} ` +
        `bez wiadomosci i rozmow glosowych od **${days}** dni.`;

  return panel({
    color: inactive.length > 0 ? COLORS.warning : COLORS.success,
    title: `💤 Nieaktywni czlonkowie — ${days} ${plural(days, 'dzien', 'dni', 'dni')}`,
    description,
    blocks,
    footer: 'Aktywnosc = wiadomosc na serwerze albo czas na kanale glosowym. Nowi czlonkowie sa pomijani.',
  });
}

module.exports = {
  DEFAULT_DAYS,
  isOfficer,
  isClanMember,
  findInactive,
  collectInactive,
  buildInactivePanel,
  fitLines,
};
