'use strict';

const { getDb } = require('../index');

const STATUSES = ['pending', 'accepted', 'rejected', 'in_progress'];

function getChannel(guildId) {
  return getDb().prepare('SELECT channel_id FROM suggestion_settings WHERE guild_id = ?').get(guildId)?.channel_id ?? null;
}

function setChannel(guildId, channelId) {
  getDb()
    .prepare(
      `INSERT INTO suggestion_settings (guild_id, channel_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at`,
    )
    .run(guildId, channelId ?? null, Date.now());
}

function create({ guildId, channelId, authorId, content }) {
  const info = getDb()
    .prepare('INSERT INTO suggestions (guild_id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, channelId, authorId, content, Date.now());
  return get(info.lastInsertRowid);
}

function get(id) {
  return getDb().prepare('SELECT * FROM suggestions WHERE id = ?').get(id) ?? null;
}

function getForGuild(guildId, id) {
  const found = get(id);
  return found && found.guild_id === guildId ? found : null;
}

function listRecent(guildId, limit = 25) {
  return getDb().prepare('SELECT * FROM suggestions WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
}

function setMessage(id, messageId, threadId = null) {
  getDb().prepare('UPDATE suggestions SET message_id = ?, thread_id = ? WHERE id = ?').run(messageId, threadId, id);
}

/** Usuwa propozycje (np. gdy nie udalo sie jej opublikowac). */
function remove(id) {
  getDb().prepare('DELETE FROM suggestions WHERE id = ?').run(id);
}

function setStatus(id, { status, reason, moderatorId }) {
  if (!STATUSES.includes(status)) throw new Error(`Nieznany status propozycji: ${status}`);
  getDb()
    .prepare('UPDATE suggestions SET status = ?, status_reason = ?, status_by = ?, status_at = ? WHERE id = ?')
    .run(status, reason ?? null, moderatorId ?? null, Date.now(), id);
  return get(id);
}

/**
 * Glos za (1) lub przeciw (-1). Jeden glos na osobe:
 * ten sam przycisk ponownie = wycofanie, drugi przycisk = zmiana glosu.
 * Zwraca 'added' | 'changed' | 'removed'.
 */
function vote(suggestionId, userId, value) {
  if (value !== 1 && value !== -1) throw new Error('Glos musi byc 1 albo -1.');
  const db = getDb();

  return db.transaction(() => {
    const existing = db
      .prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?')
      .get(suggestionId, userId);

    if (existing?.vote === value) {
      db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(suggestionId, userId);
      return 'removed';
    }

    db.prepare(
      `INSERT INTO suggestion_votes (suggestion_id, user_id, vote, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`,
    ).run(suggestionId, userId, value, Date.now());
    return existing ? 'changed' : 'added';
  })();
}

/** Liczba glosow { up, down }. */
function counts(suggestionId) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS up,
              COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM suggestion_votes WHERE suggestion_id = ?`,
    )
    .get(suggestionId);
  return { up: row.up, down: row.down };
}

module.exports = {
  STATUSES,
  getChannel,
  setChannel,
  create,
  get,
  getForGuild,
  listRecent,
  setMessage,
  remove,
  setStatus,
  vote,
  counts,
};
