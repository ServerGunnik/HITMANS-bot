'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { parseDuration, humanDuration, plural, truncate, timestamp, sparkline } = require('../src/utils/format');
const { build, parse } = require('../src/utils/customId');
const { canModerate, canManageRole } = require('../src/utils/permissions');

describe('parsowanie czasu', () => {
  it('rozumie skrocone jednostki', () => {
    assert.equal(parseDuration('10m'), 600_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('1d'), 86_400_000);
    assert.equal(parseDuration('2h30m'), 9_000_000);
    assert.equal(parseDuration('1d 12h'), 129_600_000);
  });

  it('odrzuca nieprawidlowe wartosci', () => {
    for (const input of ['', 'abc', '10x', null, undefined]) {
      assert.equal(parseDuration(input), null, String(input));
    }
  });

  it('formatuje czas po polsku', () => {
    assert.equal(humanDuration(9_000_000), '2 godz. 30 min');
    assert.equal(humanDuration(0), '0 s');
  });
});

describe('odmiana i skracanie', () => {
  it('odmienia rzeczowniki po polsku', () => {
    assert.equal(plural(1, 'ostrzezenie', 'ostrzezenia', 'ostrzezen'), 'ostrzezenie');
    assert.equal(plural(3, 'ostrzezenie', 'ostrzezenia', 'ostrzezen'), 'ostrzezenia');
    assert.equal(plural(5, 'ostrzezenie', 'ostrzezenia', 'ostrzezen'), 'ostrzezen');
    assert.equal(plural(12, 'ostrzezenie', 'ostrzezenia', 'ostrzezen'), 'ostrzezen');
    assert.equal(plural(22, 'ostrzezenie', 'ostrzezenia', 'ostrzezen'), 'ostrzezenia');
  });

  it('skraca tekst do limitu', () => {
    assert.equal(truncate('abcdef', 4).length, 4);
    assert.equal(truncate('abc', 10), 'abc');
  });

  it('buduje znacznik czasu Discorda', () => {
    assert.match(timestamp(new Date(1_700_000_000_000), 'R'), /^<t:1700000000:R>$/);
    for (const empty of [null, undefined, 0, NaN, 'abc']) {
      assert.equal(timestamp(empty), 'brak danych', String(empty));
    }
  });

  it('rysuje wykres aktywnosci', () => {
    assert.equal(sparkline([0, 0, 0]).length, 3);
    assert.equal(sparkline([1, 10]).at(-1), '█');
  });
});

describe('identyfikatory komponentow', () => {
  it('skleja i rozklada customId', () => {
    assert.equal(build('rekrutacja', 'accept', 42), 'rekrutacja:accept:42');
    assert.deepEqual(parse('rekrutacja:accept:42'), {
      namespace: 'rekrutacja',
      action: 'accept',
      args: ['42'],
    });
    assert.deepEqual(parse('setup:run').args, []);
  });
});

describe('kontrola uprawnien', () => {
  const guild = { id: 'g', ownerId: 'owner', members: { me: { id: 'bot' } } };
  const member = (id, position, permissions = []) => ({
    id,
    guild,
    roles: { highest: { position } },
    permissions: { has: (flag) => permissions.includes(flag) },
  });

  it('blokuje akcje na sobie i na wlascicielu serwera', () => {
    const moderator = member('mod', 10);
    assert.equal(canModerate(moderator, moderator).ok, false);
    assert.equal(canModerate(moderator, member('owner', 1)).ok, false);
  });

  it('blokuje akcje na osobie z rownie wysoka rola', () => {
    guild.members.me = { id: 'bot', roles: { highest: { position: 50 } } };
    assert.equal(canModerate(member('mod', 10), member('target', 10)).ok, false);
    assert.equal(canModerate(member('mod', 10), member('target', 5)).ok, true);
  });

  it('blokuje akcje, gdy rola bota jest za nisko', () => {
    guild.members.me = { id: 'bot', roles: { highest: { position: 3 } } };
    const result = canModerate(member('mod', 10), member('target', 5));
    assert.equal(result.ok, false);
    assert.match(result.reason, /hierarchii/);
  });

  it('nie pozwala nadawac rol zarzadzanych przez integracje', () => {
    const botGuild = {
      id: 'g',
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 20 } } } },
      roles: { everyone: { id: 'everyone' } },
    };

    assert.equal(canManageRole(botGuild, { id: 'r', managed: true, position: 1 }).ok, false);
    assert.equal(canManageRole(botGuild, { id: 'r', managed: false, position: 30 }).ok, false);
    assert.equal(canManageRole(botGuild, { id: 'r', managed: false, position: 5 }).ok, true);
  });
});
