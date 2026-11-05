'use strict';

const { getDb } = require('../index');

const MODES = ['multi', 'single'];

function hydrate(row) {
  if (!row) return null;
  const entries = getDb()
    .prepare('SELECT * FROM role_panel_entries WHERE panel_id = ? ORDER BY position ASC, rowid ASC')
    .all(row.id);
  return { ...row, entries };
}

function create({ guildId, title, description, mode = 'multi', createdBy }) {
  const info = getDb()
    .prepare(
      `INSERT INTO role_panels (guild_id, title, description, mode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, title, description ?? null, MODES.includes(mode) ? mode : 'multi', createdBy, Date.now());
  return get(info.lastInsertRowid);
}

function get(id) {
  return hydrate(getDb().prepare('SELECT * FROM role_panels WHERE id = ?').get(id));
}

/** Panel tylko z danego serwera (chroni przed podawaniem cudzych id). */
function getForGuild(guildId, id) {
  const found = get(id);
  return found && found.guild_id === guildId ? found : null;
}

function list(guildId) {
  return getDb()
    .prepare('SELECT * FROM role_panels WHERE guild_id = ? ORDER BY id ASC')
    .all(guildId)
    .map(hydrate);
}

function setMode(id, mode) {
  if (!MODES.includes(mode)) throw new Error(`Nieznany tryb panelu: ${mode}`);
  getDb().prepare('UPDATE role_panels SET mode = ? WHERE id = ?').run(mode, id);
}

function setMessage(id, channelId, messageId) {
  getDb().prepare('UPDATE role_panels SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM role_panels WHERE id = ?').run(id).changes > 0;
}

/** Dodaje role do panelu albo aktualizuje etykiete/emoji, jesli juz jest. */
function addEntry(panelId, { roleId, label, emoji }) {
  const db = getDb();
  const position = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM role_panel_entries WHERE panel_id = ?')
    .get(panelId).next;

  db.prepare(
    `INSERT INTO role_panel_entries (panel_id, role_id, label, emoji, position) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(panel_id, role_id) DO UPDATE SET label = excluded.label, emoji = excluded.emoji`,
  ).run(panelId, roleId, label, emoji ?? null, position);
}

function removeEntry(panelId, roleId) {
  return getDb().prepare('DELETE FROM role_panel_entries WHERE panel_id = ? AND role_id = ?').run(panelId, roleId).changes > 0;
}

module.exports = { MODES, create, get, getForGuild, list, setMode, setMessage, remove, addEntry, removeEntry };
