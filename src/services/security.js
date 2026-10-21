'use strict';

const { PermissionFlagsBits } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const modlog = require('../utils/modlog');
const logger = require('../utils/logger');
const { COLORS, panel, V2_FLAGS } = require('../ui/components');
const { humanDuration, plural } = require('../utils/format');

/** Sliding window join timestamps per guild — in-memory. */
const joinBuckets = new Map(); // guildId -> [timestamp, ...]
/** Sliding window destructive actions per (guildId, userId) — in-memory. */
const nukeBuckets = new Map(); // key `${guildId}:${userId}` -> [{ ts, type }, ...]
/** Users already punished for nuke (avoid double-punish). */
const nukePunished = new Map(); // key `${guildId}:${userId}` -> timestamp

const NUKE_ACTION_LABELS = {
  channel_delete: 'usunięcie kanału',
  role_delete: 'usunięcie roli',
  member_ban: 'ban użytkownika',
};

// ─── Anti-raid + min. wiek konta ──────────────────────────────────────────

async function alertOwner(guild, container) {
  try {
    const owner = await guild.fetchOwner();
    await owner
      .send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch(() => {});
  } catch {
    /* ignoruj — brak dostepu do wlasciciela */
  }
}

async function enableLockdown(guild, settings, reason) {
  const until = Date.now() + settings.anti_raid_lockdown_minutes * 60 * 1000;
  guilds.update(guild.id, { anti_raid_lockdown_until: until });
  joinBuckets.delete(guild.id);

  const alert = panel({
    color: COLORS.danger,
    title: '🚨 ANTI-RAID: aktywowano lockdown',
    description: `Wykryto raid na **${guild.name}**.\n${reason}`,
    fields: [
      { name: 'Trwa do', value: `<t:${Math.floor(until / 1000)}:R>`, inline: true },
      { name: 'Akcja', value: 'Nowe konta sa automatycznie wyrzucane', inline: true },
    ],
    footer: 'Aby zdjac lockdown wczesniej: /konfiguracja anti-raid lockdown:false',
  });

  await alertOwner(guild, alert);
  await modlog.logEvent(guild, {
    action: 'anti_raid_lockdown',
    user: guild.client.user,
    moderator: null,
    reason,
  }).catch(() => {});
}

function isLockdownActive(settings) {
  return Boolean(settings.anti_raid_lockdown_until && settings.anti_raid_lockdown_until > Date.now());
}

