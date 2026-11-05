'use strict';

const { PermissionFlagsBits } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const levelsRepo = require('../database/repositories/levels');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { canManageRole } = require('../utils/permissions');
const { formatNumber, plural, truncate } = require('../utils/format');
const logger = require('../utils/logger');

/** XP za wiadomosc: losowo 15-25, nie czesciej niz raz na minute. */
const MESSAGE_XP_MIN = 15;
const MESSAGE_XP_MAX = 25;
const MESSAGE_COOLDOWN_MS = 60 * 1000;
/** XP za kazda minute rozmowy na kanale glosowym. */
const VOICE_XP_PER_MINUTE = 10;
const MIN_MULTIPLIER = 0.1;
const MAX_MULTIPLIER = 10;
const LEADERBOARD_PAGE = 10;
/** Gorna granica poziomu (zabezpieczenie petli przy absurdalnym XP). */
const MAX_LEVEL = 1000;

// ----------------------------------------------------------------------------- matematyka

/** XP potrzebne, aby z poziomu `level` wejsc na `level + 1` (5l^2 + 50l + 100). */
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

/** Laczne XP potrzebne do osiagniecia poziomu `level` od zera. */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i += 1) total += xpForLevel(i);
  return total;
}

/** Rozklada calkowite XP na { level, current, needed, total }. */
function levelFromXp(xp) {
  let level = 0;
  let rest = Math.max(0, Math.floor(Number(xp) || 0));
  while (level < MAX_LEVEL && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level += 1;
  }
  return { level, current: rest, needed: xpForLevel(level), total: Math.max(0, Math.floor(Number(xp) || 0)) };
}

/** Losowa nagroda za wiadomosc z uwzglednieniem mnoznika. */
function rollMessageXp(multiplier = 1, random = Math.random) {
  const base = MESSAGE_XP_MIN + Math.floor(random() * (MESSAGE_XP_MAX - MESSAGE_XP_MIN + 1));
  return Math.max(1, Math.round(base * multiplier));
}

function voiceXp(multiplier = 1) {
  return Math.max(1, Math.round(VOICE_XP_PER_MINUTE * multiplier));
}

/** Tekstowy pasek postepu, np. "▰▰▰▱▱▱▱▱▱▱". */
function progressBar(current, needed, width = 14) {
  const ratio = needed > 0 ? Math.min(1, Math.max(0, current / needed)) : 0;
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

// ----------------------------------------------------------------------------- nagrody

/**
 * Wylicza, ktore role nadac i odebrac dla danego poziomu.
 * keepPrevious = true: wszystkie nagrody do poziomu wlacznie;
 * keepPrevious = false: tylko najwyzsza osiagnieta, pozostale nagrody zabieramy.
 */
function planRewards(rewards, level, keepPrevious, currentRoleIds = new Set()) {
  const reached = rewards.filter((reward) => reward.level <= level).sort((a, b) => a.level - b.level);
  const target = keepPrevious ? reached : reached.slice(-1);
  const targetIds = new Set(target.map((reward) => reward.role_id));

  const add = [...targetIds].filter((roleId) => !currentRoleIds.has(roleId));
  const remove = keepPrevious
    ? []
    : rewards
        .map((reward) => reward.role_id)
        .filter((roleId, index, all) => all.indexOf(roleId) === index)
        .filter((roleId) => !targetIds.has(roleId) && currentRoleIds.has(roleId));

  return { add, remove };
}

/** Nadaje/odbiera role nagrod. Pomija role, ktorymi bot nie moze zarzadzac. */
async function applyRewards(member, level) {
  const rewards = levelsRepo.listRewards(member.guild.id);
  if (rewards.length === 0) return { added: [], removed: [] };

  const settings = levelsRepo.getSettings(member.guild.id);
  const plan = planRewards(rewards, level, settings.keep_previous, new Set(member.roles.cache.keys()));
  const result = { added: [], removed: [] };

  for (const [list, method, target] of [
    [plan.add, 'add', result.added],
    [plan.remove, 'remove', result.removed],
  ]) {
    for (const roleId of list) {
      const role = member.guild.roles.cache.get(roleId);
      if (!role || !canManageRole(member.guild, role).ok) continue;
      try {
        await member.roles[method](role, `Nagroda za poziom ${level}`);
        target.push(role);
      } catch (error) {
        logger.debug(`Nie udalo sie ${method} roli ${roleId} (poziomy):`, error.message);
      }
    }
  }

  return result;
}

// ----------------------------------------------------------------------------- awans

function buildLevelUpPanel(member, level, rewardRoles = []) {
  return panel({
    color: COLORS.success,
    description:
      `🎉 ${member} awansuje na **poziom ${level}**!` +
      (rewardRoles.length ? `\nNagroda: ${rewardRoles.map((role) => `${role}`).join(', ')}` : ''),
  });
}

/** Wysyla gratulacje zgodnie z ustawieniami (ten sam kanal / staly kanal / wylaczone). */
async function announce(member, level, rewardRoles, fallbackChannel) {
  const settings = levelsRepo.getSettings(member.guild.id);
  if (settings.announce_mode === 'off') return;

  const channel =
    settings.announce_mode === 'channel'
      ? member.guild.channels.cache.get(settings.announce_channel_id)
      : fallbackChannel;
  if (!channel?.send) return;

  const me = member.guild.members.me;
  const permissions = me && channel.permissionsFor?.(me);
  if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) return;

  await channel
    .send({
      components: [buildLevelUpPanel(member, level, rewardRoles)],
      flags: V2_FLAGS,
      allowedMentions: { users: [member.id] },
    })
    .catch((error) => logger.debug('Nie udalo sie oglosic awansu:', error.message));
}

