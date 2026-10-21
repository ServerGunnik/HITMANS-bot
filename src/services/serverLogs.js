'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const logsRepo = require('../database/repositories/logs');
const logger = require('../utils/logger');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');

/**
 * Logi zdarzen serwera — osobne od logow moderacji (`src/utils/modlog.js`),
 * ktore opisuja akcje wykonane komendami bota. Tutaj trafia to, co dzieje sie
 * na serwerze samo z siebie: usuniete wiadomosci, wejscia i wyjscia, zmiany rol,
 * ruch na kanalach glosowych, zmiany kanalow i rol oraz operacje ekonomiczne.
 */

const CATEGORY_META = {
  messages: { label: 'Wiadomosci', emoji: '💬', description: 'Usuniete i edytowane wiadomosci' },
  members: { label: 'Czlonkowie', emoji: '🚪', description: 'Wejscia, wyjscia, bany, zmiany nickow' },
  roles: { label: 'Role', emoji: '🛡️', description: 'Nadane i odebrane role, zmiany rol serwera' },
  voice: { label: 'Kanaly glosowe', emoji: '🔊', description: 'Wejscia, wyjscia i przenosiny' },
  channels: { label: 'Kanaly', emoji: '📁', description: 'Tworzenie, usuwanie i edycja kanalow' },
  server: { label: 'Serwer', emoji: '⚙️', description: 'Zmiany ustawien serwera' },
  economy: { label: 'Ekonomia', emoji: '💰', description: 'Przelewy, korekty sald i zakupy' },
};

/**
 * Akcje wykonane przez samego bota, zeby nie logowac ich dwa razy
 * (np. /ban trafia do logu moderacji, a chwile pozniej przychodzi guildBanAdd).
 */
const botActions = new Map();
const BOT_ACTION_TTL = 15 * 1000;

function markBotAction(guildId, userId, action) {
  botActions.set(`${guildId}:${userId}:${action}`, Date.now());
}

/** Zwraca true i kasuje znacznik, jesli akcje wykonal bot. */
function consumeBotAction(guildId, userId, action) {
  const key = `${guildId}:${userId}:${action}`;
  const at = botActions.get(key);
  if (!at) return false;

  botActions.delete(key);
  return Date.now() - at < BOT_ACTION_TTL;
}

function cleanupBotActions() {
  const now = Date.now();
  for (const [key, at] of botActions) {
    if (now - at > BOT_ACTION_TTL) botActions.delete(key);
  }
}

/** Kanal logow danej kategorii albo null, gdy kategoria jest wylaczona. */
async function resolveChannel(guild, category) {
  const settings = logsRepo.getCategory(guild.id, category);
  if (!settings.enabled || !settings.channelId) return null;

  const channel =
    guild.channels.cache.get(settings.channelId) ??
    (await guild.channels.fetch(settings.channelId).catch(() => null));

  if (!channel?.isTextBased()) return null;

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.SendMessages)) return null;

  return channel;
}

/**
 * Wysyla wpis do kanalu logow wybranej kategorii.
 * Brak konfiguracji nie jest bledem — zdarzenie jest po prostu pomijane.
 */
async function send(guild, category, { title, color = COLORS.neutral, description, fields, blocks, footer, thumbnail }) {
  if (!guild) return false;

  try {
    const channel = await resolveChannel(guild, category);
    if (!channel) return false;

    const meta = CATEGORY_META[category] ?? { emoji: '📋' };

    await channel.send({
      components: [
        panel({
          color,
          title: `${meta.emoji} ${title}`,
          description,
          fields,
          blocks,
          thumbnail,
          footer: footer ?? new Date().toLocaleString('pl-PL'),
        }),
      ],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    return true;
  } catch (error) {
    logger.debug(`Log serwera (${category}) nie zostal wyslany:`, error.message);
    return false;
  }
}

/** Czy zdarzenie jest wykluczone z logowania. */
function isIgnored(guild, context) {
  return logsRepo.isIgnored(guild.id, context);
}

/**
 * Szuka w dzienniku audytu osoby odpowiedzialnej za zdarzenie.
 * Wymaga uprawnienia "Wyswietlanie dziennika audytu" — bez niego zwraca null.
 */
async function findExecutor(guild, type, targetId, { maxAgeMs = 10_000 } = {}) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  if (!logs) return null;

  const entry = logs.entries.find(
    (item) =>
      (!targetId || item.target?.id === targetId) &&
      Date.now() - item.createdTimestamp < maxAgeMs,
  );

  if (!entry) return null;
  return { executor: entry.executor, reason: entry.reason ?? null };
}

/** Wiersz "Wykonal: ..." dopisywany do logu, gdy udalo sie ustalic sprawce. */
function executorField(executor) {
  if (!executor?.executor) return [];

  return [
    {
      name: 'Wykonal(a)',
      value: `${executor.executor} (\`${executor.executor.tag}\`)` + (executor.reason ? `\n> ${truncate(executor.reason, 200)}` : ''),
      inline: true,
    },
  ];
}

/** Skrocony opis uzytkownika uzywany w naglowkach logow. */
function describeUser(user) {
  return `${user} • \`${user.tag ?? user.username ?? user.id}\` (\`${user.id}\`)`;
}

/** Log operacji ekonomicznej (przelew, korekta, zakup). */
async function logEconomy(guild, { title, color = COLORS.clan, fields, footer }) {
  return send(guild, 'economy', { title, color, fields, footer });
}

module.exports = {
  CATEGORY_META,
  AuditLogEvent,
  send,
  isIgnored,
  findExecutor,
  executorField,
  describeUser,
  logEconomy,
  markBotAction,
  consumeBotAction,
  cleanupBotActions,
  resolveChannel,
  timestamp,
};
