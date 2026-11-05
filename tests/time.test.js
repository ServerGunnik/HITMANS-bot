'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { parseTime, formatWarsaw, warsawToUtc } = require('../src/utils/time');
const { parseUserIds, mentionList } = require('../src/utils/mentions');

// 2026-11-05 15:00 w Warszawie (CET, UTC+1) = 14:00 UTC
const NOW = Date.UTC(2026, 10, 5, 14, 0);
const parse = (input, now = NOW) => {
  const at = parseTime(input, { now });
  return at === null ? null : formatWarsaw(at);
};

describe('parser terminow (Europe/Warsaw)', () => {
  it('rozumie pelna date z godzina', () => {
    assert.equal(parse('2026-11-20 20:00'), '2026-11-20 20:00');
    assert.equal(parseTime('2026-11-20 20:00', { now: NOW }), Date.UTC(2026, 10, 20, 19, 0));
    assert.equal(parse('2026-11-20T08:05'), '2026-11-20 08:05');
  });

  it('uwzglednia czas letni', () => {
    // lipiec: CEST, UTC+2
    assert.equal(parseTime('2026-07-01 20:00', { now: NOW }), Date.UTC(2026, 6, 1, 18, 0));
  });

  it('rozumie zapis z kropkami (z rokiem i bez)', () => {
    assert.equal(parse('20.11.2026 20:00'), '2026-11-20 20:00');
    assert.equal(parse('20.11 20:00'), '2026-11-20 20:00');
    // 01.01 juz minal w tym roku -> przyszly rok
    assert.equal(parse('1.01 12:00'), '2027-01-01 12:00');
  });

  it('rozumie dzis / jutro / pojutrze', () => {
    assert.equal(parse('jutro 20:00'), '2026-11-06 20:00');
    assert.equal(parse('Jutro o 7:30'), '2026-11-06 07:30');
    assert.equal(parse('dzis 18:00'), '2026-11-05 18:00');
    assert.equal(parse('pojutrze 21:15'), '2026-11-07 21:15');
  });

  it('sama godzina = dzis, a jesli minela — jutro', () => {
    assert.equal(parse('20:00'), '2026-11-05 20:00');
    assert.equal(parse('10:00'), '2026-11-06 10:00');
    assert.equal(parse('15:00'), '2026-11-06 15:00', 'biezaca minuta traktowana jako miniona');
  });

  it('rozumie czas wzgledny', () => {
    assert.equal(parseTime('za 2h', { now: NOW }), NOW + 2 * 3_600_000);
    assert.equal(parseTime('za 30m', { now: NOW }), NOW + 30 * 60_000);
    assert.equal(parseTime('1h30m', { now: NOW }), NOW + 90 * 60_000);
    assert.equal(parseTime('za 2 godziny', { now: NOW }), NOW + 2 * 3_600_000);
    assert.equal(parseTime('za 45 minut', { now: NOW }), NOW + 45 * 60_000);
    assert.equal(parseTime('za 1 dzien', { now: NOW }), NOW + 86_400_000);
  });

  it('dziala na przelomie miesiaca i roku', () => {
    const newYearsEve = Date.UTC(2026, 11, 31, 22, 0); // 23:00 w Warszawie
    assert.equal(parse('jutro 10:00', newYearsEve), '2027-01-01 10:00');
    assert.equal(parse('22:00', newYearsEve), '2027-01-01 22:00');
  });

  it('odrzuca bledne wartosci', () => {
    for (const input of ['', null, undefined, 'abc', '25:00', '2026-02-30 20:00', '20:61', 'jutro', 'za', '32.01 10:00']) {
      assert.equal(parseTime(input, { now: NOW }), null, String(input));
    }
  });

  it('warsawToUtc zwraca null dla nieistniejacej daty', () => {
    assert.equal(warsawToUtc(2026, 2, 29, 12, 0), null);
    assert.equal(warsawToUtc(2028, 2, 29, 12, 0), Date.UTC(2028, 1, 29, 11, 0));
  });
});

describe('wzmianki', () => {
  it('wyciaga identyfikatory bez duplikatow', () => {
    assert.deepEqual(
      parseUserIds('<@123456789012345678> <@!223456789012345678>, 323456789012345678 <@123456789012345678>'),
      ['123456789012345678', '223456789012345678', '323456789012345678'],
    );
    assert.deepEqual(parseUserIds(null), []);
  });

  it('skraca dluga liste', () => {
    assert.equal(mentionList([]), '*brak*');
    assert.equal(mentionList(['1', '2', '3'], 2), '<@1>, <@2> … +1');
  });
});
