'use strict';

const path = require('node:path');
require('dotenv').config({ quiet: true });

/**
 * Centralna konfiguracja procesu. Wszystko, co jest specyficzne dla
 * *instancji bota* (token, sciezka bazy) siedzi tutaj — ustawienia
 * specyficzne dla *serwera* trzymamy w bazie danych (patrz src/database).
 */
const config = {
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.CLIENT_ID ?? '',
  guildId: process.env.GUILD_ID || null,
  databasePath: path.resolve(
    process.cwd(),
    process.env.DATABASE_PATH || './data/nlbot.db',
  ),
  logLevel: process.env.LOG_LEVEL || 'info',
  logToFile: /^(1|true|yes|tak)$/i.test(process.env.LOG_TO_FILE ?? ''),
  logDir: path.resolve(process.cwd(), process.env.LOG_DIR || './logs'),
  logRetentionDays: Number.parseInt(process.env.LOG_RETENTION_DAYS ?? '14', 10) || 14,
  enablePresenceIntent: /^(1|true|yes|tak)$/i.test(process.env.ENABLE_PRESENCE_INTENT ?? ''),
  ownerIds: (process.env.OWNER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
};

/** Rzuca czytelnym bledem, gdy brakuje wymaganych zmiennych srodowiskowych. */
function assertConfig({ requireToken = true } = {}) {
  const missing = [];
  if (requireToken && !config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(
      `Brak wymaganych zmiennych srodowiskowych: ${missing.join(', ')}. ` +
        'Skopiuj plik .env.example do .env i uzupelnij dane.',
    );
  }
}

module.exports = { config, assertConfig };
