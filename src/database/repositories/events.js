'use strict';

const { getDb } = require('../index');

const REMINDER_OFFSETS = { 30: 30 * 60 * 1000, 5: 5 * 60 * 1000 };
const RSVP_STATUSES = ['yes', 'maybe', 'no'];

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    dm_reminders: Boolean(row.dm_reminders),
    reminded_30: Boolean(row.reminded_30),
    reminded_5: Boolean(row.reminded_5),
  };
}

/** Przypomnienia, na ktore jest juz za pozno, oznaczamy z gory jako wyslane. */
function reminderFlags(startsAt, now = Date.now()) {
  return {
    reminded_30: startsAt - now <= REMINDER_OFFSETS[30] ? 1 : 0,
    reminded_5: startsAt - now <= REMINDER_OFFSETS[5] ? 1 : 0,
  };
}

function create({ guildId, channelId, authorId, title, description, startsAt, pingRoleId, dmReminders }, now = Date.now()) {
  const flags = reminderFlags(startsAt, now);
  const info = getDb()
    .prepare(
      `INSERT INTO events
       (guild_id, channel_id, author_id, title, description, starts_at, ping_role_id, dm_reminders,
        reminded_30, reminded_5, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guildId,
      channelId,
      authorId,
      title,
      description ?? null,
      startsAt,
      pingRoleId ?? null,
      dmReminders ? 1 : 0,
      flags.reminded_30,
      flags.reminded_5,
      now,
      now,
    );
  return get(info.lastInsertRowid);
}

function get(id) {
  return hydrate(getDb().prepare('SELECT * FROM events WHERE id = ?').get(id));
}

/** Wydarzenie z danego serwera albo null. */
function getForGuild(guildId, id) {
  const event = get(id);
  return event && event.guild_id === guildId ? event : null;
}

function setMessage(id, messageId) {
  getDb().prepare('UPDATE events SET message_id = ? WHERE id = ?').run(messageId, id);
}

const EDITABLE = ['title', 'description', 'starts_at', 'ping_role_id', 'dm_reminders'];

/** Aktualizuje dozwolone pola. Zmiana terminu resetuje przypomnienia (i ponownie otwiera zapisy). */
function update(id, fields, now = Date.now()) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!EDITABLE.includes(key) || value === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }

  if (fields.starts_at !== undefined) {
    const flags = reminderFlags(fields.starts_at, now);
    sets.push('reminded_30 = ?', 'reminded_5 = ?');
    values.push(flags.reminded_30, flags.reminded_5);
    if (fields.starts_at > now) sets.push("status = CASE WHEN status = 'started' THEN 'scheduled' ELSE status END");
  }

  if (sets.length === 0) return get(id);
  sets.push('updated_at = ?');
  values.push(now);
  getDb().prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return get(id);
}

function setStatus(id, status) {
  getDb().prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  return get(id);
}

/** Nadchodzace (zaplanowane) wydarzenia serwera, od najblizszego. */
function listUpcoming(guildId, limit = 10) {
  return getDb()
    .prepare("SELECT * FROM events WHERE guild_id = ? AND status = 'scheduled' ORDER BY starts_at ASC LIMIT ?")
    .all(guildId, limit)
    .map(hydrate);
}

/** Ostatnio rozpoczete wydarzenia (np. do oznaczania obecnosci). */
function listRecent(guildId, limit = 5) {
  return getDb()
    .prepare("SELECT * FROM events WHERE guild_id = ? AND status = 'started' ORDER BY starts_at DESC LIMIT ?")
    .all(guildId, limit)
    .map(hydrate);
}

/**
 * Zapis na wydarzenie. Klikniecie tego samego statusu ponownie wypisuje.
 * Zwraca 'added' | 'changed' | 'removed'.
 */
function setRsvp(eventId, userId, status, now = Date.now()) {
  if (!RSVP_STATUSES.includes(status)) throw new Error(`Nieznany status zapisu: ${status}`);
  const db = getDb();

  return db.transaction(() => {
    const existing = db.prepare('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(eventId, userId);
    if (existing?.status === status) {
      db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(eventId, userId);
      return 'removed';
    }
    db.prepare(
      `INSERT INTO event_rsvps (event_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    ).run(eventId, userId, status, now);
    return existing ? 'changed' : 'added';
  })();
}

/** Zapisani pogrupowani po statusie: { yes: [userId], maybe: [...], no: [...] }. */
function rsvps(eventId) {
  const grouped = { yes: [], maybe: [], no: [] };
  const rows = getDb()
    .prepare('SELECT user_id, status FROM event_rsvps WHERE event_id = ? ORDER BY updated_at ASC, rowid ASC')
    .all(eventId);
  for (const row of rows) grouped[row.status]?.push(row.user_id);
  return grouped;
}

/** Wydarzenia, dla ktorych nadszedl czas przypomnienia (30 lub 5 minut). */
function dueReminders(minutes, now = Date.now()) {
  const column = minutes === 30 ? 'reminded_30' : 'reminded_5';
  return getDb()
    .prepare(`SELECT * FROM events WHERE status = 'scheduled' AND ${column} = 0 AND starts_at - ? <= ?`)
    .all(REMINDER_OFFSETS[minutes], now)
    .map(hydrate);
}

function markReminded(id, minutes) {
  const column = minutes === 30 ? 'reminded_30' : 'reminded_5';
  getDb().prepare(`UPDATE events SET ${column} = 1 WHERE id = ?`).run(id);
}

/** Zaplanowane wydarzenia, ktore juz sie rozpoczely (do zamkniecia zapisow). */
function dueForStart(now = Date.now()) {
  return getDb()
    .prepare("SELECT id FROM events WHERE status = 'scheduled' AND starts_at <= ?")
    .all(now)
    .map((row) => row.id);
}

/** Zapisuje obecnosc (present=true) lub nieobecnosc dla listy osob. */
function setAttendance(eventId, userIds, present, markedBy, now = Date.now()) {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO event_attendance (event_id, user_id, present, marked_by, marked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET present = excluded.present,
       marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
  );
  db.transaction(() => {
    for (const userId of userIds) statement.run(eventId, userId, present ? 1 : 0, markedBy, now);
  })();
}

/** Obecnosc na wydarzeniu: { present: [userId], absent: [userId] }. */
function attendance(eventId) {
  const result = { present: [], absent: [] };
  const rows = getDb()
    .prepare('SELECT user_id, present FROM event_attendance WHERE event_id = ? ORDER BY marked_at ASC, rowid ASC')
    .all(eventId);
  for (const row of rows) (row.present ? result.present : result.absent).push(row.user_id);
  return result;
}

/** Ile razy czlonek byl obecny / nieobecny na wydarzeniach serwera. */
function memberAttendance(guildId, userId) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(a.present), 0) AS present, COUNT(*) - COALESCE(SUM(a.present), 0) AS absent
       FROM event_attendance a JOIN events e ON e.id = a.event_id
       WHERE e.guild_id = ? AND a.user_id = ?`,
    )
    .get(guildId, userId);
  return { present: row.present, absent: row.absent };
}

module.exports = {
  REMINDER_OFFSETS,
  RSVP_STATUSES,
  create,
  get,
  getForGuild,
  setMessage,
  update,
  setStatus,
  listUpcoming,
  listRecent,
  setRsvp,
  rsvps,
  dueReminders,
  markReminded,
  dueForStart,
  setAttendance,
  attendance,
  memberAttendance,
};
