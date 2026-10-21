'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const recruitment = require('../src/database/repositories/recruitment');
const rolesRepo = require('../src/database/repositories/roles');
const moderation = require('../src/database/repositories/moderation');
const activity = require('../src/database/repositories/activity');

const GUILD = 'guild-db';
const OTHER_GUILD = 'guild-db-2';
const USER = 'user-db';

before(() => database.init());

describe('ustawienia serwera', () => {
  it('tworzy domyslny wiersz przy pierwszym odczycie', () => {
    const settings = guilds.get(GUILD);
    assert.equal(settings.recruitment_enabled, true);
    assert.equal(settings.automod_enabled, false);
    assert.deepEqual(settings.automod_exempt_roles, []);
  });

  it('zapisuje zmiany i odswieza cache', () => {
    guilds.update(GUILD, { member_role_id: 'role-1', automod_link_whitelist: ['youtube.com'] });
    const settings = guilds.get(GUILD);
    assert.equal(settings.member_role_id, 'role-1');
    assert.deepEqual(settings.automod_link_whitelist, ['youtube.com']);
  });

  it('trzyma ustawienia osobno dla kazdego serwera', () => {
    assert.equal(guilds.get(OTHER_GUILD).member_role_id, null);
  });

  it('ignoruje kolumny spoza listy dozwolonych', () => {
    guilds.update(GUILD, { 'guild_id = 1; DROP TABLE guild_settings; --': 'x', welcome_message: 'Czesc {user}' });
    assert.equal(guilds.get(GUILD).welcome_message, 'Czesc {user}');
  });

  it('reset przywraca wartosci domyslne', () => {
    guilds.reset(GUILD);
    assert.equal(guilds.get(GUILD).member_role_id, null);
  });
});

describe('pytania rekrutacyjne', () => {
  it('wgrywa domyslny zestaw pytan', () => {
    const created = recruitment.seedDefaultQuestions(GUILD);
    assert.equal(created.length, 5);
    assert.deepEqual(
      recruitment.listQuestions(GUILD).map((question) => question.position),
      [1, 2, 3, 4, 5],
    );
  });

  it('przenumerowuje pozycje po usunieciu pytania', () => {
    const [, second] = recruitment.listQuestions(GUILD);
    recruitment.removeQuestion(GUILD, second.id);
    assert.deepEqual(
      recruitment.listQuestions(GUILD).map((question) => question.position),
      [1, 2, 3, 4],
    );
  });

  it('zmienia kolejnosc pytan', () => {
    const [first] = recruitment.listQuestions(GUILD);
    recruitment.moveQuestion(GUILD, first.id, 3);
    assert.equal(recruitment.listQuestions(GUILD)[2].id, first.id);
  });

  it('zapisuje edycje pytania', () => {
    const [question] = recruitment.listQuestions(GUILD);
    recruitment.updateQuestion(GUILD, question.id, { label: 'Zmienione', required: false, style: 'short' });
    const updated = recruitment.getQuestion(GUILD, question.id);
    assert.equal(updated.label, 'Zmienione');
    assert.equal(updated.required, false);
    assert.equal(updated.style, 'short');
  });

  it('nie miesza pytan miedzy serwerami', () => {
    assert.equal(recruitment.listQuestions(OTHER_GUILD).length, 0);
  });
});

describe('zgloszenia', () => {
  it('zapisuje zgloszenie z odpowiedziami i wykrywa otwarte', () => {
    const application = recruitment.createApplication({
      guildId: GUILD,
      userId: USER,
      userTag: 'gracz#1',
      answers: [{ question: 'Nick', answer: 'Raider' }],
    });

    assert.equal(application.status, 'pending');
    assert.equal(application.answers[0].answer, 'Raider');
    assert.equal(recruitment.getPendingApplication(GUILD, USER).id, application.id);
  });

  it('zapisuje decyzje i zamyka zgloszenie', () => {
    const pending = recruitment.getPendingApplication(GUILD, USER);
    const decided = recruitment.decideApplication(pending.id, {
      status: 'accepted',
      reviewerId: 'admin',
      reason: null,
    });

    assert.equal(decided.status, 'accepted');
    assert.ok(decided.decided_at > 0);
    assert.equal(recruitment.getPendingApplication(GUILD, USER), null);
    assert.equal(recruitment.countByStatus(GUILD).accepted, 1);
  });
});

describe('hierarchia rol', () => {
  it('utrzymuje unikalny poziom w obrebie serwera', () => {
    rolesRepo.set(GUILD, { roleId: 'r1', level: 1, name: 'Rekrut' });
    rolesRepo.set(GUILD, { roleId: 'r2', level: 2, name: 'Czlonek' });
    rolesRepo.set(GUILD, { roleId: 'r3', level: 2, name: 'Czlonek v2' });

    assert.equal(rolesRepo.list(GUILD).length, 2);
    assert.equal(rolesRepo.getByLevel(GUILD, 2).role_id, 'r3');
  });

  it('wyznacza najwyzszy stopien czlonka', () => {
    rolesRepo.set(GUILD, { roleId: 'r4', level: 3, name: 'Weteran' });
    assert.equal(rolesRepo.highestLevelFor(GUILD, ['r1', 'r4']).level, 3);
    assert.equal(rolesRepo.highestLevelFor(GUILD, ['nieznana']), null);
  });
});

describe('ostrzezenia i sprawy', () => {
  it('liczy tylko aktywne ostrzezenia', () => {
    const first = moderation.addWarning({ guildId: GUILD, userId: USER, moderatorId: 'mod', reason: 'spam' });
    moderation.addWarning({ guildId: GUILD, userId: USER, moderatorId: 'mod', reason: 'flood' });
    assert.equal(moderation.countWarnings(GUILD, USER), 2);

    moderation.removeWarning(GUILD, first.id, 'mod');
    assert.equal(moderation.countWarnings(GUILD, USER), 1);
    assert.equal(moderation.listWarnings(GUILD, USER, { includeRemoved: true }).length, 2);
  });

  it('numeruje sprawy osobno dla kazdego serwera', () => {
    assert.equal(moderation.addCase({ guildId: OTHER_GUILD, action: 'kick', userId: USER, moderatorId: 'm' }).case_number, 1);
    assert.equal(moderation.addCase({ guildId: OTHER_GUILD, action: 'ban', userId: USER, moderatorId: 'm' }).case_number, 2);
  });

  it('wykrywa wygasle bany czasowe', () => {
    moderation.addTempBan({ guildId: GUILD, userId: USER, expiresAt: Date.now() - 1000, reason: 'temp' });
    moderation.addTempBan({ guildId: GUILD, userId: 'inny', expiresAt: Date.now() + 60_000, reason: 'temp' });

    const due = moderation.dueTempBans();
    assert.equal(due.length, 1);
    assert.equal(due[0].user_id, USER);
  });
});

describe('aktywnosc', () => {
  it('zlicza wiadomosci i aktywnych czlonkow', () => {
    for (let i = 0; i < 5; i += 1) activity.trackMessage(GUILD, USER);
    activity.trackMessage(GUILD, 'user-2');

    assert.equal(activity.getMember(GUILD, USER).messages, 5);
    assert.equal(activity.totalMessages(GUILD), 6);
    assert.equal(activity.activeMembers(GUILD, 1), 2);
    assert.equal(activity.dailyHistory(GUILD, 7).length, 7);
    assert.equal(activity.topMembers(GUILD, 1)[0].user_id, USER);
  });
});
