'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const levelsRepo = require('../src/database/repositories/levels');
const rolePanelsRepo = require('../src/database/repositories/rolePanels');
const suggestionsRepo = require('../src/database/repositories/suggestions');
const levels = require('../src/services/levels');
const rolePanels = require('../src/services/rolePanels');
const suggestions = require('../src/services/suggestions');
const pomoc = require('../src/commands/general/pomoc');
const { createUser, createMember, createGuild, createInteraction } = require('./helpers/interaction');

const GUILD = 'guild-community';

/** Limity Discorda dla wiadomosci Components V2. */
const MAX_COMPONENTS = 40;
const MAX_CHARACTERS = 4000;

function audit(container) {
  const json = container.toJSON();
  let components = 0;
  let characters = 0;
  let maxButtonsInRow = 0;

  const walk = (node) => {
    components += 1;
    if (node.content) characters += node.content.length;
    if (node.type === 1) maxButtonsInRow = Math.max(maxButtonsInRow, (node.components ?? []).length);
    if (node.accessory) walk(node.accessory);
    for (const child of node.components ?? []) walk(child);
  };

  walk(json);
  return { json, components, characters, maxButtonsInRow };
}

function assertWithinLimits(container) {
  const result = audit(container);
  assert.ok(result.components <= MAX_COMPONENTS, `${result.components} komponentow`);
  assert.ok(result.characters <= MAX_CHARACTERS, `${result.characters} znakow`);
  assert.ok(result.maxButtonsInRow <= 5, `${result.maxButtonsInRow} przyciskow w wierszu`);
  return result;
}

/** Atrapa roli discord.js z prawdziwym PermissionsBitField. */
function fakeRole(id, { position = 5, managed = false, permissions = [] } = {}) {
  return {
    id,
    name: `rola-${id}`,
    position,
    managed,
    permissions: new PermissionsBitField(permissions),
    toString: () => `<@&${id}>`,
  };
}

/** Atrapa serwera z rolami i czlonkiem, ktory naprawde zmienia role. */
function roleGuild(roles) {
  const guild = {
    id: GUILD,
    name: 'Klan Testowy',
    roles: { cache: new Map(roles.map((role) => [role.id, role])), everyone: { id: 'everyone' } },
    channels: { cache: new Map() },
    members: { me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 50 } } } },
  };
  return guild;
}

