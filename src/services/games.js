'use strict';

const economy = require('../database/repositories/economy');
const { getDb } = require('../database');
const { humanDuration } = require('../utils/format');

/**
 * Wspólna logika dla komend zarabiania i hazardu:
 *   - cooldowny per komenda (kolumny `last_X_at` na `economy`),
 *   - walidacja stawek,
 *   - transakcje wygranej / przegranej zapisywane w ksiedze,
 *   - drobne pomocnicze RNG.
 */

// ─── Cooldowny ───────────────────────────────────────────────────────────────

const COOLDOWNS = {
  work: 60 * 60 * 1000,             // /praca — 1h
  daily: 24 * 60 * 60 * 1000,       // /dziennie — 24h
  weekly: 7 * 24 * 60 * 60 * 1000,  // /tygodniowo — 7 dni
  beg: 5 * 60 * 1000,               // /zebrz — 5 min
  rob: 30 * 60 * 1000,              // /kradziez — 30 min
  heist: 4 * 60 * 60 * 1000,        // /napad — 4h
};

const COLUMN_BY_KIND = {
  work: 'last_work_at',
  daily: 'last_daily_at',
  weekly: 'last_weekly_at',
  beg: 'last_beg_at',
  rob: 'last_rob_at',
  heist: 'last_heist_at',
};

/** Sprawdza cooldown; zwraca { ready, remaining, account }. */
function checkCooldown(guildId, userId, kind) {
  const column = COLUMN_BY_KIND[kind];
  const cooldown = COOLDOWNS[kind];
  const account = economy.getAccount(guildId, userId);
  const last = account[column];

  if (!last) return { ready: true, remaining: 0, account };

  const remaining = last + cooldown - Date.now();
  return { ready: remaining <= 0, remaining: Math.max(remaining, 0), account };
}

/** Stampuje kolumnie `last_X_at` biezacym czasem. */
function stampCooldown(guildId, userId, kind) {
  const column = COLUMN_BY_KIND[kind];
  getDb()
    .prepare(`UPDATE economy SET ${column} = ? WHERE guild_id = ? AND user_id = ?`)
    .run(Date.now(), guildId, userId);
}

function formatCooldown(ms) {
  if (ms < 1000) return 'chwile';
  return humanDuration(ms);
}

// ─── RNG ─────────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/** Losuje element z tablicy par [element, waga]. */
function pickWeighted(pairs) {
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [element, weight] of pairs) {
    roll -= weight;
    if (roll < 0) return element;
  }
  return pairs[pairs.length - 1][0];
}

// ─── Zapis transakcji z gier ─────────────────────────────────────────────────

/** Nagroda z komendy zarabiania (praca / dziennie / etc.). */
function awardEarn({ guildId, userId, amount, kind, reason }) {
  return economy.record({
    guildId,
    type: `game_${kind}`,
    toUserId: userId,
    amount,
    reason,
  });
}

/** Rozstrzyga zaklad: jesli wygral, dopisuje net profit; jesli przegral, zdejmuje wager. */
function resolveWager({ guildId, userId, wager, won, netProfit = null, kind = 'gamble', reason }) {
  if (won) {
    const profit = netProfit ?? wager;
    return economy.record({
      guildId,
      type: 'game_win',
      toUserId: userId,
      amount: profit,
      reason: `${kind}: ${reason}`,
    });
  }
  return economy.record({
    guildId,
    type: 'game_loss',
    fromUserId: userId,
    amount: wager,
    reason: `${kind}: ${reason}`,
  });
}

/** Kradziez: przenosi punkty z ofiary do zlodzieja. */
function stealFrom({ guildId, robberId, victimId, amount, reason }) {
  return economy.record({
    guildId,
    type: 'rob_success',
    fromUserId: victimId,
    toUserId: robberId,
    amount,
    reason,
  });
}

/** Kara za nieudana kradziez — spada z konta zlodzieja. */
function stealFine({ guildId, robberId, amount, reason }) {
  return economy.record({
    guildId,
    type: 'rob_fail',
    fromUserId: robberId,
    amount,
    reason,
  });
}

/** Aktywuje ochrone przed kradzieza na X ms. */
function setRobShield(guildId, userId, durationMs) {
  getDb()
    .prepare('UPDATE economy SET rob_shield_until = ? WHERE guild_id = ? AND user_id = ?')
    .run(Date.now() + durationMs, guildId, userId);
}

// ─── Streak dzienny ──────────────────────────────────────────────────────────

/**
 * Aktualizuje streak. Jesli ostatni odbior byl <36h temu — kontynuacja (+1).
 * Jesli >36h — reset do 1. Zwraca nowy streak.
 */
function bumpDailyStreak(guildId, userId, lastDailyAt) {
  const CONTINUITY_WINDOW = 36 * 60 * 60 * 1000;
  const account = economy.getAccount(guildId, userId);
  const previous = account.daily_streak ?? 0;
  const continuing = lastDailyAt && Date.now() - lastDailyAt <= CONTINUITY_WINDOW;
  const next = continuing ? previous + 1 : 1;

  getDb()
    .prepare('UPDATE economy SET daily_streak = ? WHERE guild_id = ? AND user_id = ?')
    .run(next, guildId, userId);

  return next;
}

module.exports = {
  COOLDOWNS,
  checkCooldown,
  stampCooldown,
  formatCooldown,
  randomInt,
  pickRandom,
  pickWeighted,
  awardEarn,
  resolveWager,
  stealFrom,
  stealFine,
  setRobShield,
  bumpDailyStreak,
};
