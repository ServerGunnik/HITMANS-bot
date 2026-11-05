'use strict';

const { getDb } = require('../index');

/** Ustawienia poziomow trzymamy w cache — czytamy je przy kazdej wiadomosci. */
const settingsCache = new Map();

const ANNOUNCE_MODES = ['same', 'channel', 'off'];

function hydrateSettings(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    keep_previous: Boolean(row.keep_previous),
    multiplier: Number(row.multiplier ?? 1),
  };
}

/** Zwraca ustawienia poziomow serwera (tworzy domyslne przy pierwszym uzyciu). */
function getSettings(guildId) {
  if (settingsCache.has(guildId)) return settingsCache.get(guildId);

  const db = getDb();
  let row = db.prepare('SELECT * FROM level_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare('INSERT INTO level_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, Date.now());
    row = db.prepare('SELECT * FROM level_settings WHERE guild_id = ?').get(guildId);
  }

  const settings = hydrateSettings(row);
  settingsCache.set(guildId, settings);
  return settings;
}

/** Aktualizuje wybrane ustawienia: enabled, announceMode, announceChannelId, multiplier, keepPrevious. */
function updateSettings(guildId, patch) {
  getSettings(guildId);

  const columns = {
    enabled: 'enabled',
    announceMode: 'announce_mode',
    announceChannelId: 'announce_channel_id',
    multiplier: 'multiplier',
    keepPrevious: 'keep_previous',
  };

  const entries = Object.entries(patch).filter(([key, value]) => columns[key] && value !== undefined);
  if (entries.length > 0) {
    const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
    const values = entries.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));
    getDb()
      .prepare(`UPDATE level_settings SET ${assignments}, updated_at = ? WHERE guild_id = ?`)
      .run(...values, Date.now(), guildId);
  }

  settingsCache.delete(guildId);
  return getSettings(guildId);
}

function get(guildId, userId) {
  return getDb().prepare('SELECT * FROM member_levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId) ?? null;
}

function ensureRow(db, guildId, userId, now) {
  db.prepare(
    `INSERT INTO member_levels (guild_id, user_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(guildId, userId, now);
}

/**
 * XP za wiadomosc z cooldownem — sprawdzenie i zapis w jednej transakcji.
 * Zwraca { previousXp, xp } albo null, gdy trwa cooldown.
 */
function awardMessage(guildId, userId, amount, cooldownMs, now = Date.now()) {
  const db = getDb();

  return db.transaction(() => {
    ensureRow(db, guildId, userId, now);
    const row = get(guildId, userId);
    if (row.last_message_xp_at && now - row.last_message_xp_at < cooldownMs) return null;

    db.prepare(
      `UPDATE member_levels
       SET xp = xp + ?, messages = messages + 1, last_message_xp_at = ?, updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
    ).run(amount, now, now, guildId, userId);

    return { previousXp: row.xp, xp: row.xp + amount, level: row.level };
  })();
}

/** XP za minute na kanale glosowym. Zwraca { previousXp, xp, level }. */
function awardVoice(guildId, userId, amount, minutes = 1, now = Date.now()) {
  const db = getDb();

  return db.transaction(() => {
    ensureRow(db, guildId, userId, now);
    const row = get(guildId, userId);
    db.prepare(
      `UPDATE member_levels SET xp = xp + ?, voice_minutes = voice_minutes + ?, updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
    ).run(amount, minutes, now, guildId, userId);
    return { previousXp: row.xp, xp: row.xp + amount, level: row.level };
  })();
}

/** Zapisuje poziom wyliczony z XP. */
function setLevel(guildId, userId, level) {
  getDb().prepare('UPDATE member_levels SET level = ? WHERE guild_id = ? AND user_id = ?').run(level, guildId, userId);
}

/** Pozycja w rankingu XP: { position, total, entry } albo null, gdy brak XP. */
function rankOf(guildId, userId) {
  const db = getDb();
  const entry = get(guildId, userId);
  if (!entry || entry.xp <= 0) return null;

  const above = db
    .prepare('SELECT COUNT(*) AS count FROM member_levels WHERE guild_id = ? AND xp > ?')
    .get(guildId, entry.xp).count;
  const total = db
    .prepare('SELECT COUNT(*) AS count FROM member_levels WHERE guild_id = ? AND xp > 0')
    .get(guildId).count;

  return { position: above + 1, total, entry };
}

/** Ranking XP (malejaco). */
function leaderboard(guildId, { limit = 10, offset = 0 } = {}) {
  return getDb()
    .prepare(
      `SELECT * FROM member_levels WHERE guild_id = ? AND xp > 0
       ORDER BY xp DESC, user_id ASC LIMIT ? OFFSET ?`,
    )
    .all(guildId, limit, offset);
}

function countRanked(guildId) {
  return getDb().prepare('SELECT COUNT(*) AS count FROM member_levels WHERE guild_id = ? AND xp > 0').get(guildId).count;
}

/** Usuwa XP wszystkich czlonkow serwera (testy / reset). */
function resetGuild(guildId) {
  getDb().prepare('DELETE FROM member_levels WHERE guild_id = ?').run(guildId);
}

// ----------------------------------------------------------------------------- nagrody

/** Dodaje (lub podmienia) role nagrody za dany poziom. */
function setReward(guildId, level, roleId) {
  getDb()
    .prepare(
      `INSERT INTO level_rewards (guild_id, level, role_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`,
    )
    .run(guildId, level, roleId, Date.now());
}

function removeReward(guildId, level) {
  return getDb().prepare('DELETE FROM level_rewards WHERE guild_id = ? AND level = ?').run(guildId, level).changes > 0;
}

function listRewards(guildId) {
  return getDb().prepare('SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC').all(guildId);
}

module.exports = {
  ANNOUNCE_MODES,
  getSettings,
  updateSettings,
  get,
  awardMessage,
  awardVoice,
  setLevel,
  rankOf,
  leaderboard,
  countRanked,
  resetGuild,
  setReward,
  removeReward,
  listRewards,
};
