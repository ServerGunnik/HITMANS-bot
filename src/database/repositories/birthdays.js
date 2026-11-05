'use strict';

const { getDb } = require('../index');

/** Zapisuje (lub nadpisuje) date urodzin uzytkownika. */
function set(guildId, userId, { day, month, year = null }) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO birthdays (guild_id, user_id, day, month, year, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         day = excluded.day, month = excluded.month, year = excluded.year, updated_at = excluded.updated_at`,
    )
    .run(guildId, userId, day, month, year ?? null, now, now);
  return get(guildId, userId);
}

function get(guildId, userId) {
  return getDb().prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?').get(guildId, userId) ?? null;
}

/** Usuwa wpis — zwraca true, jesli cos usunieto. */
function remove(guildId, userId) {
  return getDb().prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
}

function listByGuild(guildId) {
  return getDb().prepare('SELECT * FROM birthdays WHERE guild_id = ? ORDER BY month, day').all(guildId);
}

/** Ustawienia urodzin serwera (kanal, rola, data ostatnich zyczen). */
function getSettings(guildId) {
  return (
    getDb().prepare('SELECT * FROM birthday_settings WHERE guild_id = ?').get(guildId) ?? {
      guild_id: guildId,
      channel_id: null,
      role_id: null,
      last_posted_date: null,
    }
  );
}

function updateSettings(guildId, patch) {
  const next = { ...getSettings(guildId), ...patch };
  getDb()
    .prepare(
      `INSERT INTO birthday_settings (guild_id, channel_id, role_id, last_posted_date)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET
         channel_id = excluded.channel_id, role_id = excluded.role_id, last_posted_date = excluded.last_posted_date`,
    )
    .run(guildId, next.channel_id ?? null, next.role_id ?? null, next.last_posted_date ?? null);
  return getSettings(guildId);
}

/** Serwery z ustawionym kanalem zyczen. */
function listConfigured() {
  return getDb().prepare('SELECT * FROM birthday_settings WHERE channel_id IS NOT NULL').all();
}

/**
 * Atomowo oznacza dzien jako obsluzony. Zwraca true tylko dla pierwszego
 * wywolania danego dnia — dzieki temu restart nie wysle zyczen drugi raz.
 */
function claimDay(guildId, date) {
  return (
    getDb()
      .prepare(
        `UPDATE birthday_settings SET last_posted_date = ?
         WHERE guild_id = ? AND (last_posted_date IS NULL OR last_posted_date <> ?)`,
      )
      .run(date, guildId, date).changes > 0
  );
}

function addRoleGrant(guildId, userId, roleId, date) {
  getDb()
    .prepare(
      `INSERT INTO birthday_role_grants (guild_id, user_id, role_id, granted_date) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id, role_id) DO UPDATE SET granted_date = excluded.granted_date`,
    )
    .run(guildId, userId, roleId, date);
}

/** Role nadane innego dnia niz `date` — do zdjecia. */
function expiredRoleGrants(date) {
  return getDb().prepare('SELECT * FROM birthday_role_grants WHERE granted_date <> ?').all(date);
}

function removeRoleGrant(guildId, userId, roleId) {
  getDb()
    .prepare('DELETE FROM birthday_role_grants WHERE guild_id = ? AND user_id = ? AND role_id = ?')
    .run(guildId, userId, roleId);
}

module.exports = {
  set,
  get,
  remove,
  listByGuild,
  getSettings,
  updateSettings,
  listConfigured,
  claimDay,
  addRoleGrant,
  expiredRoleGrants,
  removeRoleGrant,
};
