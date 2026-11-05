'use strict';

const { getDb } = require('../index');

/** Aktywny (niezakonczony) urlop osoby albo undefined. */
function getActive(guildId, userId) {
  return getDb()
    .prepare('SELECT * FROM member_leaves WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(guildId, userId);
}

function get(guildId, id) {
  return getDb().prepare('SELECT * FROM member_leaves WHERE guild_id = ? AND id = ?').get(guildId, id);
}

/**
 * Zglasza urlop. Jesli osoba juz jest na urlopie — przedluza / aktualizuje istniejacy wpis.
 * Zwraca { leave, updated }.
 */
function start({ guildId, userId, reason, endsAt, roleId = null, now = Date.now() }) {
  const db = getDb();
  return db.transaction(() => {
    const existing = getActive(guildId, userId);
    if (existing) {
      db.prepare('UPDATE member_leaves SET reason = ?, ends_at = ?, role_id = COALESCE(?, role_id) WHERE id = ?').run(
        reason,
        endsAt,
        roleId,
        existing.id,
      );
      return { leave: get(guildId, existing.id), updated: true };
    }

    const result = db
      .prepare(
        `INSERT INTO member_leaves (guild_id, user_id, reason, starts_at, ends_at, role_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, userId, reason, now, endsAt, roleId, now);
    return { leave: get(guildId, result.lastInsertRowid), updated: false };
  })();
}

/** Konczy urlop (manual | expired | officer). Zwraca zakonczony wpis albo null, gdy juz byl zakonczony. */
function end(guildId, id, { reason = 'manual', endedBy = null, now = Date.now() } = {}) {
  const result = getDb()
    .prepare(
      'UPDATE member_leaves SET ended_at = ?, end_reason = ?, ended_by = ? WHERE guild_id = ? AND id = ? AND ended_at IS NULL',
    )
    .run(now, reason, endedBy, guildId, id);
  return result.changes > 0 ? get(guildId, id) : null;
}

/** Wszystkie trwajace urlopy na serwerze (najblizej konca pierwsze). */
function listActive(guildId) {
  return getDb()
    .prepare('SELECT * FROM member_leaves WHERE guild_id = ? AND ended_at IS NULL ORDER BY ends_at ASC, id ASC')
    .all(guildId);
}

/** Urlopy, ktorych termin minal (dla schedulera, wszystkie serwery). */
function due(now = Date.now()) {
  return getDb()
    .prepare('SELECT * FROM member_leaves WHERE ended_at IS NULL AND ends_at <= ? ORDER BY ends_at ASC LIMIT 50')
    .all(now);
}

/** Zbior userId osob aktualnie na urlopie. */
function activeUserIds(guildId) {
  return new Set(listActive(guildId).map((leave) => leave.user_id));
}

module.exports = { getActive, get, start, end, listActive, due, activeUserIds };
