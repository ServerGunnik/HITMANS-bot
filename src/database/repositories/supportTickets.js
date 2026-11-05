'use strict';

const { getDb } = require('../index');

/** Ustawienia ticketow pomocy (kategoria, rola obslugi, kanal logow). */
function getSettings(guildId) {
  return (
    getDb().prepare('SELECT * FROM support_ticket_settings WHERE guild_id = ?').get(guildId) ?? {
      guild_id: guildId,
      category_id: null,
      staff_role_id: null,
      log_channel_id: null,
    }
  );
}

function updateSettings(guildId, patch) {
  const next = { ...getSettings(guildId), ...patch };
  getDb()
    .prepare(
      `INSERT INTO support_ticket_settings (guild_id, category_id, staff_role_id, log_channel_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET
         category_id = excluded.category_id, staff_role_id = excluded.staff_role_id, log_channel_id = excluded.log_channel_id`,
    )
    .run(guildId, next.category_id ?? null, next.staff_role_id ?? null, next.log_channel_id ?? null);
  return getSettings(guildId);
}

function create({ guildId, userId, userTag, category, description }) {
  const info = getDb()
    .prepare(
      `INSERT INTO support_tickets (guild_id, user_id, user_tag, category, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, userTag ?? null, category, description, Date.now());
  return get(Number(info.lastInsertRowid));
}

function get(id) {
  return getDb().prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) ?? null;
}

function getByChannel(channelId) {
  return getDb().prepare('SELECT * FROM support_tickets WHERE channel_id = ?').get(channelId) ?? null;
}

function setChannel(id, channelId) {
  getDb().prepare('UPDATE support_tickets SET channel_id = ? WHERE id = ?').run(channelId, id);
}

/** Otwarty ticket uzytkownika w danej kategorii (limit: jeden na kategorie). */
function findOpen(guildId, userId, category) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM support_tickets
         WHERE guild_id = ? AND user_id = ? AND category = ? AND status = 'open'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(guildId, userId, category) ?? null
  );
}

function claim(id, staffId) {
  getDb().prepare('UPDATE support_tickets SET claimed_by = ? WHERE id = ?').run(staffId, id);
  return get(id);
}

/** Zamyka ticket — zwraca false, jesli byl juz zamkniety (ochrona przed podwojnym zamknieciem). */
function markClosed(id, closedBy, reason = null) {
  return (
    getDb()
      .prepare(
        `UPDATE support_tickets SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ?
         WHERE id = ? AND status = 'open'`,
      )
      .run(Date.now(), closedBy ?? null, reason ?? null, id).changes > 0
  );
}

module.exports = { getSettings, updateSettings, create, get, getByChannel, setChannel, findOpen, claim, markClosed };
