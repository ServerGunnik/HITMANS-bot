'use strict';

const { getDb } = require('../index');

/**
 * Konfiguracja logow zdarzen serwera.
 * Ustawienia sa czytane przy kazdym zdarzeniu (takze przy kazdej wiadomosci),
 * dlatego trzymamy je w cache unewaznianym przy zapisie.
 */

const CATEGORIES = ['messages', 'members', 'roles', 'voice', 'channels', 'server', 'economy'];

const settingsCache = new Map(); // guildId -> { category: { channelId, enabled } }
const ignoreCache = new Map(); // guildId -> { channel: Set, role: Set, user: Set }

function loadSettings(guildId) {
  if (settingsCache.has(guildId)) return settingsCache.get(guildId);

  const rows = getDb().prepare('SELECT * FROM log_settings WHERE guild_id = ?').all(guildId);
  const settings = {};
  for (const row of rows) {
    settings[row.category] = { channelId: row.channel_id, enabled: Boolean(row.enabled) };
  }

  settingsCache.set(guildId, settings);
  return settings;
}

/** Ustawienia jednej kategorii (zawsze zwraca obiekt). */
function getCategory(guildId, category) {
  return loadSettings(guildId)[category] ?? { channelId: null, enabled: false };
}

function list(guildId) {
  const settings = loadSettings(guildId);
  return CATEGORIES.map((category) => ({
    category,
    ...(settings[category] ?? { channelId: null, enabled: false }),
  }));
}

function setChannel(guildId, category, channelId) {
  getDb()
    .prepare(
      `INSERT INTO log_settings (guild_id, category, channel_id, enabled, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(guild_id, category)
       DO UPDATE SET channel_id = excluded.channel_id, enabled = 1, updated_at = excluded.updated_at`,
    )
    .run(guildId, category, channelId, Date.now());

  settingsCache.delete(guildId);
  return getCategory(guildId, category);
}

function setEnabled(guildId, category, enabled) {
  getDb()
    .prepare(
      `INSERT INTO log_settings (guild_id, category, channel_id, enabled, updated_at)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(guild_id, category)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .run(guildId, category, enabled ? 1 : 0, Date.now());

  settingsCache.delete(guildId);
  return getCategory(guildId, category);
}

/** Kieruje wszystkie kategorie na jeden kanal. */
function setAll(guildId, channelId) {
  const db = getDb();
  db.transaction(() => {
    for (const category of CATEGORIES) setChannel(guildId, category, channelId);
  })();

  settingsCache.delete(guildId);
  return list(guildId);
}

function clear(guildId) {
  const changes = getDb().prepare('DELETE FROM log_settings WHERE guild_id = ?').run(guildId).changes;
  settingsCache.delete(guildId);
  return changes;
}

// ─── Wykluczenia ────────────────────────────────────────────────────────────

function loadIgnores(guildId) {
  if (ignoreCache.has(guildId)) return ignoreCache.get(guildId);

  const rows = getDb().prepare('SELECT * FROM log_ignores WHERE guild_id = ?').all(guildId);
  const ignores = { channel: new Set(), role: new Set(), user: new Set() };
  for (const row of rows) ignores[row.type]?.add(row.target_id);

  ignoreCache.set(guildId, ignores);
  return ignores;
}

function addIgnore(guildId, type, targetId) {
  const added =
    getDb()
      .prepare('INSERT OR IGNORE INTO log_ignores (guild_id, type, target_id, created_at) VALUES (?, ?, ?, ?)')
      .run(guildId, type, targetId, Date.now()).changes > 0;

  ignoreCache.delete(guildId);
  return added;
}

function removeIgnore(guildId, type, targetId) {
  const removed =
    getDb().prepare('DELETE FROM log_ignores WHERE guild_id = ? AND type = ? AND target_id = ?').run(
      guildId,
      type,
      targetId,
    ).changes > 0;

  ignoreCache.delete(guildId);
  return removed;
}

function listIgnores(guildId) {
  const ignores = loadIgnores(guildId);
  return {
    channel: [...ignores.channel],
    role: [...ignores.role],
    user: [...ignores.user],
  };
}

/** Czy zdarzenie ma zostac pominiete (kanal, autor lub jedna z jego rol). */
function isIgnored(guildId, { channelId = null, userId = null, roleIds = [] } = {}) {
  const ignores = loadIgnores(guildId);

  if (channelId && ignores.channel.has(channelId)) return true;
  if (userId && ignores.user.has(userId)) return true;
  return roleIds.some((roleId) => ignores.role.has(roleId));
}

function invalidate(guildId) {
  settingsCache.delete(guildId);
  ignoreCache.delete(guildId);
}

module.exports = {
  CATEGORIES,
  getCategory,
  list,
  setChannel,
  setEnabled,
  setAll,
  clear,
  addIgnore,
  removeIgnore,
  listIgnores,
  isIgnored,
  invalidate,
};