async function handleMemberJoin(member) {
  const guild = member.guild;
  const settings = guilds.get(guild.id);

  // Min. wiek konta.
  if (settings.min_account_age_days > 0 && !member.user.bot) {
    const ageMs = Date.now() - member.user.createdTimestamp;
    const minMs = settings.min_account_age_days * 24 * 60 * 60 * 1000;
    if (ageMs < minMs) {
      const reason = `Konto młodsze niż ${settings.min_account_age_days} ${plural(settings.min_account_age_days, 'dzien', 'dni', 'dni')}`;
      await member
        .send({
          components: [
            panel({
              color: COLORS.warning,
              title: `❌ Odrzucono dołączenie do ${guild.name}`,
              description: `Twoje konto jest zbyt młode. Wymagane minimum: **${settings.min_account_age_days}** dni. Spróbuj ponownie później.`,
            }),
          ],
          flags: V2_FLAGS,
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
      await member.kick(reason).catch((error) => logger.debug(`Nie kick young account: ${error.message}`));

      await modlog.logEvent(guild, {
        action: 'min_age_kick',
        user: member.user,
        moderator: null,
        reason,
      }).catch(() => {});
      return;
    }
  }

  // Anti-raid.
  if (!settings.anti_raid_enabled || member.user.bot) return;

  // Lockdown aktywny -> wywalamy nowych.
  if (isLockdownActive(settings)) {
    await member
      .send({
        components: [
          panel({
            color: COLORS.danger,
            title: `⛔ Serwer ${guild.name} w trybie lockdown`,
            description: 'Serwer jest tymczasowo zabezpieczony przed raidem. Spróbuj dołączyć później.',
          }),
        ],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    await member.kick('Anti-raid: aktywny lockdown').catch(() => {});
    return;
  }

  // Rejestracja dolaczenia w oknie czasowym.
  const now = Date.now();
  const windowMs = settings.anti_raid_window_seconds * 1000;
  const bucket = (joinBuckets.get(guild.id) ?? []).filter((ts) => now - ts < windowMs);
  bucket.push(now);
  joinBuckets.set(guild.id, bucket);

  if (bucket.length >= settings.anti_raid_threshold) {
    await enableLockdown(
      guild,
      settings,
      `${bucket.length} dolaczen w ostatnich ${settings.anti_raid_window_seconds} sekundach (prog: ${settings.anti_raid_threshold}).`,
    );
    // Aktualne dolaczenie tez wywalamy.
    await member.kick('Anti-raid: masowe dolaczenia').catch(() => {});
  }
}

// ─── Anti-nuke ─────────────────────────────────────────────────────────────

function isWhitelisted(settings, guild, userId) {
  if (userId === guild.ownerId) return true;
  if (userId === guild.client.user.id) return true;
  return settings.anti_nuke_whitelist.includes(userId);
}

async function punishNuker(guild, executor, actions) {
  const key = `${guild.id}:${executor.id}`;
  if (nukePunished.has(key)) return;
  nukePunished.set(key, Date.now());
  setTimeout(() => nukePunished.delete(key), 5 * 60 * 1000).unref?.();

  const member = await guild.members.fetch(executor.id).catch(() => null);
  const actionSummary = actions
    .map((a) => NUKE_ACTION_LABELS[a.type] ?? a.type)
    .join(', ');

  let punishmentText = 'wysłano tylko alert (użytkownik nie jest członkiem serwera)';

  if (member) {
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
    if (isAdmin) {
      punishmentText = '**⚠️ SPRAWCA JEST ADMINEM — nie mogę go timeoutować.** Sprawdź audit log i zdejmij mu role ręcznie NATYCHMIAST.';
    } else if (member.moderatable) {
      try {
        await member.timeout(24 * 60 * 60 * 1000, `Anti-nuke: ${actionSummary}`);
        punishmentText = 'timeout 24h';
      } catch (error) {
        punishmentText = `nie udało się timeoutować: ${error.message}`;
      }
    } else {
      punishmentText = 'nie mogę timeoutować (rola bota niżej w hierarchii)';
    }
  }

  const alert = panel({
    color: COLORS.danger,
    title: '🚨 ANTI-NUKE: wykryto podejrzaną aktywność',
    description: `Sprawca: <@${executor.id}> \`${executor.tag}\` (${executor.id})`,
    fields: [
      { name: 'Wykryte akcje', value: actions.map((a) => `• ${NUKE_ACTION_LABELS[a.type]}`).join('\n') },
      {
        name: 'Okno',
        value: `${actions.length} akcji w ~${humanDuration(actions[actions.length - 1].ts - actions[0].ts) || '< 1s'}`,
        inline: true,
      },
      { name: 'Kara', value: punishmentText, inline: false },
    ],
    footer: `Serwer: ${guild.name}`,
  });

  await alertOwner(guild, alert);
  await modlog
    .logEvent(guild, {
      action: 'anti_nuke_trigger',
      user: executor,
      moderator: null,
      reason: `${actions.length}x ${actionSummary}`,
    })
    .catch(() => {});
}

/** Rejestruje destrukcyjna akcje wykonana przez `executor`. Wywolywane z eventow. */
async function recordNukeAction(guild, executor, actionType) {
  if (!executor) return;
  const settings = guilds.get(guild.id);
  if (!settings.anti_nuke_enabled) return;
  if (isWhitelisted(settings, guild, executor.id)) return;

  const key = `${guild.id}:${executor.id}`;
  const now = Date.now();
  const windowMs = settings.anti_nuke_window_seconds * 1000;

  const bucket = (nukeBuckets.get(key) ?? []).filter((entry) => now - entry.ts < windowMs);
  bucket.push({ ts: now, type: actionType });
  nukeBuckets.set(key, bucket);

  if (bucket.length >= settings.anti_nuke_threshold) {
    nukeBuckets.delete(key);
    await punishNuker(guild, executor, bucket);
  }
}

// ─── Utrzymanie: sprzatanie starych wpisow ────────────────────────────────

function cleanup() {
  const now = Date.now();
  for (const [guildId, timestamps] of joinBuckets) {
    const fresh = timestamps.filter((ts) => now - ts < 5 * 60 * 1000);
    if (fresh.length === 0) joinBuckets.delete(guildId);
    else joinBuckets.set(guildId, fresh);
  }
  for (const [key, entries] of nukeBuckets) {
    const fresh = entries.filter((entry) => now - entry.ts < 10 * 60 * 1000);
    if (fresh.length === 0) nukeBuckets.delete(key);
    else nukeBuckets.set(key, fresh);
  }
}

module.exports = {
  handleMemberJoin,
  recordNukeAction,
  isLockdownActive,
  cleanup,
};
