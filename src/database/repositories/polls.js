'use strict';

const { getDb } = require('../index');

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    multi: Boolean(row.multi),
    anonymous: Boolean(row.anonymous),
    closed: Boolean(row.closed),
  };
}

function create({ guildId, channelId, authorId, question, options, multi, anonymous, endsAt }) {
  const db = getDb();
  const now = Date.now();

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO polls
         (guild_id, channel_id, author_id, question, multi, anonymous, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, channelId, authorId, question, multi ? 1 : 0, anonymous ? 1 : 0, endsAt ?? null, now);

    const pollId = info.lastInsertRowid;
    const insertOption = db.prepare(
      'INSERT INTO poll_options (poll_id, position, label) VALUES (?, ?, ?)',
    );
    options.forEach((label, index) => insertOption.run(pollId, index, label));
    return pollId;
  });

  return get(create());
}

function get(id) {
  const db = getDb();
  const poll = hydrate(db.prepare('SELECT * FROM polls WHERE id = ?').get(id));
  if (!poll) return null;
  poll.options = db
    .prepare('SELECT id, position, label FROM poll_options WHERE poll_id = ? ORDER BY position ASC')
    .all(id);
  return poll;
}

function setMessage(id, messageId) {
  getDb().prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, id);
}

function close(id) {
  getDb().prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(id);
}

function dueForClosing(now = Date.now()) {
  return getDb()
    .prepare('SELECT id FROM polls WHERE closed = 0 AND ends_at IS NOT NULL AND ends_at <= ?')
    .all(now)
    .map((row) => row.id);
}

/** Toguje glos: dodaje jesli brak, usuwa jesli byl. Dla ankiety pojedynczej — usuwa poprzednie. */
function toggleVote({ pollId, optionId, userId, multi }) {
  const db = getDb();
  const now = Date.now();

  const toggle = db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?')
      .get(pollId, optionId, userId);

    if (existing) {
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?').run(
        pollId,
        optionId,
        userId,
      );
      return 'removed';
    }

    if (!multi) {
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
    }
    db.prepare(
      'INSERT INTO poll_votes (poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)',
    ).run(pollId, optionId, userId, now);
    return 'added';
  });

  return toggle();
}

/** Liczba glosow per opcja i lacznie unikalnych glosujacych. */
function tally(pollId) {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT o.id, o.position, o.label,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
       FROM poll_options o WHERE o.poll_id = ? ORDER BY o.position ASC`,
    )
    .all(pollId);

  const uniqueVoters = db
    .prepare('SELECT COUNT(DISTINCT user_id) AS total FROM poll_votes WHERE poll_id = ?')
    .get(pollId).total;

  return { options: counts, uniqueVoters };
}

/** Lista userId ktorzy oddali glos na dana opcje (do publicznych ankiet). */
function votersFor(optionId) {
  return getDb()
    .prepare('SELECT user_id FROM poll_votes WHERE option_id = ? ORDER BY created_at ASC')
    .all(optionId)
    .map((row) => row.user_id);
}

module.exports = { create, get, setMessage, close, dueForClosing, toggleVote, tally, votersFor };
