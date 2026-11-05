'use strict';

const { getDb } = require('../index');

function create({ guildId, channelId, userId, content, remindAt }, now = Date.now()) {
  const info = getDb()
    .prepare(
      `INSERT INTO reminders (guild_id, channel_id, user_id, content, remind_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, channelId, userId, content, remindAt, now);
  return get(info.lastInsertRowid);
}

function get(id) {
  return getDb().prepare('SELECT * FROM reminders WHERE id = ?').get(id) ?? null;
}

/** Aktywne przypomnienia uzytkownika na serwerze, od najblizszego. */
function listForUser(guildId, userId) {
  return getDb()
    .prepare('SELECT * FROM reminders WHERE guild_id = ? AND user_id = ? ORDER BY remind_at ASC, id ASC')
    .all(guildId, userId);
}

function countForUser(guildId, userId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS total FROM reminders WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId).total;
}

/** Usuwa przypomnienie nalezace do uzytkownika. Zwraca true, gdy cos usunieto. */
function removeForUser(guildId, userId, id) {
  return (
    getDb().prepare('DELETE FROM reminders WHERE guild_id = ? AND user_id = ? AND id = ?').run(guildId, userId, id)
      .changes > 0
  );
}

/** Usuwa przypomnienie po dostarczeniu. */
function remove(id) {
  getDb().prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

/** Przypomnienia do dostarczenia (termin minal). */
function due(now = Date.now(), limit = 50) {
  return getDb()
    .prepare('SELECT * FROM reminders WHERE remind_at <= ? ORDER BY remind_at ASC LIMIT ?')
    .all(now, limit);
}

module.exports = { create, get, listForUser, countForUser, removeForUser, remove, due };
