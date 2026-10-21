'use strict';

const { ChannelType, PermissionFlagsBits: Flags } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const rolesRepo = require('../database/repositories/roles');
const logsRepo = require('../database/repositories/logs');
const recruitment = require('../database/repositories/recruitment');
const recruitmentService = require('./recruitment');
const logger = require('../utils/logger');
const { V2_FLAGS } = require('../ui/components');

/**
 * Schemat struktury klanu tworzonej przez /setup.
 * `level` = pozycja w hierarchii (1 = najnizszy stopien klanowy).
 */
const ROLE_PLAN = [
  { key: 'guest', name: 'Gosc', color: 0x95a5a6, level: null, hoist: false },
  { key: 'recruit', name: 'Rekrut', color: 0x3498db, level: 1, hoist: true },
  { key: 'member', name: 'Czlonek', color: 0x2ecc71, level: 2, hoist: true },
  { key: 'veteran', name: 'Weteran', color: 0xe67e22, level: 3, hoist: true },
  { key: 'officer', name: 'Officer', color: 0x9b59b6, level: 4, hoist: true },
];

const CATEGORY_PLAN = [
  {
    key: 'clan',
    name: '🏰 KLAN',
    minLevel: 2, // od rangi Czlonek
    channels: [
      { key: 'announcements', name: 'ogloszenia-klanu', type: 'text', readOnlyBelow: 4 },
      { key: 'welcome', name: 'powitania', type: 'text' },
      { key: 'chat', name: 'czat-klanowy', type: 'text' },
      { key: 'veterans', name: 'weterani', type: 'text', minLevel: 3 },
      { key: 'voice', name: 'Klan — rozmowy', type: 'voice' },
    ],
  },
  {
    key: 'recruitment',
    name: '📋 REKRUTACJA',
    public: true,
    channels: [{ key: 'apply', name: 'rekrutacja', type: 'text', readOnlyBelow: 5 }],
  },
  {
    key: 'staff',
    name: '🛡️ ADMINISTRACJA',
    minLevel: 4, // tylko Officer
    channels: [
      { key: 'applications', name: 'zgloszenia', type: 'text' },
      { key: 'modlog', name: 'logi-moderacji', type: 'text' },
      { key: 'serverlog', name: 'logi-serwera', type: 'text' },
      { key: 'staffchat', name: 'czat-kadry', type: 'text' },
    ],
  },
];

/** Opis planu pokazywany przed uruchomieniem /setup. */
function describePlan(guild) {
  const existingRoles = ROLE_PLAN.map((role) => {
    const found = findRole(guild, role.name);
    return `${found ? '♻️' : '🆕'} **${role.name}**${role.level ? ` *(poziom ${role.level})*` : ' *(rola startowa)*'}`;
  });

  const channels = CATEGORY_PLAN.map((category) => {
    const found = findChannel(guild, category.name, ChannelType.GuildCategory);
    const list = category.channels
      .map((channel) => ` ${channel.type === 'voice' ? '🔊' : '#'}${channel.name}`)
      .join('\n');
    return `${found ? '♻️' : '🆕'} **${category.name}**\n${list}`;
  });

  return { roles: existingRoles, channels };
}

function findRole(guild, name) {
  return guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase() && !role.managed);
}

function findChannel(guild, name, type) {
  const normalized = name.toLowerCase().replace(/\s+/g, '-');
  return guild.channels.cache.find(
    (channel) =>
      channel.type === type &&
      (channel.name.toLowerCase() === name.toLowerCase() || channel.name.toLowerCase() === normalized),
  );
}

/** Tworzy (lub znajduje) role klanowe i zapisuje hierarchie w bazie. */
async function ensureRoles(guild, summary) {
  const created = {};

  for (const plan of ROLE_PLAN) {
    let role = findRole(guild, plan.name);

    if (role) {
      summary.push(`♻️ Uzyto istniejacej roli **${role.name}**`);
    } else {
      role = await guild.roles.create({
        name: plan.name,
        color: plan.color,
        hoist: plan.hoist,
        mentionable: false,
        reason: 'Struktura klanu tworzona przez /setup',
      });
      summary.push(`🆕 Utworzono role **${role.name}**`);
    }

    created[plan.key] = role;
    if (plan.level) {
      rolesRepo.set(guild.id, { roleId: role.id, level: plan.level, name: role.name });
    }
  }

  // Kolejnosc rol: Officer najwyzej, Gosc najnizej (w granicach roli bota).
  const me = guild.members.me;
  const ordered = [...ROLE_PLAN].reverse().map((plan) => created[plan.key]);
  const basePosition = Math.max(1, me.roles.highest.position - ordered.length - 1);

  try {
    await guild.roles.setPositions(
      ordered.map((role, index) => ({ role, position: basePosition + (ordered.length - index) })),
    );
    summary.push('✅ Ustawiono kolejnosc rol w hierarchii serwera');
  } catch (error) {
    logger.debug('Nie udalo sie ustawic pozycji rol:', error.message);
    summary.push('⚠️ Nie udalo sie ustawic kolejnosci rol — przesun role recznie (rola bota musi byc najwyzej)');
  }

  return created;
}

