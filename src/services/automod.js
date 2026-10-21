'use strict';

const { PermissionFlagsBits } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const moderation = require('../database/repositories/moderation');
const logger = require('../utils/logger');
const modlog = require('../utils/modlog');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { truncate } = require('../utils/format');

const INVITE_REGEX = /(?:discord\.(?:gg|io|me|li)|(?:discordapp|discord)\.com\/invite)\/[a-z0-9-_]+/i;
const LINK_REGEX = /https?:\/\/([^\s/?#]+)[^\s]*/gi;

/** Bufor wiadomosci na potrzeby wykrywania spamu: "guildId:userId" -> timestampy. */
const spamBuckets = new Map();

const REASONS = {
  invite: 'Zaproszenie na inny serwer Discord',
  link: 'Niedozwolony link',
  word: 'Niedozwolone slowo',
  spam: 'Spam (zbyt wiele wiadomosci)',
};

/**
 * Normalizuje tekst: male litery, bez polskich znakow i prostego leetspeaku.
 * Uwaga: "!" celowo nie jest zamieniane na "i" — to znak interpunkcyjny,
 * ktory musi pozostac granica slowa (inaczej "brzydkie!" nie zostaloby wykryte).
 */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0]/g, 'o')
    .replace(/[1|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/ł/g, 'l');
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Czy uzytkownik jest zwolniony z automoderacji. */
function isExempt(message, settings) {
  if (!message.member) return true;
  if (message.author.bot) return true;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return settings.automod_exempt_roles.some((roleId) => message.member.roles.cache.has(roleId));
}

/** Rejestruje wiadomosc w buforze antyspamowym i zwraca liczbe wiadomosci w oknie. */
function trackSpam(message, settings) {
  const key = `${message.guild.id}:${message.author.id}`;
  const windowMs = (settings.automod_spam_seconds ?? 5) * 1000;
  const now = Date.now();

  const timestamps = (spamBuckets.get(key) ?? []).filter((time) => now - time < windowMs);
  timestamps.push(now);
  spamBuckets.set(key, timestamps);

  return timestamps.length;
}

/** Sprawdza wiadomosc i zwraca { type, detail } przy naruszeniu albo null. */
function inspect(message, settings) {
  const content = message.content ?? '';

  if (settings.automod_invites && INVITE_REGEX.test(content)) {
    return { type: 'invite', detail: content.match(INVITE_REGEX)[0] };
  }

  if (settings.automod_links) {
    const whitelist = settings.automod_link_whitelist.map((entry) => entry.toLowerCase());
    for (const match of content.matchAll(LINK_REGEX)) {
      const hostname = hostnameOf(match[0]);
      if (!hostname) continue;
      const allowed = whitelist.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
      if (!allowed) return { type: 'link', detail: hostname };
    }
  }

  if (settings.automod_words) {
    const normalized = normalize(content);
    for (const word of moderation.listBlockedWords(message.guild.id)) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalize(word))}([^a-z0-9]|$)`, 'i');
      if (pattern.test(normalized)) return { type: 'word', detail: word };
    }
  }

  if (settings.automod_spam) {
    const count = trackSpam(message, settings);
    if (count >= (settings.automod_spam_messages ?? 5)) {
      spamBuckets.delete(`${message.guild.id}:${message.author.id}`);
      return { type: 'spam', detail: `${count} wiadomosci w ${settings.automod_spam_seconds}s` };
    }
  }

  return null;
}

/** Krotka informacja na kanale, kasowana automatycznie po kilku sekundach. */
async function notifyChannel(message, violation, action) {
  const container = panel({
    color: COLORS.warning,
    title: '🤖 Automoderacja',
    description: `${message.author}, Twoja wiadomosc zostala usunieta.`,
    fields: [
      { name: 'Powod', value: REASONS[violation.type], inline: true },
      { name: 'Akcja', value: action, inline: true },
    ],
  });

  const notice = await message.channel
    .send({ components: [container], flags: V2_FLAGS, allowedMentions: { users: [message.author.id] } })
    .catch(() => null);

  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);
}

/** Pelna obsluga naruszenia: usuniecie wiadomosci, kara i wpis do logow. */
async function handleViolation(message, violation, settings) {
  const reason = `${REASONS[violation.type]} (${truncate(violation.detail, 100)})`;

  await message.delete().catch(() => {});

  let actionLabel = 'usunieto wiadomosc';

  if (settings.automod_action === 'warn') {
    moderation.addWarning({
      guildId: message.guild.id,
      userId: message.author.id,
      moderatorId: message.client.user.id,
      reason: `[AUTO] ${reason}`,
    });
    actionLabel = 'ostrzezenie';
  } else if (settings.automod_action === 'timeout') {
    const minutes = settings.automod_timeout_minutes ?? 10;
    if (message.member?.moderatable) {
      await message.member.timeout(minutes * 60 * 1000, `[AUTO] ${reason}`).catch(() => {});
      actionLabel = `wyciszenie na ${minutes} min`;
    } else {
      actionLabel = 'usunieto wiadomosc (brak uprawnien do wyciszenia)';
    }
  }

  await notifyChannel(message, violation, actionLabel);

  await modlog.logAction(message.guild, {
    action: 'automod',
    user: message.author,
    moderator: null,
    reason,
    extraFields: [
      { name: 'Kanal', value: `${message.channel}`, inline: true },
      { name: 'Akcja', value: actionLabel, inline: true },
      { name: 'Tresc', value: truncate(message.content || '—', 500) },
    ],
  }).catch((error) => logger.warn('Automoderacja: nie udalo sie zapisac logu:', error.message));
}

/** Punkt wejscia wywolywany z eventu messageCreate. */
async function run(message) {
  if (!message.guild || message.author.bot || !message.content) return false;

  const settings = guilds.get(message.guild.id);
  if (!settings.automod_enabled) return false;
  if (isExempt(message, settings)) return false;

  const violation = inspect(message, settings);
  if (!violation) return false;

  await handleViolation(message, violation, settings);
  return true;
}

/** Czysci stare wpisy bufora antyspamowego (wywolywane cyklicznie). */
function cleanup() {
  const now = Date.now();
  for (const [key, timestamps] of spamBuckets) {
    const fresh = timestamps.filter((time) => now - time < 60_000);
    if (fresh.length === 0) spamBuckets.delete(key);
    else spamBuckets.set(key, fresh);
  }
}

module.exports = { run, inspect, normalize, cleanup, REASONS };
