'use strict';

const { getDb } = require('../index');
const guilds = require('./guilds');

/**
 * Ekonomia klanowa.
 *
 * Kazda zmiana salda przechodzi przez `record()`, ktore w jednej transakcji
 * bazodanowej aktualizuje konta i dopisuje wpis do ksiegi `economy_transactions`.
 * Dzieki temu historia jest kompletna, a naduzycia mozna cofnac (`revert`).
 */

const REVERTIBLE_TYPES = new Set(['transfer', 'admin_add', 'admin_remove']);

// ─── Konta ──────────────────────────────────────────────────────────────────

function ensureAccount(guildId, userId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (existing) return existing;

  const startBalance = guilds.get(guildId).economy_start_balance ?? 0;
  db.prepare(
    'INSERT INTO economy (guild_id, user_id, balance, created_at) VALUES (?, ?, ?, ?)',
  ).run(guildId, userId, startBalance, Date.now());

  return db.prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function getAccount(guildId, userId) {
  return ensureAccount(guildId, userId);
}

function getBalance(guildId, userId) {
  return ensureAccount(guildId, userId).balance;
}

/** Surowa zmiana salda — uzywana wylacznie wewnatrz transakcji z `record()`. */
function applyDelta(guildId, userId, amount) {
  ensureAccount(guildId, userId);

  const db = getDb();
  if (amount >= 0) {
    db.prepare(
      'UPDATE economy SET balance = balance + ?, total_earned = total_earned + ? WHERE guild_id = ? AND user_id = ?',
    ).run(amount, amount, guildId, userId);
  } else {
    db.prepare(
      'UPDATE economy SET balance = balance + ?, total_spent = total_spent + ? WHERE guild_id = ? AND user_id = ?',
    ).run(amount, Math.abs(amount), guildId, userId);
  }
}

// ─── Ksiega transakcji ──────────────────────────────────────────────────────

function getTransaction(guildId, id) {
  return getDb()
    .prepare('SELECT * FROM economy_transactions WHERE guild_id = ? AND id = ?')
    .get(guildId, id);
}

/**
 * Zapisuje operacje: przesuwa srodki i dopisuje wpis do ksiegi.
 * `fromUserId` = null oznacza punkty utworzone przez system (nagrody),
 * `toUserId` = null oznacza punkty skasowane (zakup, odjecie przez admina).
 */
function record({ guildId, type, fromUserId = null, toUserId = null, amount, reason = null, actorId = null, referenceId = null }) {
  const db = getDb();

  return db.transaction(() => {
    if (fromUserId) applyDelta(guildId, fromUserId, -amount);
    if (toUserId) applyDelta(guildId, toUserId, amount);

    const info = db
      .prepare(
        `INSERT INTO economy_transactions
           (guild_id, type, from_user_id, to_user_id, amount, reason, actor_id, reference_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, type, fromUserId, toUserId, amount, reason, actorId, referenceId, Date.now());

    return getTransaction(guildId, Number(info.lastInsertRowid));
  })();
}

// ─── Operacje wysokiego poziomu ─────────────────────────────────────────────

/** Przelew miedzy czlonkami. Zwraca { ok } albo { ok: false, reason, balance }. */
function transfer({ guildId, fromUserId, toUserId, amount, reason }) {
  const balance = getBalance(guildId, fromUserId);
  if (balance < amount) return { ok: false, reason: 'insufficient', balance };

  const transaction = record({
    guildId,
    type: 'transfer',
    fromUserId,
    toUserId,
    amount,
    reason,
    actorId: fromUserId,
  });

  return { ok: true, transaction, balance: getBalance(guildId, fromUserId) };
}

/** Reczne przyznanie punktow przez administracje. */
function grant({ guildId, userId, amount, actorId, reason }) {
  const transaction = record({ guildId, type: 'admin_add', toUserId: userId, amount, actorId, reason });
  return { ok: true, transaction, balance: getBalance(guildId, userId) };
}

/**
 * Reczne odjecie punktow. Saldo nie schodzi ponizej zera —
 * `amount` w ksiedze to faktycznie odjeta kwota.
 */
function take({ guildId, userId, amount, actorId, reason }) {
  const balance = getBalance(guildId, userId);
  const applied = Math.min(amount, balance);

  if (applied <= 0) return { ok: false, reason: 'empty', balance };

  const transaction = record({
    guildId,
    type: 'admin_remove',
    fromUserId: userId,
    amount: applied,
    actorId,
    reason,
  });

  return { ok: true, transaction, applied, partial: applied < amount, balance: getBalance(guildId, userId) };
}

/** Wydanie punktow w sklepie. */
function spend({ guildId, userId, amount, reason }) {
  const balance = getBalance(guildId, userId);
  if (balance < amount) return { ok: false, reason: 'insufficient', balance };

  const transaction = record({ guildId, type: 'shop_purchase', fromUserId: userId, amount, reason, actorId: userId });
  return { ok: true, transaction, balance: getBalance(guildId, userId) };
}

// ─── Zarobek za aktywnosc ───────────────────────────────────────────────────

/** Czy uplynal cooldown nagrody za wiadomosc. */
function canEarnMessage(guildId, userId, cooldownSeconds) {
  const account = ensureAccount(guildId, userId);
  if (!account.last_earn_at) return true;
  return Date.now() - account.last_earn_at >= cooldownSeconds * 1000;
}

/** Nagroda za aktywnosc; `kind` to 'message' albo 'voice'. */
function earn({ guildId, userId, amount, kind = 'message', reason = null, voiceMinutes = 0 }) {
  const db = getDb();

  return db.transaction(() => {
    const transaction = record({
      guildId,
      type: kind === 'voice' ? 'earn_voice' : 'earn_message',
      toUserId: userId,
      amount,
      reason,
    });

    const column = kind === 'voice' ? 'last_voice_earn_at' : 'last_earn_at';
    db.prepare(`UPDATE economy SET ${column} = ? WHERE guild_id = ? AND user_id = ?`).run(
      Date.now(),
      guildId,
      userId,
    );

    if (voiceMinutes > 0) {
      db.prepare('UPDATE economy SET voice_minutes = voice_minutes + ? WHERE guild_id = ? AND user_id = ?').run(
        voiceMinutes,
        guildId,
        userId,
      );
    }

    return transaction;
  })();
}

// ─── Ranking i historia ─────────────────────────────────────────────────────

const LEADERBOARD_COLUMNS = {
  balance: 'balance',
  earned: 'total_earned',
  voice: 'voice_minutes',
};

function leaderboard(guildId, { sort = 'balance', limit = 10 } = {}) {
  const column = LEADERBOARD_COLUMNS[sort] ?? 'balance';
  return getDb()
    .prepare(`SELECT * FROM economy WHERE guild_id = ? ORDER BY ${column} DESC, user_id ASC LIMIT ?`)
    .all(guildId, limit);
}

/** Pozycja uzytkownika w rankingu (1 = najwyzsza). */
function rankOf(guildId, userId, sort = 'balance') {
  const column = LEADERBOARD_COLUMNS[sort] ?? 'balance';
  const account = getDb().prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!account) return null;

  const better = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM economy WHERE guild_id = ? AND ${column} > ?`)
    .get(guildId, account[column]).count;

  return { position: better + 1, account, total: countAccounts(guildId) };
}

function countAccounts(guildId) {
  return getDb().prepare('SELECT COUNT(*) AS count FROM economy WHERE guild_id = ?').get(guildId).count;
}

function totalCirculation(guildId) {
  return getDb().prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM economy WHERE guild_id = ?').get(guildId)
    .total;
}

/** Historia transakcji — calego serwera albo jednego uzytkownika. */
function history(guildId, { userId = null, types = null, limit = 10 } = {}) {
  const conditions = ['guild_id = ?'];
  const params = [guildId];

  if (userId) {
    conditions.push('(from_user_id = ? OR to_user_id = ?)');
    params.push(userId, userId);
  }
  if (types?.length) {
    conditions.push(`type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }

  return getDb()
    .prepare(`SELECT * FROM economy_transactions WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit);
}

/**
 * Cofa transakcje: zwraca srodki i oznacza wpis jako cofniety,
 * dopisujac transakcje przeciwstawna typu `revert`.
 *
 * Gdy odbiorca zdazyl wydac czesc punktow, odzyskiwana jest kwota mozliwa
 * do pobrania (saldo nigdy nie schodzi ponizej zera), a wynik zawiera
 * `partial: true` wraz z faktycznie cofnieta kwota.
 */
function revert(guildId, transactionId, actorId) {
  const db = getDb();

  return db.transaction(() => {
    const original = getTransaction(guildId, transactionId);

    if (!original) return { ok: false, reason: 'not_found' };
    if (original.reverted) return { ok: false, reason: 'already_reverted' };
    if (!REVERTIBLE_TYPES.has(original.type)) return { ok: false, reason: 'not_revertible', transaction: original };

    // Odbiorca oryginalnej transakcji oddaje srodki jej nadawcy.
    const payer = original.to_user_id;
    const payee = original.from_user_id;

    const available = payer ? getBalance(guildId, payer) : original.amount;
    const amount = Math.min(original.amount, available);

    if (amount <= 0) {
      return { ok: false, reason: 'no_funds', transaction: original, balance: available };
    }

    const counter = record({
      guildId,
      type: 'revert',
      fromUserId: payer,
      toUserId: payee,
      amount,
      reason: `Cofniecie transakcji #${original.id}`,
      actorId,
      referenceId: original.id,
    });

    db.prepare('UPDATE economy_transactions SET reverted = 1, reverted_by = ?, reverted_at = ? WHERE id = ?').run(
      actorId,
      Date.now(),
      original.id,
    );

    return {
      ok: true,
      transaction: getTransaction(guildId, original.id),
      counter,
      amount,
      partial: amount < original.amount,
    };
  })();
}

/** Czysci ekonomie serwera (salda i historie). */
function resetGuild(guildId) {
  const db = getDb();
  return db.transaction(() => {
    const accounts = db.prepare('DELETE FROM economy WHERE guild_id = ?').run(guildId).changes;
    const transactions = db.prepare('DELETE FROM economy_transactions WHERE guild_id = ?').run(guildId).changes;
    return { accounts, transactions };
  })();
}

module.exports = {
  REVERTIBLE_TYPES,
  ensureAccount,
  getAccount,
  getBalance,
  record,
  transfer,
  grant,
  take,
  spend,
  canEarnMessage,
  earn,
  leaderboard,
  rankOf,
  countAccounts,
  totalCirculation,
  history,
  getTransaction,
  revert,
  resetGuild,
};