/** Buduje permission overwrites dla kanalu wg wymaganego poziomu hierarchii. */
function buildOverwrites(guild, createdRoles, { minLevel, readOnlyBelow, isPublic }) {
  const everyone = guild.roles.everyone;
  const overwrites = [];

  if (isPublic) {
    overwrites.push({ id: everyone.id, allow: [Flags.ViewChannel], deny: [Flags.SendMessages] });
  } else {
    overwrites.push({ id: everyone.id, deny: [Flags.ViewChannel] });
  }

  for (const plan of ROLE_PLAN) {
    if (!plan.level) continue;
    const role = createdRoles[plan.key];
    if (!role) continue;

    if (minLevel && plan.level < minLevel) continue;

    const allow = [Flags.ViewChannel, Flags.ReadMessageHistory];
    const deny = [];

    if (readOnlyBelow && plan.level < readOnlyBelow) deny.push(Flags.SendMessages);
    else allow.push(Flags.SendMessages, Flags.AddReactions);

    overwrites.push({ id: role.id, allow, deny });
  }

  // Bot zawsze musi widziec i pisac na tworzonych kanalach.
  overwrites.push({
    id: guild.members.me.id,
    allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.ManageMessages],
  });

  return overwrites;
}

/** Tworzy kategorie i kanaly wraz z uprawnieniami. */
async function ensureChannels(guild, createdRoles, summary) {
  const channels = {};

  for (const categoryPlan of CATEGORY_PLAN) {
    let category = findChannel(guild, categoryPlan.name, ChannelType.GuildCategory);

    const categoryOverwrites = buildOverwrites(guild, createdRoles, {
      minLevel: categoryPlan.minLevel,
      isPublic: categoryPlan.public,
      readOnlyBelow: categoryPlan.public ? 5 : undefined,
    });

    if (category) {
      await category.permissionOverwrites.set(categoryOverwrites, 'Aktualizacja uprawnien przez /setup').catch(() => {});
      summary.push(`♻️ Zaktualizowano uprawnienia kategorii **${category.name}**`);
    } else {
      category = await guild.channels.create({
        name: categoryPlan.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: categoryOverwrites,
        reason: 'Struktura klanu tworzona przez /setup',
      });
      summary.push(`🆕 Utworzono kategorie **${category.name}**`);
    }

    for (const channelPlan of categoryPlan.channels) {
      const type = channelPlan.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      let channel = findChannel(guild, channelPlan.name, type);

      const overwrites = buildOverwrites(guild, createdRoles, {
        minLevel: channelPlan.minLevel ?? categoryPlan.minLevel,
        readOnlyBelow: channelPlan.readOnlyBelow,
        isPublic: categoryPlan.public,
      });

      if (channel) {
        await channel.permissionOverwrites.set(overwrites, 'Aktualizacja uprawnien przez /setup').catch(() => {});
        if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
        summary.push(`♻️ Zaktualizowano kanal **${channel.name}**`);
      } else {
        channel = await guild.channels.create({
          name: channelPlan.name,
          type,
          parent: category.id,
          permissionOverwrites: overwrites,
          reason: 'Struktura klanu tworzona przez /setup',
        });
        summary.push(`🆕 Utworzono kanal **${channel.name}**`);
      }

      channels[channelPlan.key] = channel;
    }
  }

  return channels;
}

/**
 * Pelna konfiguracja serwera: role, kanaly, uprawnienia, ustawienia w bazie
 * oraz opublikowanie panelu rekrutacji.
 */
async function run(guild) {
  const summary = [];

  const createdRoles = await ensureRoles(guild, summary);
  const channels = await ensureChannels(guild, createdRoles, summary);

  guilds.update(guild.id, {
    guest_role_id: createdRoles.guest.id,
    member_role_id: createdRoles.member.id,
    applications_channel_id: channels.applications?.id ?? null,
    modlog_channel_id: channels.modlog?.id ?? null,
    welcome_channel_id: channels.welcome?.id ?? null,
    recruitment_enabled: true,
  });
  summary.push('✅ Zapisano ustawienia serwera (role, kanal zgloszen, logi, powitania)');

  if (channels.serverlog) {
    logsRepo.setAll(guild.id, channels.serverlog.id);
    summary.push('✅ Wlaczono logi zdarzen serwera (wszystkie kategorie na #logi-serwera)');
  }

  if (recruitment.countQuestions(guild.id, 'applicant') === 0) {
    const created = recruitment.seedDefaultQuestions(guild.id, 'applicant');
    summary.push(`✅ Dodano domyslny formularz kandydata (**${created.length}** pytan)`);
  }

  if (recruitment.countQuestions(guild.id, 'reviewer') === 0) {
    const created = recruitment.seedDefaultQuestions(guild.id, 'reviewer');
    summary.push(`✅ Dodano domyslna ankiete rekrutera (**${created.length}** pytan, widoczna tylko dla administracji)`);
  }

  if (channels.apply) {
    try {
      const message = await channels.apply.send({
        components: [recruitmentService.buildRecruitmentPanel(guild)],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      summary.push(`✅ Opublikowano panel rekrutacji: ${message.url}`);
    } catch (error) {
      summary.push(`⚠️ Nie udalo sie opublikowac panelu rekrutacji: ${error.message}`);
    }
  }

  return summary;
}

module.exports = { run, describePlan, ROLE_PLAN, CATEGORY_PLAN };
