'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');
const { Collection } = require('discord.js');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const activity = require('../src/database/repositories/activity');
const activityRepo = require('../src/database/repositories/clanActivity');
const leavesRepo = require('../src/database/repositories/leaves');
const notesRepo = require('../src/database/repositories/officerNotes');
const moderation = require('../src/database/repositories/moderation');
const recruitment = require('../src/database/repositories/recruitment');
const economy = require('../src/database/repositories/economy');
const inactivity = require('../src/services/inactivity');
const leavesService = require('../src/services/leaves');
const weeklyReport = require('../src/services/weeklyReport');
const voiceActivity = require('../src/services/voiceActivity');
const notesService = require('../src/services/officerNotes');
const { parseLeaveDate, reportSlot, zonedParts, zonedToUtc, DAY_MS } = require('../src/utils/clanTime');
const { createUser, createMember, createGuild, createInteraction, replyText } = require('./helpers/interaction');

const urlopCommand = require('../src/commands/aktywnosc/urlop');
const notatkaCommand = require('../src/commands/aktywnosc/notatka');
const nieaktywniCommand = require('../src/commands/aktywnosc/nieaktywni');
const raportCommand = require('../src/commands/aktywnosc/raport');
const profilCommand = require('../src/commands/general/profil');

const MAX_COMPONENTS = 40;
const MAX_CHARACTERS = 4000;

/** Liczy komponenty i znaki tekstu w kontenerze (jak tests/components.test.js). */
function audit(container) {
  const json = container.toJSON();
  let components = 0;
  let characters = 0;
  const walk = (node) => {
    components += 1;
    if (node.content) characters += node.content.length;
    if (node.accessory) walk(node.accessory);
    for (const child of node.components ?? []) walk(child);
  };
  walk(json);
  return { json, components, characters };
}

function assertLimits(container, label) {
  const { components, characters } = audit(container);
  assert.ok(components <= MAX_COMPONENTS, `${label}: ${components} komponentow`);
  assert.ok(characters <= MAX_CHARACTERS, `${label}: ${characters} znakow`);
}

/** Atrapa czlonka z rolami w Collection (wymagane przez /profil). */
function clanMember(id, { guild, admin = false, roleIds = [], joinedAt = new Date('2024-01-01T00:00:00Z') } = {}) {
  const member = createMember(createUser(id, `gracz-${id}`), { guild, admin });
  member.roles.cache = new Collection(roleIds.map((roleId) => [roleId, { id: roleId, position: 1, toString: () => `<@&${roleId}>` }]));
  member.joinedAt = joinedAt;
  member.joinedTimestamp = joinedAt.getTime();
  return member;
}

before(() => database.init());

describe('parser daty urlopu', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0); // 2026-11-05 13:00 w Polsce

  it('rozumie format ISO (koniec dnia czasu polskiego)', () => {
    const endsAt = parseLeaveDate('2026-11-20', now);
    const parts = zonedParts(endsAt);
    assert.deepEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute], [2026, 11, 20, 23, 59]);
  });

  it('rozumie dd.mm i przenosi przeszla date na kolejny rok', () => {
    assert.equal(zonedParts(parseLeaveDate('20.11', now)).year, 2026);
    assert.equal(zonedParts(parseLeaveDate('01.02', now)).year, 2027);
    assert.equal(zonedParts(parseLeaveDate('20.11.2027', now)).year, 2027);
  });

  it('rozumie zapis wzgledny', () => {
    assert.equal(parseLeaveDate('za 7d', now), now + 7 * DAY_MS);
    assert.equal(parseLeaveDate('7 dni', now), now + 7 * DAY_MS);
    assert.equal(parseLeaveDate('za 2 tyg', now), now + 14 * DAY_MS);
    assert.equal(parseLeaveDate('za 12h', now), now + 12 * 60 * 60 * 1000);
  });

  it('odrzuca bledne daty', () => {
    for (const input of ['', 'jutro', '31.02', '2026-13-01', 'za 0d', 'za 5 lat']) {
      assert.equal(parseLeaveDate(input, now), null, input);
    }
  });

  it('przelicza strefe czasowa z uwzglednieniem czasu letniego', () => {
    assert.equal(zonedToUtc(2026, 1, 15, 10, 0, 0), Date.UTC(2026, 0, 15, 9, 0, 0)); // CET
    assert.equal(zonedToUtc(2026, 7, 15, 10, 0, 0), Date.UTC(2026, 6, 15, 8, 0, 0)); // CEST
  });
});

