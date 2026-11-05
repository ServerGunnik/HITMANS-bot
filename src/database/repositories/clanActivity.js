'use strict';

const { getDb } = require('../index');

/** Dzien (UTC) w formacie YYYY-MM-DD — zgodnie z activity_daily. */
function dayOf(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Ustawienia ─────────────────────────────────────────────────────────────

const SETTING_COLUMNS = new Set([
  'leave_role_id',
  'officer_channel_id',
  'report_channel_id',
  'report_last_week',
  'inactive_days',
]);

/** Zwraca ustawienia aktywnosci serwera (z wartosciami domyslnymi). */
function getSettings(guildId) {
  const row = getDb().prepare('SELECT * FROM activity_settings WHERE guild_id = ?').get(guildId);
  return (
    row ?? {
      guild_id: guildId,
      leave_role_id: null,
      officer_channel_id: null,
      report_channel_id: null,
      report_last_week: null,
      inactive_days: 14,
      updated_at: null,
    }
  );
}

/** Zapisuje wybrane ustawienia (nieznane kolumny sa ignorowane). */
function updateSettings(guildId, patch) {
  const entries = Object.entries(patch).filter(([key]) => SETTING_COLUMNS.has(key));
  const db = getDb();
  const now = Date.now();

  db.prepare('INSERT OR IGNORE INTO activity_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, now);
  if (entries.length > 0) {
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE activity_settings SET ${assignments}, updated_at = ? WHERE guild_id = ?`).run(
      ...entries.map(([, value]) => value ?? null),
      now,
      guildId,
    );
  }
  return getSettings(guildId);
}

/** Serwery z wlaczonym raportem tygodniowym. */
function listReportGuilds() {
  return getDb().prepare('SELECT * FROM activity_settings WHERE report_channel_id IS NOT NULL').all();
}

/**
 * Atomowo rezerwuje wysylke raportu dla danego tygodnia.
 * Zwraca true tylko raz dla danej pary (serwer, tydzien) — chroni przed podwojnym raportem.
 */
function claimReportWeek(guildId, weekKey) {
  const result = getDb()
    .prepare(
      `UPDATE activity_settings SET report_last_week = ?, updated_at = ?
       WHERE guild_id = ? AND (report_last_week IS NULL OR report_last_week <> ?)`,
    )
    .run(weekKey, Date.now(), guildId, weekKey);
  return result.changes > 0;
}

// ─── Sledzenie aktywnosci ───────────────────────────────────────────────────

/** Dolicza wiadomosc do dziennej aktywnosci osoby. */
function trackMessageDay(guildId, userId, now = Date.now()) {
  getDb()
    .prepare(
      `INSERT INTO member_activity_days (guild_id, user_id, day, messages) VALUES (?, ?, ?, 1)
       ON CONFLICT(guild_id, user_id, day) DO UPDATE SET messages = messages + 1`,
    )
    .run(guildId, userId, dayOf(now));
}

/** Dolicza czas na kanale glosowym i odswieza `last_voice_at`. */
function addVoiceTime(guildId, userId, seconds, now = Date.now()) {
  const db = getDb();
  const value = Math.max(0, Math.floor(seconds));

  db.transaction(() => {
    db.prepare(
      `INSERT INTO member_activity (guild_id, user_id, messages, first_seen_at, last_voice_at, voice_seconds)
       VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT(guild_id, user_id)
       DO UPDATE SET last_voice_at = excluded.last_voice_at, voice_seconds = voice_seconds + excluded.voice_seconds`,
    ).run(guildId, userId, now, now, value);

    if (value > 0) {
      db.prepare(
        `INSERT INTO member_activity_days (guild_id, user_id, day, voice_seconds) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, day) DO UPDATE SET voice_seconds = voice_seconds + excluded.voice_seconds`,
      ).run(guildId, userId, dayOf(now), value);
    }
  })();
}

/** Zapisuje dolaczenie / wyjscie z serwera. */
function recordMemberEvent(guildId, userId, type, now = Date.now()) {
  getDb()
    .prepare('INSERT INTO member_events (guild_id, user_id, type, created_at) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, type, now);
}

/**
 * Mapa userId -> ostatnia aktywnosc (max z wiadomosci i kanalu glosowego).
 * Zwraca { lastMessageAt, lastVoiceAt, lastActiveAt }.
 */
function lastActivityMap(guildId) {
  const rows = getDb()
    .prepare('SELECT user_id, last_message_at, last_voice_at FROM member_activity WHERE guild_id = ?')
    .all(guildId);

  const map = new Map();
  for (const row of rows) {
    const lastActiveAt = Math.max(row.last_message_at ?? 0, row.last_voice_at ?? 0) || null;
    map.set(row.user_id, {
      lastMessageAt: row.last_message_at ?? null,
      lastVoiceAt: row.last_voice_at ?? null,
      lastActiveAt,
    });
  }
  return map;
}

// ─── Dane do raportu ────────────────────────────────────────────────────────

function countMemberEvents(guildId, type, since, until) {
  return getDb()
    .prepare(
      'SELECT COUNT(*) AS count FROM member_events WHERE guild_id = ? AND type = ? AND created_at >= ? AND created_at < ?',
    )
    .get(guildId, type, since, until).count;
}

function applicationStats(guildId, since, until) {
  const db = getDb();
  const decided = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM applications
       WHERE guild_id = ? AND decided_at >= ? AND decided_at < ? GROUP BY status`,
    )
    .all(guildId, since, until);
  const submitted = db
    .prepare('SELECT COUNT(*) AS count FROM applications WHERE guild_id = ? AND created_at >= ? AND created_at < ?')
    .get(guildId, since, until).count;

  const byStatus = Object.fromEntries(decided.map((row) => [row.status, row.count]));
  return { submitted, accepted: byStatus.accepted ?? 0, rejected: byStatus.rejected ?? 0 };
}

/** Najaktywniejsi w przedziale dni [sinceDay, untilDay). */
function topByDays(guildId, column, sinceDay, untilDay, limit = 5) {
  const field = column === 'voice_seconds' ? 'voice_seconds' : 'messages';
  return getDb()
    .prepare(
      `SELECT user_id, SUM(${field}) AS total FROM member_activity_days
       WHERE guild_id = ? AND day >= ? AND day < ?
       GROUP BY user_id HAVING total > 0 ORDER BY total DESC, user_id ASC LIMIT ?`,
    )
    .all(guildId, sinceDay, untilDay, limit);
}

function totalsByDays(guildId, sinceDay, untilDay) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voiceSeconds,
              COUNT(DISTINCT user_id) AS activeUsers
       FROM member_activity_days WHERE guild_id = ? AND day >= ? AND day < ?`,
    )
    .get(guildId, sinceDay, untilDay);
  return row;
}

function moderationStats(guildId, since, until) {
  const rows = getDb()
    .prepare(
      `SELECT action, COUNT(*) AS count FROM mod_cases
       WHERE guild_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY action ORDER BY count DESC, action ASC`,
    )
    .all(guildId, since, until);
  return { total: rows.reduce((sum, row) => sum + row.count, 0), byAction: rows };
}

/** Podsumowanie ekonomii: punkty wygenerowane przez system, przelewy, zakupy, najlepszy zarabiajacy. */
function economyStats(guildId, since, until) {
  const db = getDb();
  const base = 'FROM economy_transactions WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND reverted = 0';

  const earned = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total ${base}
       AND from_user_id IS NULL AND to_user_id IS NOT NULL AND type NOT IN ('admin_add', 'revert')`,
    )
    .get(guildId, since, until).total;
  const transfers = db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total ${base} AND type = 'transfer'`)
    .get(guildId, since, until);
  const purchases = db
    .prepare(`SELECT COUNT(*) AS count ${base} AND type = 'shop_purchase'`)
    .get(guildId, since, until).count;
  const topEarner = db
    .prepare(
      `SELECT to_user_id AS user_id, SUM(amount) AS total ${base}
       AND from_user_id IS NULL AND to_user_id IS NOT NULL AND type NOT IN ('admin_add', 'revert')
       GROUP BY to_user_id ORDER BY total DESC, to_user_id ASC LIMIT 1`,
    )
    .get(guildId, since, until);

  return {
    earned,
    transfers: transfers.count,
    transferVolume: transfers.total,
    purchases,
    topEarner: topEarner ?? null,
  };
}

module.exports = {
  dayOf,
  getSettings,
  updateSettings,
  listReportGuilds,
  claimReportWeek,
  trackMessageDay,
  addVoiceTime,
  recordMemberEvent,
  lastActivityMap,
  countMemberEvents,
  applicationStats,
  topByDays,
  totalsByDays,
  moderationStats,
  economyStats,
};
