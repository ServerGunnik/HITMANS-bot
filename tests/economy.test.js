'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const economy = require('../src/database/repositories/economy');
const economyService = require('../src/services/economy');

const GUILD = 'guild-eco';
const OTHER_GUILD = 'guild-eco-2';
const ALICE = 'user-alice';
const BOB = 'user-bob';

before(() => {
  database.init();
  guilds.update(GUILD, { economy_enabled: true, economy_start_balance: 0 });
});

beforeEach(() => {
  economy.resetGuild(GUILD);
});

describe('konta', () => {
  it('zaklada konto przy pierwszym uzyciu', () => {
    const account = economy.getAccount(GUILD, ALICE);
    assert.equal(account.balance, 0);
    assert.equal(account.total_earned, 0);
  });

  it('respektuje saldo startowe z ustawien serwera', () => {
    guilds.update(OTHER_GUILD, { economy_enabled: true, economy_start_balance: 250 });
    assert.equal(economy.getBalance(OTHER_GUILD, ALICE), 250);
    assert.equal(economy.getBalance(GUILD, BOB), 0, 'inny serwer ma wlasne ustawienia');
  });

  it('trzyma salda osobno dla kazdego serwera', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    assert.equal(economy.getBalance(GUILD, ALICE), 100);
    assert.equal(economy.getBalance('guild-eco-3', ALICE), 0);
  });
});

describe('przelewy', () => {
  it('przenosi srodki i zapisuje wpis w ksiedze', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });

    const result = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 40, reason: 'za pomoc' });

    assert.equal(result.ok, true);
    assert.equal(economy.getBalance(GUILD, ALICE), 60);
    assert.equal(economy.getBalance(GUILD, BOB), 40);
    assert.equal(result.transaction.type, 'transfer');
    assert.equal(result.transaction.reason, 'za pomoc');
  });

  it('odrzuca przelew ponad saldo i nie rusza kont', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 10, actorId: 'admin' });

    const result = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 50 });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'insufficient');
    assert.equal(economy.getBalance(GUILD, ALICE), 10);
    assert.equal(economy.getBalance(GUILD, BOB), 0);
  });

  it('nie tworzy ani nie gubi punktow', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 30 });
    economy.transfer({ guildId: GUILD, fromUserId: BOB, toUserId: ALICE, amount: 10 });

    assert.equal(economy.totalCirculation(GUILD), 100);
  });
});

describe('reczna korekta sald', () => {
  it('przyznaje punkty i liczy je jako zarobek', () => {
    const result = economy.grant({ guildId: GUILD, userId: ALICE, amount: 75, actorId: 'admin', reason: 'event' });

    assert.equal(result.balance, 75);
    assert.equal(economy.getAccount(GUILD, ALICE).total_earned, 75);
    assert.equal(result.transaction.type, 'admin_add');
  });

  it('nie schodzi ponizej zera przy odejmowaniu', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 30, actorId: 'admin' });

    const result = economy.take({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });

    assert.equal(result.ok, true);
    assert.equal(result.applied, 30, 'odjeto tylko tyle, ile bylo na koncie');
    assert.equal(result.partial, true);
    assert.equal(economy.getBalance(GUILD, ALICE), 0);
  });

  it('zglasza puste konto', () => {
    assert.equal(economy.take({ guildId: GUILD, userId: BOB, amount: 10, actorId: 'admin' }).ok, false);
  });
});

describe('nagrody za aktywnosc', () => {
  it('respektuje cooldown nagrody za wiadomosc', () => {
    assert.equal(economy.canEarnMessage(GUILD, ALICE, 60), true);

    economy.earn({ guildId: GUILD, userId: ALICE, amount: 2, kind: 'message' });

    assert.equal(economy.canEarnMessage(GUILD, ALICE, 60), false, 'w trakcie cooldownu');
    assert.equal(economy.canEarnMessage(GUILD, ALICE, 0), true, 'cooldown 0 = zawsze mozna');
    assert.equal(economy.getBalance(GUILD, ALICE), 2);
  });

  it('liczy minuty na kanale glosowym', () => {
    economy.earn({ guildId: GUILD, userId: ALICE, amount: 1, kind: 'voice', voiceMinutes: 1 });
    economy.earn({ guildId: GUILD, userId: ALICE, amount: 1, kind: 'voice', voiceMinutes: 1 });

    const account = economy.getAccount(GUILD, ALICE);
    assert.equal(account.voice_minutes, 2);
    assert.equal(account.balance, 2);
    assert.ok(account.last_voice_earn_at > 0);
  });

  it('pomija nagrode glosowa dla botow, AFK i wyciszonych', () => {
    const settings = { economy_voice_min_members: 2 };
    const population = new Map([['kanal', 3]]);
    const state = (overrides) => ({
      channelId: 'kanal',
      guild: { afkChannelId: 'afk' },
      member: { user: { bot: false } },
      selfDeaf: false,
      deaf: false,
      ...overrides,
    });

    assert.equal(economyService.isEligibleVoiceState(state({}), settings, population), true);
    assert.equal(economyService.isEligibleVoiceState(state({ member: { user: { bot: true } } }), settings, population), false);
    assert.equal(economyService.isEligibleVoiceState(state({ channelId: 'afk', guild: { afkChannelId: 'afk' } }), settings, population), false);
    assert.equal(economyService.isEligibleVoiceState(state({ selfDeaf: true }), settings, population), false);
    assert.equal(economyService.isEligibleVoiceState(state({}), settings, new Map([['kanal', 1]])), false, 'sam na kanale');
  });
});