describe('termin raportu tygodniowego', () => {
  it('wskazuje ostatni poniedzialek 10:00 czasu polskiego', () => {
    const slot = reportSlot(Date.UTC(2026, 10, 5, 12, 0, 0)); // czwartek
    assert.equal(slot.key, '2026-11-02');
    assert.equal(slot.at, Date.UTC(2026, 10, 2, 9, 0, 0));
    assert.equal(slot.since, Date.UTC(2026, 9, 26, 9, 0, 0));
  });

  it('w poniedzialek przed 10:00 wskazuje poprzedni tydzien', () => {
    assert.equal(reportSlot(Date.UTC(2026, 10, 9, 8, 0, 0)).key, '2026-11-02');
    assert.equal(reportSlot(Date.UTC(2026, 10, 9, 9, 0, 0)).key, '2026-11-09');
  });
});

describe('repozytorium aktywnosci', () => {
  const GUILD = 'guild-act-repo';

  it('zapisuje ustawienia i rezerwuje tydzien raportu tylko raz', () => {
    assert.equal(activityRepo.getSettings(GUILD).inactive_days, 14);
    activityRepo.updateSettings(GUILD, { report_channel_id: 'chan', 'x; DROP TABLE y': 1 });
    assert.equal(activityRepo.getSettings(GUILD).report_channel_id, 'chan');

    assert.equal(activityRepo.claimReportWeek(GUILD, '2026-11-02'), true);
    assert.equal(activityRepo.claimReportWeek(GUILD, '2026-11-02'), false, 'drugi raport w tym samym tygodniu');
    assert.equal(activityRepo.claimReportWeek(GUILD, '2026-11-09'), true);
  });

  it('laczy ostatnia wiadomosc i czas glosowy w ostatniej aktywnosci', () => {
    activity.trackMessage(GUILD, 'u1');
    const now = Date.now() + 1000;
    activityRepo.addVoiceTime(GUILD, 'u2', 120, now);
    activityRepo.addVoiceTime(GUILD, 'u1', 60, now);

    const map = activityRepo.lastActivityMap(GUILD);
    assert.equal(map.get('u2').lastActiveAt, now);
    assert.equal(map.get('u1').lastActiveAt, now);
    assert.ok(map.get('u1').lastMessageAt < now);

    const top = activityRepo.topByDays(GUILD, 'voice_seconds', '2000-01-01', '2999-01-01');
    assert.deepEqual(top.map((row) => [row.user_id, row.total]), [['u2', 120], ['u1', 60]]);
  });

  it('liczy czas glosowy z sesji (bez kanalu AFK)', () => {
    voiceActivity.reset();
    const guild = { id: 'guild-voice', afkChannelId: 'afk' };
    const member = { id: 'speaker', user: { bot: false } };
    const t0 = Date.now();

    voiceActivity.handleVoiceState({ guild, member, channelId: null }, { guild, member, channelId: 'vc' }, t0);
    voiceActivity.flush({ guilds: { cache: new Map() } }, t0 + 30_000);
    voiceActivity.handleVoiceState({ guild, member, channelId: 'vc' }, { guild, member, channelId: 'afk' }, t0 + 45_000);
    voiceActivity.flush({ guilds: { cache: new Map() } }, t0 + 120_000);

    const [row] = activityRepo.topByDays('guild-voice', 'voice_seconds', '2000-01-01', '2999-01-01');
    assert.equal(row.total, 45, 'czas na AFK nie jest liczony');
    assert.equal(voiceActivity.activeSessions(), 0);
  });
});

describe('repozytorium urlopow', () => {
  const GUILD = 'guild-leaves';

  it('zglasza, przedluza i konczy urlop', () => {
    const now = Date.now();
    const first = leavesRepo.start({ guildId: GUILD, userId: 'a', reason: 'wakacje', endsAt: now + DAY_MS });
    assert.equal(first.updated, false);

    const second = leavesRepo.start({ guildId: GUILD, userId: 'a', reason: 'dluzsze wakacje', endsAt: now + 2 * DAY_MS });
    assert.equal(second.updated, true);
    assert.equal(second.leave.id, first.leave.id);
    assert.equal(leavesRepo.listActive(GUILD).length, 1);

    const ended = leavesRepo.end(GUILD, first.leave.id, { reason: 'manual', endedBy: 'a' });
    assert.equal(ended.end_reason, 'manual');
    assert.equal(leavesRepo.end(GUILD, first.leave.id), null, 'nie konczy dwa razy');
    assert.equal(leavesRepo.getActive(GUILD, 'a'), undefined);
  });

  it('zwraca urlopy po terminie dla schedulera', () => {
    const now = Date.now();
    const { leave } = leavesRepo.start({ guildId: GUILD, userId: 'b', reason: 'x', endsAt: now - 1000 });
    assert.ok(leavesRepo.due(now).some((entry) => entry.id === leave.id));
    assert.ok(leavesRepo.activeUserIds(GUILD).has('b'));
  });

  it('scheduler zamyka przeterminowane urlopy i zdejmuje role', async () => {
    const removed = [];
    const member = clanMember('c', { roleIds: ['leave-role'] });
    member.roles.remove = async (role) => removed.push(role.id);
    const guild = createGuild('guild-leaves-2', { members: new Map([['c', member]]) });
    guild.roles.cache.set('leave-role', { id: 'leave-role' });

    leavesRepo.start({ guildId: guild.id, userId: 'c', reason: 'x', endsAt: Date.now() - 1, roleId: 'leave-role' });
    await leavesService.processDue({ guilds: { cache: new Map([[guild.id, guild]]) } });

    assert.equal(leavesRepo.getActive(guild.id, 'c'), undefined);
    assert.deepEqual(removed, ['leave-role']);
  });
});