function roleMember(guild, roleIds = []) {
  const cache = new Map(roleIds.map((id) => [id, guild.roles.cache.get(id) ?? { id }]));
  return {
    id: 'member-1',
    guild,
    user: { id: 'member-1', username: 'gracz', bot: false },
    roles: {
      cache,
      add: async (role) => cache.set(role.id, role),
      remove: async (role) => cache.delete(role.id),
    },
    toString: () => '<@member-1>',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
}

before(() => database.init());

describe('poziomy — matematyka', () => {
  it('krzywa 5l^2 + 50l + 100', () => {
    assert.equal(levels.xpForLevel(0), 100);
    assert.equal(levels.xpForLevel(1), 155);
    assert.equal(levels.xpForLevel(10), 1100);
    assert.equal(levels.totalXpForLevel(0), 0);
    assert.equal(levels.totalXpForLevel(2), 255);
  });

  it('rozklada XP na poziom i postep', () => {
    assert.deepEqual(levels.levelFromXp(0), { level: 0, current: 0, needed: 100, total: 0 });
    assert.deepEqual(levels.levelFromXp(99), { level: 0, current: 99, needed: 100, total: 99 });
    assert.deepEqual(levels.levelFromXp(100), { level: 1, current: 0, needed: 155, total: 100 });
    assert.deepEqual(levels.levelFromXp(254), { level: 1, current: 154, needed: 155, total: 254 });
    assert.equal(levels.levelFromXp(255).level, 2);
    assert.equal(levels.levelFromXp(-50).level, 0);

    for (const level of [3, 7, 25, 60]) {
      assert.equal(levels.levelFromXp(levels.totalXpForLevel(level)).level, level);
      assert.equal(levels.levelFromXp(levels.totalXpForLevel(level) - 1).level, level - 1);
    }
  });

  it('XP za wiadomosc miesci sie w 15-25 i uwzglednia mnoznik', () => {
    assert.equal(levels.rollMessageXp(1, () => 0), 15);
    assert.equal(levels.rollMessageXp(1, () => 0.9999), 25);
    assert.equal(levels.rollMessageXp(2, () => 0), 30);
    assert.equal(levels.rollMessageXp(0.1, () => 0), 2);
    for (let i = 0; i < 200; i += 1) {
      const xp = levels.rollMessageXp();
      assert.ok(xp >= 15 && xp <= 25, `${xp} poza zakresem`);
    }
    assert.equal(levels.voiceXp(1.5), 15);
  });

  it('pasek postepu ma stala szerokosc', () => {
    assert.equal(levels.progressBar(0, 100, 10), '▱'.repeat(10));
    assert.equal(levels.progressBar(50, 100, 10), '▰'.repeat(5) + '▱'.repeat(5));
    assert.equal(levels.progressBar(500, 100, 10), '▰'.repeat(10));
  });

  it('planuje nagrody kumulowane i tylko-najwyzsza', () => {
    const rewards = [
      { level: 5, role_id: 'r5' },
      { level: 10, role_id: 'r10' },
      { level: 20, role_id: 'r20' },
    ];

    assert.deepEqual(levels.planRewards(rewards, 12, true, new Set(['r5'])), { add: ['r10'], remove: [] });
    assert.deepEqual(levels.planRewards(rewards, 12, false, new Set(['r5', 'inna'])), { add: ['r10'], remove: ['r5'] });
    assert.deepEqual(levels.planRewards(rewards, 3, false, new Set()), { add: [], remove: [] });
  });
});

describe('poziomy — repozytorium', () => {
  beforeEach(() => {
    levelsRepo.resetGuild(GUILD);
    levelsRepo.updateSettings(GUILD, { enabled: true, announceMode: 'same', multiplier: 1, keepPrevious: true });
    for (const reward of levelsRepo.listRewards(GUILD)) levelsRepo.removeReward(GUILD, reward.level);
  });

  it('cooldown XP za wiadomosci', () => {
    const now = 1_000_000;
    assert.deepEqual(levelsRepo.awardMessage(GUILD, 'a', 20, 60_000, now), { previousXp: 0, xp: 20, level: 0 });
    assert.equal(levelsRepo.awardMessage(GUILD, 'a', 20, 60_000, now + 30_000), null, 'w trakcie cooldownu');
    assert.equal(levelsRepo.awardMessage(GUILD, 'a', 15, 60_000, now + 60_000).xp, 35);
    assert.equal(levelsRepo.get(GUILD, 'a').messages, 2);
  });

  it('XP glosowe nie podlega cooldownowi wiadomosci', () => {
    levelsRepo.awardMessage(GUILD, 'v', 20, 60_000);
    levelsRepo.awardVoice(GUILD, 'v', 10);
    levelsRepo.awardVoice(GUILD, 'v', 10);
    const entry = levelsRepo.get(GUILD, 'v');
    assert.equal(entry.xp, 40);
    assert.equal(entry.voice_minutes, 2);
  });

  it('ranking i pozycja', () => {
    levelsRepo.awardVoice(GUILD, 'x', 300);
    levelsRepo.awardVoice(GUILD, 'y', 100);
    levelsRepo.awardVoice(GUILD, 'z', 200);

    assert.deepEqual(levelsRepo.leaderboard(GUILD).map((entry) => entry.user_id), ['x', 'z', 'y']);
    assert.equal(levelsRepo.rankOf(GUILD, 'y').position, 3);
    assert.equal(levelsRepo.rankOf(GUILD, 'y').total, 3);
    assert.equal(levelsRepo.rankOf(GUILD, 'nikt'), null);
  });

  it('ustawienia i nagrody', () => {
    const settings = levelsRepo.updateSettings(GUILD, { multiplier: 1.5, announceMode: 'off', keepPrevious: false });
    assert.equal(settings.multiplier, 1.5);
    assert.equal(settings.announce_mode, 'off');
    assert.equal(settings.keep_previous, false);

    levelsRepo.setReward(GUILD, 10, 'r1');
    levelsRepo.setReward(GUILD, 5, 'r2');
    levelsRepo.setReward(GUILD, 10, 'r3');
    assert.deepEqual(levelsRepo.listRewards(GUILD).map((reward) => [reward.level, reward.role_id]), [[5, 'r2'], [10, 'r3']]);
    assert.equal(levelsRepo.removeReward(GUILD, 5), true);
    assert.equal(levelsRepo.removeReward(GUILD, 5), false);
  });
});

describe('poziomy — wiadomosci i awans', () => {
  beforeEach(() => {
    levelsRepo.resetGuild(GUILD);
    levelsRepo.updateSettings(GUILD, { enabled: true, announceMode: 'same', multiplier: 1, keepPrevious: false });
    for (const reward of levelsRepo.listRewards(GUILD)) levelsRepo.removeReward(GUILD, reward.level);
    guilds.update(GUILD, { economy_enabled: false });
  });

  function fakeMessage(member) {
    const sent = [];
    return {
      sent,
      guild: member.guild,
      member,
      author: { id: member.id, bot: false },
      channel: { send: async (payload) => sent.push(payload) },
    };
  }

  it('nalicza XP przy wylaczonej ekonomii, awansuje i nadaje nagrode', async () => {
    const r1 = fakeRole('lvl1');
    const old = fakeRole('lvl0');
    const guild = roleGuild([r1, old]);
    const member = roleMember(guild, ['lvl0']);
    levelsRepo.setReward(GUILD, 0, 'lvl0');
    levelsRepo.setReward(GUILD, 1, 'lvl1');

    // 90 XP na start — kolejna wiadomosc (15-25) da awans na poziom 1.
    levelsRepo.awardVoice(GUILD, member.id, 90);
    const message = fakeMessage(member);
    const level = await levels.handleMessage(message);

    assert.equal(level, 1);
    assert.equal(levelsRepo.get(GUILD, member.id).level, 1);
    assert.ok(member.roles.cache.has('lvl1'), 'nadano role nagrody');
    assert.ok(!member.roles.cache.has('lvl0'), 'zdjeto poprzednia nagrode (keep_previous = false)');
    assert.equal(message.sent.length, 1, 'ogloszenie na tym samym kanale');
    assert.ok(JSON.stringify(message.sent[0].components[0].toJSON()).includes('poziom 1'));

    // Druga wiadomosc w trakcie cooldownu nic nie daje.
    assert.equal(await levels.handleMessage(fakeMessage(member)), null);
  });

  it('nic nie robi, gdy poziomy sa wylaczone', async () => {
    levelsRepo.updateSettings(GUILD, { enabled: false });
    const guild = roleGuild([]);
    const member = roleMember(guild);
    assert.equal(await levels.handleMessage(fakeMessage(member)), null);
    assert.equal(levelsRepo.get(GUILD, member.id), null);
  });

  it('pole w /profil pokazuje poziom', () => {
    levelsRepo.awardVoice(GUILD, 'p', 300);
    const field = levels.profileField(GUILD, 'p');
    assert.equal(field.name, 'Poziom');
    assert.ok(field.value.startsWith('**2**'));
  });
});

describe('panele rol — bezpieczenstwo', () => {
  it('odrzuca role z niebezpiecznymi uprawnieniami', () => {
    const guild = roleGuild([]);
    for (const flag of [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MentionEveryone,
    ]) {
      const result = rolePanels.checkRoleSafety(guild, fakeRole('zla', { permissions: [flag] }));
      assert.equal(result.ok, false, `uprawnienie ${flag} powinno blokowac`);
      assert.match(result.reason, /niebezpieczne/);
    }
  });

  it('odrzuca role zarzadzane i wyzsze od bota', () => {
    const guild = roleGuild([]);
    assert.equal(rolePanels.checkRoleSafety(guild, fakeRole('bot-rola', { managed: true })).ok, false);
    assert.equal(rolePanels.checkRoleSafety(guild, fakeRole('wysoka', { position: 60 })).ok, false);
    assert.equal(rolePanels.checkRoleSafety(guild, null).ok, false);
  });

  it('akceptuje zwykla role kosmetyczna', () => {
    const guild = roleGuild([]);
    const role = fakeRole('kolor', { permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] });
    assert.deepEqual(rolePanels.checkRoleSafety(guild, role), { ok: true });
  });

  it('waliduje emoji', () => {
    assert.ok(rolePanels.isValidEmoji('🎮'));
    assert.ok(rolePanels.isValidEmoji('<:pepe:123456789012345678>'));
    assert.ok(rolePanels.isValidEmoji(null));
    assert.ok(!rolePanels.isValidEmoji('abc'));
    assert.ok(!rolePanels.isValidEmoji('🎮 tekst'));
  });
});

