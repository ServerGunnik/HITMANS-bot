'use strict';

const { getDb } = require('../index');

const MAX_LENGTH = 1000;

function add({ guildId, userId, authorId, content, now = Date.now() }) {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO officer_notes (guild_id, user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, userId, authorId, String(content).slice(0, MAX_LENGTH), now);
  return get(guildId, result.lastInsertRowid);
}

function get(guildId, id) {
  return getDb().prepare('SELECT * FROM officer_notes WHERE guild_id = ? AND id = ?').get(guildId, id);
}

/** Notatki o osobie, najnowsze pierwsze. */
function list(guildId, userId, { limit = 25 } = {}) {
  return getDb()
    .prepare('SELECT * FROM officer_notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, userId, limit);
}

function count(guildId, userId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM officer_notes WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId).count;
}

/** Usuwa notatke (tylko z danego serwera). Zwraca usuniety wpis albo null. */
function remove(guildId, id) {
  const note = get(guildId, id);
  if (!note) return null;
  getDb().prepare('DELETE FROM officer_notes WHERE guild_id = ? AND id = ?').run(guildId, id);
  return note;
}

module.exports = { MAX_LENGTH, add, get, list, count, remove };
