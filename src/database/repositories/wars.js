'use strict';

const { getDb } = require('../index');

const RESULTS = ['win', 'loss', 'draw'];

function create({ guildId, opponent, result, score, eventId, participants = [], recordedBy, foughtAt }, now = Date.now()) {
  if (!RESULTS.includes(result)) throw new Error(`Nieznany wynik bitwy: ${result}`);
  const db = getDb();

  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO wars (guild_id, opponent, result, score, event_id, recorded_by, fought_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, opponent, result, score ?? null, eventId ?? null, recordedBy, foughtAt ?? now, now);
    const insert = db.prepare('INSERT OR IGNORE INTO war_participants (war_id, user_id) VALUES (?, ?)');
    for (const userId of participants) insert.run(info.lastInsertRowid, userId);
    return info.lastInsertRowid;
  })();

  return get(id);
}

function get(id) {
  const db = getDb();
  const war = db.prepare('SELECT * FROM wars WHERE id = ?').get(id);
  if (!war) return null;
  war.participants = db
    .prepare('SELECT user_id FROM war_participants WHERE war_id = ? ORDER BY rowid ASC')
    .all(id)
    .map((row) => row.user_id);
  return war;
}

/** Usuwa bitwe z danego serwera. Zwraca true, gdy cos usunieto. */
function remove(guildId, id) {
  return getDb().prepare('DELETE FROM wars WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
}

/** Bilans klanu: { wins, losses, draws, total }, opcjonalnie tylko z jednym przeciwnikiem. */
function summary(guildId, { opponent } = {}) {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(result = 'win'), 0)  AS wins,
         COALESCE(SUM(result = 'loss'), 0) AS losses,
         COALESCE(SUM(result = 'draw'), 0) AS draws,
         COUNT(*) AS total
       FROM wars WHERE guild_id = ? AND (? IS NULL OR opponent = ? COLLATE NOCASE)`,
    )
    .get(guildId, opponent ?? null, opponent ?? null);
  return row;
}

/** Ostatnie bitwy (najnowsze pierwsze) z liczba uczestnikow. */
function recent(guildId, { limit = 10, opponent } = {}) {
  return getDb()
    .prepare(
      `SELECT w.*, (SELECT COUNT(*) FROM war_participants p WHERE p.war_id = w.id) AS participant_count
       FROM wars w WHERE w.guild_id = ? AND (? IS NULL OR w.opponent = ? COLLATE NOCASE)
       ORDER BY w.fought_at DESC, w.id DESC LIMIT ?`,
    )
    .all(guildId, opponent ?? null, opponent ?? null, limit);
}

/** Ranking graczy: by = 'battles' (udzial) albo 'wins' (wygrane). */
function ranking(guildId, { by = 'battles', limit = 10 } = {}) {
  const order = by === 'wins' ? 'wins DESC, battles DESC' : 'battles DESC, wins DESC';
  return getDb()
    .prepare(
      `SELECT p.user_id, COUNT(*) AS battles, COALESCE(SUM(w.result = 'win'), 0) AS wins
       FROM war_participants p JOIN wars w ON w.id = p.war_id
       WHERE w.guild_id = ?
       GROUP BY p.user_id
       ORDER BY ${order}, MIN(w.fought_at) ASC
       LIMIT ?`,
    )
    .all(guildId, limit);
}

/** Statystyki pojedynczego gracza: { battles, wins, losses, draws }. */
function memberStats(guildId, userId) {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS battles,
              COALESCE(SUM(w.result = 'win'), 0)  AS wins,
              COALESCE(SUM(w.result = 'loss'), 0) AS losses,
              COALESCE(SUM(w.result = 'draw'), 0) AS draws
       FROM war_participants p JOIN wars w ON w.id = p.war_id
       WHERE w.guild_id = ? AND p.user_id = ?`,
    )
    .get(guildId, userId);
}

module.exports = { RESULTS, create, get, remove, summary, recent, ranking, memberStats };
