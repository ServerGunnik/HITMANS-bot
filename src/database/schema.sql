-- =============================================================================
--  NL_Bot - schemat bazy danych (SQLite)
--  Wszystkie ustawienia sa per-serwer (guild_id) - bot obsluguje wiele serwerow.
-- =============================================================================

-- Ustawienia serwera -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id                 TEXT PRIMARY KEY,
  -- rekrutacja
  recruitment_enabled      INTEGER NOT NULL DEFAULT 1,
  applications_channel_id  TEXT,
  welcome_channel_id       TEXT,
  welcome_message          TEXT,
  recruitment_cooldown_h   INTEGER NOT NULL DEFAULT 24,
  -- role
  guest_role_id            TEXT,
  member_role_id           TEXT,
  -- moderacja
  modlog_channel_id        TEXT,
  -- automoderacja
  automod_enabled          INTEGER NOT NULL DEFAULT 0,
  automod_words            INTEGER NOT NULL DEFAULT 0,
  automod_links            INTEGER NOT NULL DEFAULT 0,
  automod_invites          INTEGER NOT NULL DEFAULT 0,
  automod_spam             INTEGER NOT NULL DEFAULT 0,
  automod_spam_messages    INTEGER NOT NULL DEFAULT 5,
  automod_spam_seconds     INTEGER NOT NULL DEFAULT 5,
  automod_action           TEXT    NOT NULL DEFAULT 'warn',   -- delete | warn | timeout
  automod_timeout_minutes  INTEGER NOT NULL DEFAULT 10,
  automod_exempt_roles     TEXT    NOT NULL DEFAULT '[]',     -- JSON: ["roleId", ...]
  automod_link_whitelist   TEXT    NOT NULL DEFAULT '[]',     -- JSON: ["youtube.com", ...]
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

-- Pytania rekrutacyjne ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS recruitment_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  position     INTEGER NOT NULL,
  label        TEXT    NOT NULL,                  -- max 45 znakow (limit Discorda)
  description  TEXT,                              -- max 100 znakow, dopisek pod pytaniem
  placeholder  TEXT,
  style        TEXT    NOT NULL DEFAULT 'paragraph',  -- short | paragraph
  required     INTEGER NOT NULL DEFAULT 1,
  min_length   INTEGER,
  max_length   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_guild
  ON recruitment_questions (guild_id, position);