describe('repozytorium notatek', () => {
  const GUILD = 'guild-notes';

  it('dodaje, listuje i usuwa notatki tylko w obrebie serwera', () => {
    const first = notesRepo.add({ guildId: GUILD, userId: 'u', authorId: 'o', content: 'pierwsza' });
    notesRepo.add({ guildId: GUILD, userId: 'u', authorId: 'o', content: 'druga' });

    assert.equal(notesRepo.count(GUILD, 'u'), 2);
    assert.equal(notesRepo.list(GUILD, 'u')[0].content, 'druga', 'najnowsze pierwsze');
    assert.equal(notesRepo.remove('inny-serwer', first.id), null);
    assert.equal(notesRepo.remove(GUILD, first.id).content, 'pierwsza');
    assert.equal(notesRepo.count(GUILD, 'u'), 1);
    assert.match(notesService.summary(GUILD, 'u'), /druga/);
    assert.equal(notesService.summary(GUILD, 'nikt'), null);
  });
});

describe('nieaktywni', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  const old = now - 100 * DAY_MS;

  it('wybiera nieaktywnych, pomija nowych i rozdziela urlopy', () => {
    const members = [
      { id: 'active', joinedAt: old },
      { id: 'stale', joinedAt: old },
      { id: 'never', joinedAt: old },
      { id: 'newbie', joinedAt: now - 2 * DAY_MS },
      { id: 'away', joinedAt: old },
    ];
    const activityMap = new Map([
      ['active', { lastActiveAt: now - DAY_MS }],
      ['stale', { lastActiveAt: now - 30 * DAY_MS }],
      ['away', { lastActiveAt: now - 40 * DAY_MS }],
    ]);
    const onLeave = new Map([['away', { ends_at: now + DAY_MS }]]);

    const result = inactivity.findInactive(members, activityMap, { days: 14, now, onLeave });
    assert.deepEqual(result.inactive.map((entry) => entry.id), ['never', 'stale'], 'posortowane wg ostatniej aktywnosci');
    assert.deepEqual(result.away.map((entry) => entry.id), ['away']);
  });

  it('rozpoznaje czlonkow klanu po roli czlonka lub roli z hierarchii', () => {
    const options = { memberRoleId: 'member', hierarchyRoleIds: ['officer'] };
    assert.equal(inactivity.isClanMember(clanMember('x', { roleIds: ['member'] }), options), true);
    assert.equal(inactivity.isClanMember(clanMember('y', { roleIds: ['officer'] }), options), true);
    assert.equal(inactivity.isClanMember(clanMember('z', { roleIds: ['guest'] }), options), false);
  });

  it('panel z setkami osob miesci sie w limitach Components V2', () => {
    const inactive = Array.from({ length: 300 }, (_, i) => ({ id: `1234567890123456${i}`, lastActiveAt: i % 2 ? old : null, joinedAt: old }));
    const away = Array.from({ length: 80 }, (_, i) => ({
      id: `9234567890123456${i}`,
      lastActiveAt: old,
      joinedAt: old,
      leave: { ends_at: now + DAY_MS },
    }));
    const container = inactivity.buildInactivePanel({ inactive, away, total: 400, days: 14, configured: true });
    assertLimits(container, '/nieaktywni');
    assert.match(JSON.stringify(container.toJSON()), /kolejnych osob/);
  });

  it('/nieaktywni liczy czlonkow z serwera', async () => {
    const GUILD = 'guild-inactive-cmd';
    guilds.update(GUILD, { member_role_id: 'member' });
    const admin = clanMember('adm', { admin: true });
    const sleeper = clanMember('sleeper', { roleIds: ['member'] });
    const members = new Map([['adm', admin], ['sleeper', sleeper]]);
    const guild = createGuild(GUILD, { members });

    const interaction = createInteraction({ guild, member: admin, options: [{ name: 'dni', type: 'integer', value: 7 }] });
    await nieaktywniCommand.execute(interaction);
    const text = replyText(interaction);
    assert.match(text, /sleeper/);
    assert.doesNotMatch(text, /<@adm>/, 'admin bez roli klanowej nie jest liczony');
  });

  it('odmawia zwyklemu czlonkowi', async () => {
    const guild = createGuild('guild-inactive-deny', { members: new Map() });
    const member = clanMember('plain', { guild });
    const interaction = createInteraction({ guild, member });
    await nieaktywniCommand.execute(interaction);
    assert.match(replyText(interaction), /tylko dla oficerow/);
  });
});

