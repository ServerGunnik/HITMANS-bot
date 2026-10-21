'use strict';

const { getDb } = require('../index');

/** Ustawienia serwera trzymamy w cache - odczytujemy je przy prawie kazdej interakcji. */
const cache = new Map();

const DEFAULT_WELCOME =
  'Witaj {user} na serwerze **{server}**! Twoje zgloszenie zostalo zaakceptowane. ' +
  'Jestes teraz czlonkiem klanu — jest nas juz {memberCount}.';

const BOOLEAN_COLUMNS = new Set([
  'recruitment_enabled',
  'recruitment_review_required',
  'economy_enabled',
  'automod_enabled',
  'automod_words',
  'automod_links',
  'automod_invites',
  'automod_spam',
  'verification_enabled',
  'anti_raid_enabled',
  'anti_nuke_enabled',
]);

const JSON_COLUMNS = new Set(['automod_exempt_roles', 'automod_link_whitelist', 'anti_nuke_whitelist']);

const ALLOWED_COLUMNS = new Set([
  'recruitment_enabled',
  'applications_channel_id',
  'welcome_channel_id',
  'welcome_message',
  'recruitment_cooldown_h',
  'recruitment_review_required',
  'guest_role_id',
  'member_role_id',
  'modlog_channel_id',
  'automod_enabled',
  'automod_words',
  'automod_links',
  'automod_invites',
  'automod_spam',
  'automod_spam_messages',
  'automod_spam_seconds',
  'automod_action',
  'automod_timeout_minutes',
  'automod_exempt_roles',
  'automod_link_whitelist',
  // ekonomia
  'economy_enabled',
  'currency_name',
  'currency_emoji',
  'economy_start_balance',
  'economy_message_reward',
  'economy_message_cooldown',
  'economy_voice_reward',
  'economy_voice_min_members',
  'economy_transfer_min',
  'economy_shop_channel_id',
  // weryfikacja
  'verification_enabled',
  'verification_role_id',
  'verification_channel_id',
  // tymczasowe kanaly glosowe
  'voice_hub_channel_id',
  'voice_hub_category_id',
  // wyciszenie tekstowe
  'mute_role_id',
  // podboje panstw
  'conquest_category_id',
  'conquest_staff_role_id',
  // bezpieczenstwo
  'anti_raid_enabled',
  'anti_raid_threshold',
  'anti_raid_window_seconds',
  'anti_raid_lockdown_minutes',
  'anti_raid_lockdown_until',
  'anti_nuke_enabled',
  'anti_nuke_threshold',
  'anti_nuke_window_seconds',
  'anti_nuke_whitelist',
  'min_account_age_days',
]);

function hydrate(row) {
  if (!row) return null;
  const settings = { ...row };
  for (const key of BOOLEAN_COLUMNS) settings[key] = Boolean(settings[key]);
  for (const key of JSON_COLUMNS) {
    try {
      settings[key] = JSON.parse(settings[key] ?? '[]');
    } catch {
      settings[key] = [];
    }
  }
  return settings;
}

/** Zwraca ustawienia serwera, tworzac domyslny wiersz przy pierwszym uzyciu. */
function get(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);

  const db = getDb();
  let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);

  if (!row) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO guild_settings (guild_id, welcome_message, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(guildId, DEFAULT_WELCOME, now, now);
    row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }

  const settings = hydrate(row);
  cache.set(guildId, settings);
  return settings;
}

/** Aktualizuje wybrane kolumny ustawien i odswieza cache. */
function update(guildId, patch) {
  get(guildId); // upewnia sie, ze wiersz istnieje

  const entries = Object.entries(patch).filter(([key]) => ALLOWED_COLUMNS.has(key));
  if (entries.length === 0) return get(guildId);

  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([key, value]) => {
    if (JSON_COLUMNS.has(key)) return JSON.stringify(value ?? []);
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value ?? null;
  });

  getDb()
    .prepare(`UPDATE guild_settings SET ${assignments}, updated_at = ? WHERE guild_id = ?`)
    .run(...values, Date.now(), guildId);

  cache.delete(guildId);
  return get(guildId);
}

/** Przywraca ustawienia serwera do wartosci domyslnych. */
function reset(guildId) {
  getDb().prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
  cache.delete(guildId);
  return get(guildId);
}

function invalidate(guildId) {
  cache.delete(guildId);
}

module.exports = { get, update, reset, invalidate, DEFAULT_WELCOME };