describe('panele rol — repozytorium i przelaczanie', () => {
  it('dodaje, aktualizuje i kasuje wpisy (z kaskada)', () => {
    const created = rolePanelsRepo.create({ guildId: GUILD, title: 'Gry', mode: 'single', createdBy: 'admin' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'a', label: 'A', emoji: '🅰️' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'b', label: 'B' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'a', label: 'A2', emoji: null });

    const loaded = rolePanelsRepo.getForGuild(GUILD, created.id);
    assert.equal(loaded.mode, 'single');
    assert.deepEqual(loaded.entries.map((entry) => [entry.role_id, entry.label]), [['a', 'A2'], ['b', 'B']]);
    assert.equal(rolePanelsRepo.getForGuild('inny-serwer', created.id), null);

    assert.equal(rolePanelsRepo.removeEntry(created.id, 'b'), true);
    assert.equal(rolePanelsRepo.remove(created.id), true);
    const orphans = database.getDb().prepare('SELECT COUNT(*) AS c FROM role_panel_entries WHERE panel_id = ?').get(created.id).c;
    assert.equal(orphans, 0);
  });

  it('tryb single zdejmuje inne role panelu, ponowne klikniecie zdejmuje role', async () => {
    const red = fakeRole('red');
    const blue = fakeRole('blue');
    const guild = roleGuild([red, blue]);
    const member = roleMember(guild, ['red']);

    const created = rolePanelsRepo.create({ guildId: GUILD, title: 'Kolory', mode: 'single', createdBy: 'admin' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'red', label: 'Czerwony' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'blue', label: 'Niebieski' });
    const rolePanel = rolePanelsRepo.get(created.id);

    const added = await rolePanels.toggleRole(member, rolePanel, 'blue');
    assert.equal(added.action, 'added');
    assert.deepEqual(added.removed.map((role) => role.id), ['red']);
    assert.deepEqual([...member.roles.cache.keys()], ['blue']);

    const removed = await rolePanels.toggleRole(member, rolePanel, 'blue');
    assert.equal(removed.action, 'removed');
    assert.equal(member.roles.cache.size, 0);

    assert.equal((await rolePanels.toggleRole(member, rolePanel, 'nie-ma')).ok, false);
  });

  it('odmawia przy kliknieciu, gdy rola zyskala niebezpieczne uprawnienia', async () => {
    const role = fakeRole('zmieniona', { permissions: [PermissionFlagsBits.BanMembers] });
    const guild = roleGuild([role]);
    const member = roleMember(guild);
    const created = rolePanelsRepo.create({ guildId: GUILD, title: 'X', createdBy: 'admin' });
    rolePanelsRepo.addEntry(created.id, { roleId: 'zmieniona', label: 'Z' });

    const outcome = await rolePanels.toggleRole(member, rolePanelsRepo.get(created.id), 'zmieniona');
    assert.equal(outcome.ok, false);
    assert.equal(member.roles.cache.size, 0);
  });
});