/** Zapisuje nowy poziom i obsluguje awans (role + ogloszenie). */
async function handleProgress(member, award, channel) {
  const { level } = levelFromXp(award.xp);
  if (level === award.level) return null;

  levelsRepo.setLevel(member.guild.id, member.id, level);
  if (level < award.level) return null;

  const { added } = await applyRewards(member, level);
  await announce(member, level, added, channel);
  return level;
}

/** XP za wiadomosc — wywolywane z messageCreate, niezaleznie od ekonomii. */
async function handleMessage(message) {
  if (!message.guild || !message.member || message.author.bot) return null;

  const settings = levelsRepo.getSettings(message.guild.id);
  if (!settings.enabled) return null;

  const amount = rollMessageXp(settings.multiplier);
  const award = levelsRepo.awardMessage(message.guild.id, message.author.id, amount, MESSAGE_COOLDOWN_MS);
  if (!award) return null;

  return handleProgress(message.member, award, message.channel);
}

/** Minuta XP dla osob na kanalach glosowych (te same zasady co nagrody ekonomii). */
function runVoiceTick(client) {
  // Leniwie, bo economy.js wywoluje te funkcje ze swojego timera.
  const { isEligibleVoiceState } = require('./economy');
  let awarded = 0;

  for (const guild of client.guilds.cache.values()) {
    const settings = levelsRepo.getSettings(guild.id);
    if (!settings.enabled) continue;

    const guildSettings = guilds.get(guild.id);
    const population = new Map();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || state.member?.user.bot) continue;
      population.set(state.channelId, (population.get(state.channelId) ?? 0) + 1);
    }

    for (const state of guild.voiceStates.cache.values()) {
      if (!isEligibleVoiceState(state, guildSettings, population)) continue;
      try {
        const award = levelsRepo.awardVoice(guild.id, state.id, voiceXp(settings.multiplier));
        awarded += 1;
        // Przy glosie nie ma "tego samego kanalu" — ogloszenie tylko na kanale ze stalych ustawien.
        handleProgress(state.member, award, null).catch((error) =>
          logger.debug(`Awans glosowy ${state.id}:`, error.message),
        );
      } catch (error) {
        logger.debug(`XP glosowe dla ${state.id} nie powiodlo sie:`, error.message);
      }
    }
  }

  return awarded;
}

// ----------------------------------------------------------------------------- widoki

/** Karta /poziom. */
function buildLevelCard(member) {
  const entry = levelsRepo.get(member.guild.id, member.id);
  const progress = levelFromXp(entry?.xp ?? 0);
  const rank = levelsRepo.rankOf(member.guild.id, member.id);
  const percent = Math.floor((progress.current / progress.needed) * 100);

  return panel({
    color: COLORS.clan,
    title: `⭐ Poziom — ${member.user.username}`,
    description: `${member}`,
    thumbnail: { url: member.displayAvatarURL({ size: 256 }), description: `Awatar ${member.user.username}` },
    fields: [
      { name: 'Poziom', value: `**${progress.level}**`, inline: true },
      { name: 'Ranking', value: rank ? `**#${rank.position}** z ${rank.total}` : 'brak (0 XP)', inline: true },
      { name: 'Laczne XP', value: formatNumber(progress.total), inline: true },
      {
        name: `Postep do poziomu ${progress.level + 1}`,
        value: `\`${progressBar(progress.current, progress.needed)}\` ${formatNumber(progress.current)} / ${formatNumber(progress.needed)} XP (${percent}%)`,
      },
      {
        name: 'Aktywnosc',
        value: `Wiadomosci z XP: **${formatNumber(entry?.messages ?? 0)}** • Minuty na glosowym: **${formatNumber(entry?.voice_minutes ?? 0)}**`,
      },
    ],
    footer: 'XP: 15-25 za wiadomosc (raz na minute) oraz za minute rozmowy na kanale glosowym.',
  });
}

