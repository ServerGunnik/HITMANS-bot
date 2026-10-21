'use strict';

const { getDb } = require('../index');

function hydrate(row) {
  if (!row) return null;
  let winners = [];
  if (row.winner_ids) {
    try {
      winners = JSON.parse(row.winner_ids);
    } catch {
      winners = [];
    }
  }
  return { ...row, closed: Boolean(row.closed), winner_ids: winners };
}

function create({ guildId, channelId, authorId, prize, winnersCount, requiredRoleId, endsAt }) {
  const db = getDb();
  const now = Date.now();

  const info = db
    .prepare(
      `INSERT INTO giveaways
       (guild_id, channel_id, author_id, prize, winners_count, required_role_id, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, channelId, authorId, prize, winnersCount, requiredRoleId ?? null, endsAt, now);

  return get(info.lastInsertRowid);
}

function get(id) {
  return hydrate(getDb().prepare('SELECT * FROM giveaways WHERE id = ?').get(id));
}

function setMessage(id, messageId) {
  getDb().prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
}

function markClosed(id, winnerIds) {
  getDb()
    .prepare('UPDATE giveaways SET closed = 1, winner_ids = ? WHERE id = ?')
    .run(JSON.stringify(winnerIds ?? []), id);
}

function dueForClosing(now = Date.now()) {
  return getDb()
    .prepare('SELECT id FROM giveaways WHERE closed = 0 AND ends_at <= ?')
    .all(now)
    .map((row) => row.id);
}

function join(giveawayId, userId) {
  try {
    getDb()
      .prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(giveawayId, userId, Date.now());
    return 'joined';
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return 'already';
    throw error;
  }
}

function leave(giveawayId, userId) {
  const info = getDb()
    .prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
    .run(giveawayId, userId);
  return info.changes > 0 ? 'left' : 'not_joined';
}

function hasEntry(giveawayId, userId) {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
      .get(giveawayId, userId),
  );
}

function entriesCount(giveawayId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?')
    .get(giveawayId).total;
}

function entries(giveawayId) {
  return getDb()
    .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?')
    .all(giveawayId)
    .map((row) => row.user_id);
}

module.exports = {
  create,
  get,
  setMessage,
  markClosed,
  dueForClosing,
  join,
  leave,
  hasEntry,
  entriesCount,
  entries,
};
