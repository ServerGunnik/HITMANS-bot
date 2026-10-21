'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const moderation = require('../src/database/repositories/moderation');
const automod = require('../src/services/automod');

const GUILD = 'guild-automod';
const message = (content) => ({ content, guild: { id: GUILD } });

let settings;

before(() => {
  database.init();
  moderation.addBlockedWord(GUILD, 'brzydkie');
  moderation.addBlockedWord(GUILD, 'zle slowo');
  settings = guilds.update(GUILD, {
    automod_enabled: true,
    automod_words: true,
    automod_links: true,
    automod_invites: true,
    automod_link_whitelist: ['youtube.com'],
  });
});

describe('normalizacja tekstu', () => {
  it('usuwa polskie znaki diakrytyczne', () => {
    assert.equal(automod.normalize('ŁÓDŹ Gęś'), 'lodz ges');
  });

  it('rozwija podstawowy leetspeak', () => {
    assert.equal(automod.normalize('br0dk4'), 'brodka');
  });

  it('zachowuje wykrzyknik jako granice slowa', () => {
    assert.ok(automod.normalize('slowo!').endsWith('!'));
  });
});

describe('filtr zabronionych slow', () => {
  it('wykrywa slowo niezaleznie od wielkosci liter', () => {
    assert.equal(automod.inspect(message('To jest BRZYDKIE'), settings).type, 'word');
  });

  it('wykrywa slowo obok interpunkcji', () => {
    for (const content of ['brzydkie!', '(brzydkie)', 'o, brzydkie.', 'brzydkie?']) {
      assert.equal(automod.inspect(message(content), settings)?.type, 'word', content);
    }
  });

  it('wykrywa slowo zapisane leetspeakiem', () => {
    assert.equal(automod.inspect(message('brzydk1e'), settings).type, 'word');
  });

  it('nie reaguje na slowo bedace czescia innego wyrazu', () => {
    assert.equal(automod.inspect(message('niebrzydkieslowo'), settings), null);
  });

  it('obsluguje frazy wielowyrazowe', () => {
    assert.equal(automod.inspect(message('to jest zle slowo naprawde'), settings).type, 'word');
  });
});

describe('filtr linkow i zaproszen', () => {
  it('blokuje zaproszenia na inne serwery', () => {
    for (const content of ['wbijaj discord.gg/abcd', 'https://discord.com/invite/xyz']) {
      assert.equal(automod.inspect(message(content), settings)?.type, 'invite', content);
    }
  });

  it('blokuje linki spoza listy dozwolonych', () => {
    assert.equal(automod.inspect(message('zobacz https://evil.example/x'), settings).type, 'link');
  });

  it('przepuszcza domeny z listy dozwolonych (takze z www)', () => {
    assert.equal(automod.inspect(message('https://youtube.com/watch?v=1'), settings), null);
    assert.equal(automod.inspect(message('https://www.youtube.com/watch?v=1'), settings), null);
  });

  it('nie przepuszcza domeny tylko dlatego, ze zawiera dozwolona nazwe', () => {
    assert.equal(automod.inspect(message('https://youtube.com.evil.pl/x'), settings).type, 'link');
  });

  it('przepuszcza subdomeny dozwolonej domeny', () => {
    assert.equal(automod.inspect(message('https://music.youtube.com/x'), settings), null);
  });
});

describe('filtr spamu', () => {
  it('reaguje dopiero po przekroczeniu progu wiadomosci', () => {
    const spamSettings = guilds.update(GUILD, {
      automod_words: false,
      automod_links: false,
      automod_invites: false,
      automod_spam: true,
      automod_spam_messages: 4,
      automod_spam_seconds: 5,
    });

    const spamMessage = { content: 'spam', guild: { id: GUILD }, author: { id: 'spammer' } };

    assert.equal(automod.inspect(spamMessage, spamSettings), null);
    assert.equal(automod.inspect(spamMessage, spamSettings), null);
    assert.equal(automod.inspect(spamMessage, spamSettings), null);
    assert.equal(automod.inspect(spamMessage, spamSettings).type, 'spam', 'czwarta wiadomosc = spam');
  });
});
