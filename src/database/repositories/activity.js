'use strict';

const { getDb } = require('../index');

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Inkrementuje licznik wiadomosci uzytkownika oraz dzienny licznik serwera. */
function trackMessage(guildId, userId) {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `INSERT INTO member_activity (guild_id, user_id, messages, last_message_at, first_seen_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET messages = messages + 1, last_message_at = excluded.last_message_at`,
  ).run(guildId, userId, now, now);

  db.prepare(
    `INSERT INTO activity_daily (guild_id, day, messages) VALUES (?, ?, 1)
     ON CONFLICT(guild_id, day) DO UPDATE SET messages = messages + 1`,
  ).run(guildId, today());
}

function getMember(guildId, userId) {
  return getDb()
    .prepare('SELECT * FROM member_activity WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

/** Liczba unikalnych osob, ktore napisaly cokolwiek w ciagu ostatnich N dni. */
function activeMembers(guildId, days) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return getDb()
    .prepare(
      'SELECT COUNT(*) AS count FROM member_activity WHERE guild_id = ? AND last_message_at >= ?',
    )
    .get(guildId, since).count;
}

function totalMessages(guildId) {
  return (
    getDb().prepare('SELECT COALESCE(SUM(messages), 0) AS total FROM member_activity WHERE guild_id = ?')
      .get(guildId).total ?? 0
  );
}

/** Zwraca dzienna liczbe wiadomosci z ostatnich N dni (rosnaco, z zerami). */
function dailyHistory(guildId, days = 7) {
  const rows = getDb()
    .prepare('SELECT day, messages FROM activity_daily WHERE guild_id = ? ORDER BY day DESC LIMIT ?')
    .all(guildId, days);

  const byDay = new Map(rows.map((row) => [row.day, row.messages]));
  const history = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    history.push({ day: date, messages: byDay.get(date) ?? 0 });
  }
  return history;
}

function topMembers(guildId, limit = 5) {
  return getDb()
    .prepare(
      'SELECT user_id, messages FROM member_activity WHERE guild_id = ? ORDER BY messages DESC LIMIT ?',
    )
    .all(guildId, limit);
}

module.exports = { trackMessage, getMember, activeMembers, totalMessages, dailyHistory, topMembers };