describe('propozycje — glosy', () => {
  it('jeden glos na osobe, zmiana i wycofanie', () => {
    const suggestion = suggestionsRepo.create({ guildId: GUILD, channelId: 'c', authorId: 'autor', content: 'Dodajmy kanal z memami' });

    assert.equal(suggestionsRepo.vote(suggestion.id, 'u1', 1), 'added');
    assert.equal(suggestionsRepo.vote(suggestion.id, 'u2', 1), 'added');
    assert.equal(suggestionsRepo.vote(suggestion.id, 'u3', -1), 'added');
    assert.deepEqual(suggestionsRepo.counts(suggestion.id), { up: 2, down: 1 });

    assert.equal(suggestionsRepo.vote(suggestion.id, 'u1', -1), 'changed');
    assert.deepEqual(suggestionsRepo.counts(suggestion.id), { up: 1, down: 2 });

    assert.equal(suggestionsRepo.vote(suggestion.id, 'u3', -1), 'removed');
    assert.deepEqual(suggestionsRepo.counts(suggestion.id), { up: 1, down: 1 });

    assert.throws(() => suggestionsRepo.vote(suggestion.id, 'u4', 0));
  });

  it('status zamyka glosowanie i trafia na karte', () => {
    const suggestion = suggestionsRepo.create({ guildId: GUILD, channelId: 'c', authorId: 'autor', content: 'Turniej co miesiac' });
    assert.ok(suggestions.isOpen(suggestion));

    const inProgress = suggestionsRepo.setStatus(suggestion.id, { status: 'in_progress', moderatorId: 'admin' });
    assert.ok(suggestions.isOpen(inProgress));

    const rejected = suggestionsRepo.setStatus(suggestion.id, { status: 'rejected', reason: 'Za malo osob', moderatorId: 'admin' });
    assert.ok(!suggestions.isOpen(rejected));
    const json = JSON.stringify(suggestions.buildCard(rejected).toJSON());
    assert.ok(json.includes('Za malo osob'));
    assert.ok(json.includes('"disabled":true'), 'przyciski wylaczone po decyzji');
    assert.throws(() => suggestionsRepo.setStatus(suggestion.id, { status: 'cos' }));
  });

  it('kanal propozycji', () => {
    suggestionsRepo.setChannel(GUILD, 'kanal-1');
    assert.equal(suggestionsRepo.getChannel(GUILD), 'kanal-1');
    suggestionsRepo.setChannel(GUILD, null);
    assert.equal(suggestionsRepo.getChannel(GUILD), null);
  });
});

