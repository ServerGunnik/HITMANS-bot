'use strict';

const { getDb } = require('../index');

/**
 * Hierarchia rol klanowych: poziom 1 to najnizszy stopien (np. Rekrut),
 * kolejne poziomy to awanse (Czlonek -> Weteran -> Officer).
 */

function list(guildId) {
  return getDb()
    .prepare('SELECT * FROM role_hierarchy WHERE guild_id = ? ORDER BY level ASC')
    .all(guildId);
}

function getByLevel(guildId, level) {
  return getDb()
    .prepare('SELECT * FROM role_hierarchy WHERE guild_id = ? AND level = ?')
    .get(guildId, level);
}

function getByRole(guildId, roleId) {
  return getDb()
    .prepare('SELECT * FROM role_hierarchy WHERE guild_id = ? AND role_id = ?')
    .get(guildId, roleId);
}

/** Dodaje lub nadpisuje wpis hierarchii (poziom jest unikalny w obrebie serwera). */
function set(guildId, { roleId, level, name }) {
  const db = getDb();
  return db.transaction(() => {
    db.prepare('DELETE FROM role_hierarchy WHERE guild_id = ? AND (level = ? OR role_id = ?)').run(
      guildId,
      level,
      roleId,
    );
    db.prepare(
      'INSERT INTO role_hierarchy (guild_id, role_id, level, name, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(guildId, roleId, level, name, Date.now());
    return getByRole(guildId, roleId);
  })();
}

function remove(guildId, roleId) {
  return getDb()
    .prepare('DELETE FROM role_hierarchy WHERE guild_id = ? AND role_id = ?')
    .run(guildId, roleId).changes;
}

function clear(guildId) {
  return getDb().prepare('DELETE FROM role_hierarchy WHERE guild_id = ?').run(guildId).changes;
}

/** Zwraca najwyzszy poziom hierarchii, jaki posiada dany czlonek serwera. */
function highestLevelFor(guildId, memberRoleIds) {
  const entries = list(guildId).filter((entry) => memberRoleIds.includes(entry.role_id));
  if (entries.length === 0) return null;
  return entries.reduce((best, entry) => (entry.level > best.level ? entry : best), entries[0]);
}

module.exports = { list, getByLevel, getByRole, set, remove, clear, highestLevelFor };
