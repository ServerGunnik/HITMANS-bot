'use strict';

const logger = require('../utils/logger');

/**
 * Kolumny dodawane do tabel, ktore istnieja juz w starszych bazach.
 *
 * `schema.sql` tworzy tabele tylko wtedy, gdy ich nie ma (CREATE TABLE IF NOT EXISTS),
 * wiec nowe kolumny nie trafilyby do baz zalozonych wczesniejsza wersja bota.
 * Ta lista jest idempotentna: kolumna jest dodawana tylko, gdy jej brakuje.
 */
const COLUMNS = {
  guild_settings: [
    ['economy_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['currency_name', "TEXT NOT NULL DEFAULT 'Punkty klanowe'"],
    ['currency_emoji', "TEXT NOT NULL DEFAULT '🪙'"],
    ['economy_start_balance', 'INTEGER NOT NULL DEFAULT 0'],
    ['economy_message_reward', 'INTEGER NOT NULL DEFAULT 2'],
    ['economy_message_cooldown', 'INTEGER NOT NULL DEFAULT 60'],
    ['economy_voice_reward', 'INTEGER NOT NULL DEFAULT 1'],
    ['economy_voice_min_members', 'INTEGER NOT NULL DEFAULT 2'],
    ['economy_transfer_min', 'INTEGER NOT NULL DEFAULT 1'],
    ['economy_shop_channel_id', 'TEXT'],
    ['recruitment_review_required', 'INTEGER NOT NULL DEFAULT 0'],
    // weryfikacja (captcha)
    ['verification_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['verification_role_id', 'TEXT'],
    ['verification_channel_id', 'TEXT'],
    // tymczasowe kanaly glosowe
    ['voice_hub_channel_id', 'TEXT'],
    ['voice_hub_category_id', 'TEXT'],
    // rola wyciszenia (tekst)
    ['mute_role_id', 'TEXT'],
    // tickety podboju panstw (Earth SMP)
    ['conquest_category_id', 'TEXT'],
    ['conquest_staff_role_id', 'TEXT'],
    // bezpieczenstwo: anti-raid
    ['anti_raid_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['anti_raid_threshold', 'INTEGER NOT NULL DEFAULT 5'],
    ['anti_raid_window_seconds', 'INTEGER NOT NULL DEFAULT 10'],
    ['anti_raid_lockdown_minutes', 'INTEGER NOT NULL DEFAULT 10'],
    ['anti_raid_lockdown_until', 'INTEGER'],
    // bezpieczenstwo: anti-nuke
    ['anti_nuke_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['anti_nuke_threshold', 'INTEGER NOT NULL DEFAULT 3'],
    ['anti_nuke_window_seconds', 'INTEGER NOT NULL DEFAULT 60'],
    ['anti_nuke_whitelist', "TEXT NOT NULL DEFAULT '[]'"],
    // bezpieczenstwo: min. wiek konta
    ['min_account_age_days', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  economy: [
    // cooldowny komend zarobkowych
    ['last_work_at', 'INTEGER'],
    ['last_daily_at', 'INTEGER'],
    ['daily_streak', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_weekly_at', 'INTEGER'],
    ['last_beg_at', 'INTEGER'],
    ['last_rob_at', 'INTEGER'],
    ['last_heist_at', 'INTEGER'],
    // krotka ochrona przed kolejnym napadem (timestamp konca ochrony)
    ['rob_shield_until', 'INTEGER'],
  ],
  applications: [
    // negocjacja terminu rekrutacji miedzy kandydatem a rekruterem
    ['schedule_state', 'TEXT'],                 // NULL | 'pending' | 'agreed'
    ['schedule_time', 'TEXT'],                  // wolny tekst z ostatnia propozycja
    ['schedule_awaiting', 'TEXT'],              // NULL | 'applicant' | 'reviewer'
    ['schedule_reviewer_id', 'TEXT'],           // pierwszy rekruter ktory zaproponowal (blokuje innych)
    ['schedule_agreed_at', 'INTEGER'],
  ],
  recruitment_questions: [
    // 'applicant' = pytanie w formularzu kandydata,
    // 'reviewer'  = pytanie ankiety oceny wypelnianej przez rekrutera.
    ['audience', "TEXT NOT NULL DEFAULT 'applicant'"],
  ],
};

/** Dodaje brakujace kolumny do istniejacych tabel. */
function applyMigrations(db) {
  const added = [];

  for (const [table, columns] of Object.entries(COLUMNS)) {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!tableExists) continue;

    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));

    for (const [name, definition] of columns) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      added.push(`${table}.${name}`);
    }
  }

  if (added.length > 0) {
    logger.info(`Migracja bazy: dodano kolumny — ${added.join(', ')}`);
  }

  return added;
}

module.exports = { applyMigrations, COLUMNS };
