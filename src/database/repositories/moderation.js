'use strict';

const { getDb } = require('../index');

// ─── Ostrzezenia ────────────────────────────────────────────────────────────

function addWarning({ guildId, userId, moderatorId, reason }) {
  const info = getDb()
    .prepare(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, moderatorId, reason, Date.now());

  return getDb().prepare('SELECT * FROM warnings WHERE id = ?').get(Number(info.lastInsertRowid));
}

function listWarnings(guildId, userId, { includeRemoved = false } = {}) {
  const sql = includeRemoved
    ? 'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC'
    : 'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY id DESC';
  return getDb().prepare(sql).all(guildId, userId);
}

function countWarnings(guildId, userId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1')
    .get(guildId, userId).count;
}

function countAllWarnings(guildId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND active = 1')
    .get(guildId).count;
}

function removeWarning(guildId, warningId, removedBy) {
  const warning = getDb()
    .prepare('SELECT * FROM warnings WHERE guild_id = ? AND id = ? AND active = 1')
    .get(guildId, warningId);
  if (!warning) return null;

  getDb()
    .prepare('UPDATE warnings SET active = 0, removed_by = ?, removed_at = ? WHERE id = ?')
    .run(removedBy, Date.now(), warningId);
  return warning;
}

function clearWarnings(guildId, userId, removedBy) {
  return getDb()
    .prepare(
      `UPDATE warnings SET active = 0, removed_by = ?, removed_at = ?
       WHERE guild_id = ? AND user_id = ? AND active = 1`,
    )
    .run(removedBy, Date.now(), guildId, userId).changes;
}

// ─── Rejestr spraw moderacyjnych ────────────────────────────────────────────

function nextCaseNumber(guildId) {
  return (
    getDb()
      .prepare('SELECT COALESCE(MAX(case_number), 0) AS max FROM mod_cases WHERE guild_id = ?')
      .get(guildId).max + 1
  );
}

function addCase({ guildId, action, userId, userTag, moderatorId, reason, durationMs }) {
  const db = getDb();
  return db.transaction(() => {
    const caseNumber = nextCaseNumber(guildId);
    db.prepare(
      `INSERT INTO mod_cases
         (guild_id, case_number, action, user_id, user_tag, moderator_id, reason, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      guildId,
      caseNumber,
      action,
      userId,
      userTag ?? null,
      moderatorId,
      reason ?? null,
      durationMs ?? null,
      Date.now(),
    );
    return db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND case_number = ?').get(guildId, caseNumber);
  })();
}

function listCases(guildId, { userId = null, limit = 10 } = {}) {
  return userId
    ? getDb()
        .prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND user_id = ? ORDER BY case_number DESC LIMIT ?')
        .all(guildId, userId, limit)
    : getDb()
        .prepare('SELECT * FROM mod_cases WHERE guild_id = ? ORDER BY case_number DESC LIMIT ?')
        .all(guildId, limit);
}

// ─── Zabronione slowa ───────────────────────────────────────────────────────

function listBlockedWords(guildId) {
  return getDb()
    .prepare('SELECT * FROM blocked_words WHERE guild_id = ? ORDER BY word ASC')
    .all(guildId)
    .map((row) => row.word);
}

function addBlockedWord(guildId, word) {
  return (
    getDb()
      .prepare('INSERT OR IGNORE INTO blocked_words (guild_id, word, created_at) VALUES (?, ?, ?)')
      .run(guildId, word.toLowerCase(), Date.now()).changes > 0
  );
}

function removeBlockedWord(guildId, word) {
  return (
    getDb()
      .prepare('DELETE FROM blocked_words WHERE guild_id = ? AND word = ?')
      .run(guildId, word.toLowerCase()).changes > 0
  );
}

// ─── Bany czasowe ───────────────────────────────────────────────────────────

function addTempBan({ guildId, userId, expiresAt, reason }) {
  getDb()
    .prepare(
      `INSERT INTO temp_bans (guild_id, user_id, expires_at, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET expires_at = excluded.expires_at, reason = excluded.reason`,
    )
    .run(guildId, userId, expiresAt, reason ?? null, Date.now());
}

function removeTempBan(guildId, userId) {
  return getDb().prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}

/** Bany, ktorych czas juz uplynal — zdejmowane cyklicznie przez scheduler. */
function dueTempBans(now = Date.now()) {
  return getDb().prepare('SELECT * FROM temp_bans WHERE expires_at <= ?').all(now);
}

// ─── Wyciszenia czasowe ─────────────────────────────────────────────────────

function addMute({ guildId, userId, type, expiresAt, reason, moderatorId }) {
  getDb()
    .prepare(
      `INSERT INTO active_mutes (guild_id, user_id, type, expires_at, reason, moderator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, type) DO UPDATE
       SET expires_at = excluded.expires_at, reason = excluded.reason, moderator_id = excluded.moderator_id`,
    )
    .run(guildId, userId, type, expiresAt, reason ?? null, moderatorId ?? null, Date.now());
}

function removeMute(guildId, userId, type) {
  return getDb()
    .prepare('DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ? AND type = ?')
    .run(guildId, userId, type).changes;
}

function dueMutes(now = Date.now()) {
  return getDb().prepare('SELECT * FROM active_mutes WHERE expires_at <= ?').all(now);
}

module.exports = {
  addWarning,
  listWarnings,
  countWarnings,
  countAllWarnings,
  removeWarning,
  clearWarnings,
  addCase,
  listCases,
  nextCaseNumber,
  listBlockedWords,
  addBlockedWord,
  removeBlockedWord,
  addTempBan,
  removeTempBan,
  dueTempBans,
  addMute,
  removeMute,
  dueMutes,
};