describe('raport tygodniowy', () => {
  const GUILD = 'guild-report';
  const since = Date.now() - 7 * DAY_MS;

  before(() => {
    activityRepo.recordMemberEvent(GUILD, 'n1', 'join');
    activityRepo.recordMemberEvent(GUILD, 'n2', 'join');
    activityRepo.recordMemberEvent(GUILD, 'n3', 'leave');
    activityRepo.recordMemberEvent(GUILD, 'old', 'join', since - DAY_MS);
    activityRepo.trackMessageDay(GUILD, 'talker');
    activityRepo.trackMessageDay(GUILD, 'talker');
    activityRepo.addVoiceTime(GUILD, 'speaker', 3600);
    moderation.addCase({ guildId: GUILD, action: 'warn', userId: 'x', moderatorId: 'm', reason: 'r' });
    const application = recruitment.createApplication({ guildId: GUILD, userId: 'cand', userTag: 'c', answers: [] });
    recruitment.decideApplication(application.id, { status: 'accepted', reviewerId: 'm' });

    guilds.update(GUILD, { economy_enabled: true });
    economy.earn({ guildId: GUILD, userId: 'talker', amount: 50 });
  });

  it('zbiera dane z bazy dla przedzialu', () => {
    const data = weeklyReport.collectReportData(GUILD, { since, until: Date.now() + DAY_MS, inactive: 3, inactiveDays: 14 });
    assert.equal(data.joins, 2);
    assert.equal(data.leaves, 1);
    assert.equal(data.applications.accepted, 1);
    assert.equal(data.applications.submitted, 1);
    assert.equal(data.moderation.total, 1);
    assert.equal(data.topMessages[0].user_id, 'talker');
    assert.equal(data.topVoice[0].total, 3600);
    assert.equal(data.economy.earned, 50);
    assert.equal(data.economy.topEarner.user_id, 'talker');
  });

  it('buduje panel raportu w limitach', () => {
    const data = weeklyReport.collectReportData(GUILD, { since, until: Date.now() + DAY_MS, inactive: 3, inactiveDays: 14 });
    const container = weeklyReport.buildReportPanel(data, { guildName: 'Klan' });
    assertLimits(container, 'raport');
    const text = JSON.stringify(container.toJSON());
    assert.match(text, /Dolaczylo: \*\*2\*\*/);
    assert.match(text, /Ostrzezenie 1/);
    assert.match(text, /Nieaktywni/);
  });

  it('nie wysyla raportu dwa razy w tym samym tygodniu', async () => {
    const sent = [];
    const guild = createGuild('guild-report-send', { members: new Map() });
    guild.channels.cache.set('reports', { isTextBased: () => true, send: async (payload) => sent.push(payload) });
    activityRepo.updateSettings(guild.id, { report_channel_id: 'reports', report_last_week: null });
    const client = { guilds: { cache: new Map([[guild.id, guild]]) } };

    await weeklyReport.processDue(client);
    await weeklyReport.processDue(client);
    assert.equal(sent.length, 1);
    assert.equal(activityRepo.getSettings(guild.id).report_last_week, reportSlot().key);
  });

  it('/raport kanal oznacza biezacy tydzien, a /raport teraz odpowiada panelem', async () => {
    const admin = clanMember('radm', { admin: true });
    const guild = createGuild('guild-report-cmd', { members: new Map([['radm', admin]]) });
    const channel = { id: 'rchan', toString: () => '<#rchan>', type: 0 };

    const setChannel = createInteraction({
      guild,
      member: admin,
      subcommand: 'kanal',
      options: [{ name: 'kanal', type: 'channel', value: channel }],
    });
    await raportCommand.execute(setChannel);
    assert.equal(activityRepo.getSettings(guild.id).report_last_week, reportSlot().key);

    const now = createInteraction({ guild, member: admin, subcommand: 'teraz' });
    await raportCommand.execute(now);
    assert.match(replyText(now), /Raport tygodniowy/);
  });
});

