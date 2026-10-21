'use strict';

const { getDb } = require('../index');

function hydrate(row) {
  if (!row) return null;
  let form = {};
  try {
    form = JSON.parse(row.form_data);
  } catch {
    form = {};
  }
  return { ...row, form };
}

function create({ guildId, userId, userTag, form }) {
  const info = getDb()
    .prepare(
      `INSERT INTO conquest_tickets (guild_id, user_id, user_tag, form_data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, userTag ?? null, JSON.stringify(form), Date.now());
  return get(Number(info.lastInsertRowid));
}

function get(id) {
  return hydrate(getDb().prepare('SELECT * FROM conquest_tickets WHERE id = ?').get(id));
}

function getByChannel(channelId) {
  return hydrate(getDb().prepare('SELECT * FROM conquest_tickets WHERE channel_id = ?').get(channelId));
}

function setChannel(id, channelId) {
  getDb().prepare('UPDATE conquest_tickets SET channel_id = ? WHERE id = ?').run(channelId, id);
}

function findOpenByUser(guildId, userId) {
  return hydrate(
    getDb()
      .prepare(
        `SELECT * FROM conquest_tickets
         WHERE guild_id = ? AND user_id = ? AND status = 'open'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(guildId, userId),
  );
}

function markClosed(id, closedBy) {
  getDb()
    .prepare('UPDATE conquest_tickets SET status = ?, closed_at = ?, closed_by = ? WHERE id = ?')
    .run('closed', Date.now(), closedBy ?? null, id);
}

module.exports = { create, get, getByChannel, setChannel, findOpenByUser, markClosed };