/** Ranking poziomow (strony po 10). */
function buildLeaderboard(guild, page = 0) {
  const total = levelsRepo.countRanked(guild.id);
  const pages = Math.max(1, Math.ceil(total / LEADERBOARD_PAGE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const entries = levelsRepo.leaderboard(guild.id, { limit: LEADERBOARD_PAGE, offset: current * LEADERBOARD_PAGE });
  const medals = ['🥇', '🥈', '🥉'];

  const lines = entries.map((entry, index) => {
    const position = current * LEADERBOARD_PAGE + index + 1;
    const { level } = levelFromXp(entry.xp);
    return `${medals[position - 1] ?? `\`${position}.\``} <@${entry.user_id}> — poziom **${level}** • ${formatNumber(entry.xp)} XP`;
  });

  return panel({
    color: COLORS.clan,
    title: '🏆 Ranking poziomow',
    blocks: [lines.join('\n') || '*Nikt jeszcze nie zdobyl XP.*'],
    footer: `Strona ${current + 1}/${pages} • ${total} ${plural(total, 'osoba', 'osoby', 'osob')} w rankingu`,
  });
}

/** Krotkie pole do /profil (null, gdy poziomy sa wylaczone). */
function profileField(guildId, userId) {
  const settings = levelsRepo.getSettings(guildId);
  if (!settings.enabled) return null;
  const entry = levelsRepo.get(guildId, userId);
  const progress = levelFromXp(entry?.xp ?? 0);
  return {
    name: 'Poziom',
    value: `**${progress.level}** (${formatNumber(progress.current)}/${formatNumber(progress.needed)} XP)`,
    inline: true,
  };
}

/** Opis ustawien poziomow dla /poziomy ustaw. */
function describeSettings(guild) {
  const settings = levelsRepo.getSettings(guild.id);
  const announce = {
    same: 'na kanale, na ktorym padl awans',
    channel: settings.announce_channel_id ? `na kanale <#${settings.announce_channel_id}>` : 'kanal nieustawiony!',
    off: 'wylaczone',
  }[settings.announce_mode];

  return [
    { name: 'Status', value: settings.enabled ? '✅ wlaczone' : '⛔ wylaczone', inline: true },
    { name: 'Mnoznik XP', value: `x${settings.multiplier}`, inline: true },
    { name: 'Ogloszenia awansu', value: announce, inline: true },
    {
      name: 'Nagrody',
      value: settings.keep_previous ? 'kumuluja sie (zostaja poprzednie role)' : 'tylko najwyzsza (poprzednie sa zdejmowane)',
      inline: true,
    },
  ];
}

/** Lista nagrod do /poziomy nagroda lista. */
function describeRewards(guild) {
  const rewards = levelsRepo.listRewards(guild.id);
  if (rewards.length === 0) return '*Brak nagrod. Dodaj je komenda `/poziomy nagroda dodaj`.*';
  return rewards
    .map((reward) => {
      const role = guild.roles.cache.get(reward.role_id);
      return `Poziom **${reward.level}** → ${role ? `${role}` : `⚠️ rola usunieta (\`${truncate(reward.role_id, 25)}\`)`}`;
    })
    .join('\n');
}

module.exports = {
  MESSAGE_XP_MIN,
  MESSAGE_XP_MAX,
  MESSAGE_COOLDOWN_MS,
  VOICE_XP_PER_MINUTE,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
  xpForLevel,
  totalXpForLevel,
  levelFromXp,
  rollMessageXp,
  voiceXp,
  progressBar,
  planRewards,
  applyRewards,
  announce,
  handleProgress,
  handleMessage,
  runVoiceTick,
  buildLevelCard,
  buildLeaderboard,
  buildLevelUpPanel,
  profileField,
  describeSettings,
  describeRewards,
};