describe('komendy urlopu i notatek', () => {
  const GUILD = 'guild-leave-cmd';

  it('/urlop zglos, lista i koniec', async () => {
    const officer = clanMember('off', { admin: true });
    const user = clanMember('usr');
    const guild = createGuild(GUILD, { members: new Map([['off', officer], ['usr', user]]) });

    const report = createInteraction({
      guild,
      member: user,
      subcommand: 'zglos',
      options: [
        { name: 'do', type: 'string', value: 'za 7d' },
        { name: 'powod', type: 'string', value: 'egzaminy' },
      ],
    });
    await urlopCommand.execute(report);
    assert.match(replyText(report), /Zgloszono urlop/);
    assert.ok(leavesRepo.getActive(GUILD, 'usr'));

    const denied = createInteraction({ guild, member: user, subcommand: 'lista' });
    await urlopCommand.execute(denied);
    assert.match(replyText(denied), /tylko dla oficerow/);

    const list = createInteraction({ guild, member: officer, subcommand: 'lista' });
    await urlopCommand.execute(list);
    assert.match(replyText(list), /egzaminy/);
    assertLimits(leavesService.buildLeaveList(
      Array.from({ length: 100 }, (_, i) => ({ id: i, user_id: `12345678901234567${i}`, ends_at: Date.now(), reason: 'x'.repeat(300) })),
    ), '/urlop lista');

    const end = createInteraction({ guild, member: user, subcommand: 'koniec' });
    await urlopCommand.execute(end);
    assert.equal(leavesRepo.getActive(GUILD, 'usr'), undefined);
  });

  it('/urlop zglos odrzuca bledna i przeszla date', async () => {
    const user = clanMember('usr2');
    const guild = createGuild('guild-leave-cmd-2', { members: new Map([['usr2', user]]) });
    for (const value of ['kiedys', '2020-01-01']) {
      const interaction = createInteraction({
        guild,
        member: user,
        subcommand: 'zglos',
        options: [
          { name: 'do', type: 'string', value },
          { name: 'powod', type: 'string', value: 'x' },
        ],
      });
      await urlopCommand.execute(interaction);
      assert.match(replyText(interaction), /Nie rozumiem|w przyszlosci/);
    }
  });

  it('/notatka dziala tylko dla kadry, a /profil pokazuje notatki tylko oficerom', async () => {
    const officer = clanMember('noff', { admin: true });
    const user = clanMember('nusr');
    const guild = createGuild('guild-notes-cmd', { members: new Map([['noff', officer], ['nusr', user]]) });

    const add = createInteraction({
      guild,
      member: officer,
      subcommand: 'dodaj',
      options: [
        { name: 'uzytkownik', type: 'user', value: user.user },
        { name: 'tresc', type: 'string', value: 'Spoznia sie na wojny' },
      ],
    });
    await notatkaCommand.execute(add);
    assert.match(replyText(add), /Dodano notatke/);

    const denied = createInteraction({
      guild,
      member: user,
      subcommand: 'lista',
      options: [{ name: 'uzytkownik', type: 'user', value: user.user }],
    });
    await notatkaCommand.execute(denied);
    assert.match(replyText(denied), /tylko dla oficerow/);

    // Oficer oglada cudzy profil (ephemeral) — notatka w polu profilu.
    const officerView = createInteraction({ guild, member: officer, options: [{ name: 'uzytkownik', type: 'user', value: user.user }] });
    await profilCommand.execute(officerView);
    assert.match(JSON.stringify(officerView.replies.map((r) => r.components.map((c) => c.toJSON()))), /Spoznia sie/);

    // Czlonek oglada swoj profil — bez notatek.
    const selfView = createInteraction({ guild, member: user });
    await profilCommand.execute(selfView);
    assert.equal(selfView.replies.length, 1);
    assert.doesNotMatch(replyText(selfView), /Spoznia sie|Notatki/);

    const notesPanel = notesService.buildNotesPanel(
      user.user,
      Array.from({ length: 15 }, (_, i) => ({ id: i, created_at: Date.now(), author_id: 'noff', content: 'x'.repeat(1000) })),
      15,
    );
    assertLimits(notesPanel, '/notatka lista');
  });
});