-- Zgloszenia rekrutacyjne ------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  user_tag    TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  answers     TEXT    NOT NULL,                   -- JSON: [{question, answer}]
  channel_id  TEXT,
  message_id  TEXT,
  reviewer_id TEXT,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_applications_guild_user
  ON applications (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (guild_id, status);

-- Oceny kandydata wystawiane przez rekruterow ------------------------------------
CREATE TABLE IF NOT EXISTS application_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  application_id INTEGER NOT NULL,
  reviewer_id    TEXT    NOT NULL,
  reviewer_tag   TEXT,
  answers        TEXT    NOT NULL,          -- JSON: [{question, answer}]
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (application_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_application
  ON application_reviews (application_id, id);

-- Hierarchia rol ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_hierarchy (
  guild_id   TEXT    NOT NULL,
  role_id    TEXT    NOT NULL,
  level      INTEGER NOT NULL,                    -- 1 = najnizszy stopien
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hierarchy_level
  ON role_hierarchy (guild_id, level);

-- Ostrzezenia ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warnings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  moderator_id TEXT    NOT NULL,
  reason       TEXT    NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  removed_by   TEXT,
  removed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_warnings_guild_user
  ON warnings (guild_id, user_id, active);

-- Rejestr akcji moderacyjnych --------------------------------------------------
CREATE TABLE IF NOT EXISTS mod_cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  case_number  INTEGER NOT NULL,
  action       TEXT    NOT NULL,                  -- kick | ban | timeout | warn | ...
  user_id      TEXT    NOT NULL,
  user_tag     TEXT,
  moderator_id TEXT    NOT NULL,
  reason       TEXT,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_number
  ON mod_cases (guild_id, case_number);

-- Zabronione slowa (automoderacja) ---------------------------------------------
CREATE TABLE IF NOT EXISTS blocked_words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  word       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_words
  ON blocked_words (guild_id, word);

-- Aktywnosc czlonkow -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_activity (
  guild_id        TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  messages        INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  first_seen_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS activity_daily (
  guild_id TEXT    NOT NULL,
  day      TEXT    NOT NULL,                      -- YYYY-MM-DD (UTC)
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
);

-- Bany czasowe (zdejmowane automatycznie przez scheduler) ----------------------
CREATE TABLE IF NOT EXISTS temp_bans (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_temp_bans_expiry ON temp_bans (expires_at);

-- Aktywne wyciszenia czasowe (tekst / glos) — zdejmowane przez scheduler --------
CREATE TABLE IF NOT EXISTS active_mutes (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  type         TEXT    NOT NULL,          -- 'text' | 'voice'
  expires_at   INTEGER NOT NULL,
  reason       TEXT,
  moderator_id TEXT,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_active_mutes_expiry ON active_mutes (expires_at);

-- =============================================================================
--  EKONOMIA KLANOWA
-- =============================================================================

-- Konta walutowe czlonkow --------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy (
  guild_id           TEXT    NOT NULL,
  user_id            TEXT    NOT NULL,
  balance            INTEGER NOT NULL DEFAULT 0,
  total_earned       INTEGER NOT NULL DEFAULT 0,
  total_spent        INTEGER NOT NULL DEFAULT 0,
  last_earn_at       INTEGER,              -- ostatnia nagroda za wiadomosc (cooldown)
  last_voice_earn_at INTEGER,              -- ostatnia nagroda za kanal glosowy
  voice_minutes      INTEGER NOT NULL DEFAULT 0,
  -- cooldowny komend zarobkowych i hazardu
  last_work_at       INTEGER,
  last_daily_at      INTEGER,
  daily_streak       INTEGER NOT NULL DEFAULT 0,
  last_weekly_at     INTEGER,
  last_beg_at        INTEGER,
  last_rob_at        INTEGER,
  last_heist_at      INTEGER,
  rob_shield_until   INTEGER,              -- ochrona przed napadem do timestamp
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_economy_balance ON economy (guild_id, balance DESC);

-- Ksiega transakcji (pelna historia, pozwala cofac naduzycia) ---------------------
CREATE TABLE IF NOT EXISTS economy_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  type         TEXT    NOT NULL,           -- transfer | admin_add | admin_remove
                                           -- earn_message | earn_voice | shop_purchase | revert
  from_user_id TEXT,                       -- kto placi (NULL = punkty utworzone przez system)
  to_user_id   TEXT,                       -- kto otrzymuje (NULL = punkty skasowane)
  amount       INTEGER NOT NULL,
  reason       TEXT,
  actor_id     TEXT,                       -- kto wykonal operacje (admin / system)
  reference_id INTEGER,                    -- transakcja cofana przez ten wpis
  reverted     INTEGER NOT NULL DEFAULT 0,
  reverted_by  TEXT,
  reverted_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_guild ON economy_transactions (guild_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_users
  ON economy_transactions (guild_id, from_user_id, to_user_id);

-- Sklep klanowy -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  description    TEXT,
  price          INTEGER NOT NULL,
  type           TEXT    NOT NULL DEFAULT 'role',  -- role | temp_role | custom
  role_id        TEXT,
  duration_hours INTEGER,                          -- dla type = temp_role
  stock          INTEGER,                          -- NULL = bez limitu
  enabled        INTEGER NOT NULL DEFAULT 1,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_items_guild ON shop_items (guild_id, position, id);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  item_id        INTEGER NOT NULL,
  item_name      TEXT    NOT NULL,
  price          INTEGER NOT NULL,
  transaction_id INTEGER,
  expires_at     INTEGER,                          -- dla rol czasowych
  expired        INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_expiry ON shop_purchases (expired, expires_at);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON shop_purchases (guild_id, user_id);

-- =============================================================================
--  LOGI ZDARZEN SERWERA
-- =============================================================================

-- Kanal docelowy dla kazdej kategorii logow -------------------------------------
CREATE TABLE IF NOT EXISTS log_settings (
  guild_id   TEXT    NOT NULL,
  category   TEXT    NOT NULL,          -- messages | members | roles | voice | channels | server | economy
  channel_id TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, category)
);

-- Kanaly, role i osoby wykluczone z logowania -----------------------------------
CREATE TABLE IF NOT EXISTS log_ignores (
  guild_id   TEXT NOT NULL,
  type       TEXT NOT NULL,             -- channel | role | user
  target_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, type, target_id)
);

-- =============================================================================
--  ANKIETY (glosowania)
-- =============================================================================

CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  channel_id  TEXT    NOT NULL,
  message_id  TEXT,
  author_id   TEXT    NOT NULL,
  question    TEXT    NOT NULL,
  multi       INTEGER NOT NULL DEFAULT 0,          -- 0 = pojedynczy wybor, 1 = wielokrotny
  anonymous   INTEGER NOT NULL DEFAULT 1,          -- 0 = widoczni glosujacy, 1 = anonimowa
  ends_at     INTEGER,                             -- NULL = bez terminu
  closed      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_ends ON polls (closed, ends_at);
CREATE INDEX IF NOT EXISTS idx_polls_guild ON polls (guild_id, id DESC);

CREATE TABLE IF NOT EXISTS poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id  INTEGER NOT NULL,
  position INTEGER NOT NULL,
  label    TEXT    NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    INTEGER NOT NULL,
  option_id  INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, option_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes (option_id);

-- =============================================================================
--  GIVEAWAYE (losowania)
-- =============================================================================

CREATE TABLE IF NOT EXISTS giveaways (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  channel_id       TEXT    NOT NULL,
  message_id       TEXT,
  author_id        TEXT    NOT NULL,
  prize            TEXT    NOT NULL,
  winners_count    INTEGER NOT NULL DEFAULT 1,
  required_role_id TEXT,                                -- opcjonalna rola wymagana do udzialu
  ends_at          INTEGER NOT NULL,
  closed           INTEGER NOT NULL DEFAULT 0,
  winner_ids       TEXT,                                -- JSON: ["userId", ...] po zakonczeniu
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaways_ends ON giveaways (closed, ends_at);
CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways (guild_id, id DESC);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway ON giveaway_entries (giveaway_id);

-- =============================================================================
--  TYMCZASOWE KANALY GLOSOWE (hub -> auto-tworzone kanaly na osobe)
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_channels (
  channel_id  TEXT    PRIMARY KEY,
  guild_id    TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL,
  panel_message_id TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_channels_guild ON voice_channels (guild_id);
CREATE INDEX IF NOT EXISTS idx_voice_channels_owner ON voice_channels (guild_id, owner_id);

-- =============================================================================
--  ZLECENIA PODBICIA PAŃSTW (Earth SMP — tickety w prywatnych kanalach)
-- =============================================================================

CREATE TABLE IF NOT EXISTS conquest_tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  user_tag      TEXT,
  channel_id    TEXT,
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | closed
  form_data     TEXT    NOT NULL,                  -- JSON: { nick, ourCountry, character, target, offer }
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  closed_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_conquest_guild ON conquest_tickets (guild_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_conquest_channel ON conquest_tickets (channel_id);