describe('historia i cofanie naduzyc', () => {
  it('zapisuje kazda operacje w ksiedze', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 20 });
    economy.earn({ guildId: GUILD, userId: ALICE, amount: 2, kind: 'message' });

    assert.equal(economy.history(GUILD, { limit: 50 }).length, 3);
    assert.equal(economy.history(GUILD, { types: ['transfer'], limit: 50 }).length, 1);
    assert.equal(economy.history(GUILD, { userId: BOB, limit: 50 }).length, 1);
  });

  it('cofa przelew i zwraca srodki nadawcy', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    const transfer = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 60 });

    const result = economy.revert(GUILD, transfer.transaction.id, 'admin');

    assert.equal(result.ok, true);
    assert.equal(result.amount, 60);
    assert.equal(result.partial, false);
    assert.equal(economy.getBalance(GUILD, ALICE), 100);
    assert.equal(economy.getBalance(GUILD, BOB), 0);
    assert.equal(result.transaction.reverted, 1);
    assert.equal(result.counter.type, 'revert');
    assert.equal(result.counter.reference_id, transfer.transaction.id);
  });

  it('cofa czesciowo, gdy odbiorca wydal juz czesc punktow', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    const transfer = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 100 });
    economy.spend({ guildId: GUILD, userId: BOB, amount: 70, reason: 'zakup' });

    const result = economy.revert(GUILD, transfer.transaction.id, 'admin');

    assert.equal(result.ok, true);
    assert.equal(result.partial, true);
    assert.equal(result.amount, 30, 'odzyskano tyle, ile zostalo');
    assert.equal(economy.getBalance(GUILD, BOB), 0, 'saldo nie schodzi ponizej zera');
    assert.equal(economy.getBalance(GUILD, ALICE), 30);
  });

  it('cofa reczne przyznanie punktow', () => {
    const grant = economy.grant({ guildId: GUILD, userId: BOB, amount: 500, actorId: 'admin' });
    const result = economy.revert(GUILD, grant.transaction.id, 'admin');

    assert.equal(result.ok, true);
    assert.equal(economy.getBalance(GUILD, BOB), 0);
  });

  it('nie pozwala cofnac dwa razy tej samej transakcji', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 50, actorId: 'admin' });
    const transfer = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 50 });

    assert.equal(economy.revert(GUILD, transfer.transaction.id, 'admin').ok, true);
    assert.equal(economy.revert(GUILD, transfer.transaction.id, 'admin').reason, 'already_reverted');
    assert.equal(economy.getBalance(GUILD, ALICE), 50, 'saldo nie zmienia sie po drugiej probie');
  });

  it('nie cofa nagrod za aktywnosc ani nieistniejacych wpisow', () => {
    const earn = economy.earn({ guildId: GUILD, userId: ALICE, amount: 5, kind: 'message' });

    assert.equal(economy.revert(GUILD, earn.id, 'admin').reason, 'not_revertible');
    assert.equal(economy.revert(GUILD, 999_999, 'admin').reason, 'not_found');
  });

  it('nie pozwala cofnac transakcji z innego serwera', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 10, actorId: 'admin' });
    const transfer = economy.transfer({ guildId: GUILD, fromUserId: ALICE, toUserId: BOB, amount: 10 });

    assert.equal(economy.revert(OTHER_GUILD, transfer.transaction.id, 'admin').reason, 'not_found');
  });
});

describe('ranking', () => {
  it('sortuje po saldzie i podaje pozycje', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 100, actorId: 'admin' });
    economy.grant({ guildId: GUILD, userId: BOB, amount: 300, actorId: 'admin' });
    economy.grant({ guildId: GUILD, userId: 'user-carol', amount: 200, actorId: 'admin' });

    const top = economy.leaderboard(GUILD, { limit: 3 });
    assert.deepEqual(
      top.map((entry) => entry.user_id),
      [BOB, 'user-carol', ALICE],
    );

    assert.equal(economy.rankOf(GUILD, BOB).position, 1);
    assert.equal(economy.rankOf(GUILD, ALICE).position, 3);
    assert.equal(economy.rankOf(GUILD, ALICE).total, 3);
    assert.equal(economy.rankOf(GUILD, 'nieznany'), null);
  });

  it('sortuje po zarobkach i czasie na kanale glosowym', () => {
    economy.grant({ guildId: GUILD, userId: ALICE, amount: 500, actorId: 'admin' });
    economy.take({ guildId: GUILD, userId: ALICE, amount: 500, actorId: 'admin' });
    economy.grant({ guildId: GUILD, userId: BOB, amount: 10, actorId: 'admin' });
    economy.earn({ guildId: GUILD, userId: BOB, amount: 1, kind: 'voice', voiceMinutes: 42 });

    assert.equal(economy.leaderboard(GUILD, { sort: 'earned', limit: 1 })[0].user_id, ALICE);
    assert.equal(economy.leaderboard(GUILD, { sort: 'voice', limit: 1 })[0].user_id, BOB);
  });
});

describe('formatowanie waluty', () => {
  it('uzywa nazwy i emoji ustawionych na serwerze', () => {
    guilds.update(GUILD, { currency_name: 'Zlote Monety', currency_emoji: '💎' });

    assert.equal(economyService.formatCurrency(GUILD, 1500), '💎 **1 500** Zlote Monety');
    assert.equal(economyService.formatCurrency(GUILD, 1500, { short: true }), '💎 1 500');

    guilds.update(GUILD, { currency_name: 'Punkty klanowe', currency_emoji: '🪙' });
  });
});