describe('spolecznosc — limity Components V2', () => {
  it('panel z maksymalna liczba rol', () => {
    const roles = Array.from({ length: rolePanels.MAX_ROLES }, (_, index) => fakeRole(`r${index}`));
    const guild = roleGuild(roles);
    const rolePanel = {
      id: 1,
      title: 'T'.repeat(100),
      description: 'Opis '.repeat(200),
      mode: 'multi',
      entries: roles.map((role) => ({ role_id: role.id, label: 'Etykieta'.repeat(10), emoji: '🎮' })),
    };
    const { maxButtonsInRow } = assertWithinLimits(rolePanels.buildPanel(guild, rolePanel));
    assert.equal(maxButtonsInRow, 5);
  });

  it('karta propozycji z maksymalna trescia i powodem', () => {
    const suggestion = suggestionsRepo.create({
      guildId: GUILD,
      channelId: 'c',
      authorId: 'autor',
      content: 'x'.repeat(suggestions.MAX_CONTENT),
    });
    const decided = suggestionsRepo.setStatus(suggestion.id, { status: 'accepted', reason: 'y'.repeat(500), moderatorId: 'admin' });
    assertWithinLimits(suggestions.buildCard(decided));
    assertWithinLimits(suggestions.buildStatusDm({ name: 'Klan' }, decided));
  });

  it('karta poziomu, ranking i ogloszenie awansu', () => {
    levelsRepo.resetGuild(GUILD);
    for (let i = 0; i < 15; i += 1) levelsRepo.awardVoice(GUILD, `user-${i}`, 1000 * (i + 1));
    const guild = roleGuild([]);
    const member = roleMember(guild);
    levelsRepo.awardVoice(GUILD, member.id, 5000);

    assertWithinLimits(levels.buildLevelCard(member));
    assertWithinLimits(levels.buildLeaderboard(guild, 0));
    assertWithinLimits(levels.buildLeaderboard(guild, 99));
    assertWithinLimits(levels.buildLevelUpPanel(member, 10, [fakeRole('a')]));
  });

  it('/pomoc z nowa sekcja miesci sie w limitach', async () => {
    const user = createUser('pomoc-1');
    const members = new Map();
    const guild = createGuild(GUILD, { members });
    const member = createMember(user, { guild });
    members.set(member.id, member);

    const interaction = createInteraction({ guild, member });
    await pomoc.execute(interaction);
    const [container] = interaction.replies[0].components;
    const { json } = assertWithinLimits(container);
    assert.ok(JSON.stringify(json).includes('/role-panel'));
  });
});

