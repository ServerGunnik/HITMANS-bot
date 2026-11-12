'use strict';

const path = require('node:path');
require('dotenv').config({ quiet: true });

/**
 * Centralna konfiguracja procesu. Wszystko, co jest specyficzne dla
 * *instancji bota* (token, sciezka bazy) siedzi tutaj — ustawienia
 * specyficzne dla *serwera* trzymamy w bazie danych (patrz src/database).
 */
/** Numer portu albo null, gdy zmienna jest pusta lub bledna. */
function parsePort(value) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

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
  // kopie zapasowe bazy
  backupDir: path.resolve(process.cwd(), process.env.BACKUP_DIR || './backups'),
  backupRetentionDays: Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? '14', 10) || 14,
  // automatyczna aktualizacja (git pull + restart przez PM2)
  autoUpdate: /^(1|true|yes|tak)$/i.test(process.env.AUTO_UPDATE ?? ''),
  autoUpdateIntervalMinutes: Number.parseInt(process.env.AUTO_UPDATE_INTERVAL_MINUTES ?? '10', 10) || 10,
  // peleryny Musicmod: API HTTP dla moda (port z CAPES_PORT albo, na hostingu
  // Pterodactyl, z przydzielonego SERVER_PORT; brak obu = API wylaczone)
  capesPort: parsePort(process.env.CAPES_PORT ?? process.env.SERVER_PORT),
  capesReviewChannelId: process.env.CAPES_REVIEW_CHANNEL_ID || null,
  capesMaxKb: Number.parseInt(process.env.CAPES_MAX_KB ?? '300', 10) || 300,
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