describe('spolecznosc — komendy', () => {
  const poziomy = require('../src/commands/community/poziomy');
  const rolePanelCommand = require('../src/commands/community/role-panel');

  function setup({ admin }) {
    const members = new Map();
    const guild = createGuild(GUILD, { members });
    const member = createMember(createUser(admin ? 'cmd-admin' : 'cmd-user'), { guild, admin });
    members.set(member.id, member);
    return { guild, member };
  }

  it('/poziomy ustaw zapisuje ustawienia tylko dla admina', async () => {
    levelsRepo.updateSettings(GUILD, { enabled: true, announceMode: 'same' });

    const user = setup({ admin: false });
    const denied = createInteraction({ ...user, subcommand: 'ustaw', options: [{ name: 'wlaczone', type: 'boolean', value: false }] });
    await poziomy.execute(denied);
    assert.equal(levelsRepo.getSettings(GUILD).enabled, true);

    const admin = setup({ admin: true });
    const allowed = createInteraction({
      ...admin,
      subcommand: 'ustaw',
      options: [
        { name: 'wlaczone', type: 'boolean', value: false },
        { name: 'ogloszenia', type: 'string', value: 'off' },
      ],
    });
    await poziomy.execute(allowed);
    const settings = levelsRepo.getSettings(GUILD);
    assert.equal(settings.enabled, false);
    assert.equal(settings.announce_mode, 'off');
    levelsRepo.updateSettings(GUILD, { enabled: true, announceMode: 'same' });
  });

  it('/role-panel dodaj odrzuca role z uprawnieniem Administrator', async () => {
    const admin = setup({ admin: true });
    const created = rolePanelsRepo.create({ guildId: GUILD, title: 'Bezpieczny', createdBy: 'admin' });
    const role = fakeRole('admin-rola', { permissions: [PermissionFlagsBits.Administrator] });

    const interaction = createInteraction({
      ...admin,
      subcommand: 'dodaj',
      options: [
        { name: 'panel', type: 'integer', value: created.id },
        { name: 'rola', type: 'role', value: role },
      ],
    });
    await rolePanelCommand.execute(interaction);
    assert.equal(rolePanelsRepo.get(created.id).entries.length, 0);
    assert.ok(JSON.stringify(interaction.replies[0].components[0].toJSON()).includes('niebezpieczne'));
  });
});
