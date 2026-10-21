'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');

const database = require('../src/database');
const logsRepo = require('../src/database/repositories/logs');
const serverLogs = require('../src/services/serverLogs');

const GUILD = 'guild-logs';
const OTHER_GUILD = 'guild-logs-2';

/** Atrapa serwera zbierajaca wiadomosci wyslane na kanal logow. */
function createGuild(id = GUILD, { canSend = true } = {}) {
  const sent = [];

  const channel = {
    id: 'log-channel',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => canSend }),
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
  };

  return {
    id,
    name: 'Klan Testowy',
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    members: { me: { permissions: { has: () => true } } },
    sent,
  };
}

before(() => database.init());

beforeEach(() => {
  logsRepo.clear(GUILD);
  logsRepo.clear(OTHER_GUILD);
  for (const type of ['channel', 'role', 'user']) {
    for (const id of logsRepo.listIgnores(GUILD)[type]) logsRepo.removeIgnore(GUILD, type, id);
  }
});

describe('konfiguracja logow', () => {
  it('domyslnie wszystkie kategorie sa wylaczone', () => {
    for (const entry of logsRepo.list(GUILD)) {
      assert.equal(entry.enabled, false, entry.category);
      assert.equal(entry.channelId, null);
    }
  });

  it('ustawia kanal dla jednej kategorii', () => {
    logsRepo.setChannel(GUILD, 'messages', 'chan-1');

    assert.deepEqual(logsRepo.getCategory(GUILD, 'messages'), { channelId: 'chan-1', enabled: true });
    assert.equal(logsRepo.getCategory(GUILD, 'voice').enabled, false, 'inne kategorie bez zmian');
  });

  it('kieruje wszystkie kategorie na jeden kanal', () => {
    logsRepo.setAll(GUILD, 'chan-all');

    for (const entry of logsRepo.list(GUILD)) {
      assert.equal(entry.channelId, 'chan-all', entry.category);
      assert.equal(entry.enabled, true, entry.category);
    }
  });

  it('wylacza kategorie zachowujac kanal', () => {
    logsRepo.setChannel(GUILD, 'members', 'chan-2');
    logsRepo.setEnabled(GUILD, 'members', false);

    const category = logsRepo.getCategory(GUILD, 'members');
    assert.equal(category.enabled, false);
    assert.equal(category.channelId, 'chan-2', 'kanal zostaje zapamietany');
  });

  it('trzyma konfiguracje osobno dla kazdego serwera', () => {
    logsRepo.setAll(GUILD, 'chan-a');
    assert.equal(logsRepo.getCategory(OTHER_GUILD, 'messages').channelId, null);
  });

  it('czysci konfiguracje', () => {
    logsRepo.setAll(GUILD, 'chan-a');
    assert.ok(logsRepo.clear(GUILD) > 0);
    assert.equal(logsRepo.getCategory(GUILD, 'messages').enabled, false);
  });
});

describe('wykluczenia', () => {
  it('pomija kanaly, role i osoby z listy', () => {
    logsRepo.addIgnore(GUILD, 'channel', 'chan-secret');
    logsRepo.addIgnore(GUILD, 'user', 'user-bot');
    logsRepo.addIgnore(GUILD, 'role', 'role-staff');

    assert.equal(logsRepo.isIgnored(GUILD, { channelId: 'chan-secret' }), true);
    assert.equal(logsRepo.isIgnored(GUILD, { userId: 'user-bot' }), true);
    assert.equal(logsRepo.isIgnored(GUILD, { roleIds: ['role-x', 'role-staff'] }), true);
    assert.equal(logsRepo.isIgnored(GUILD, { channelId: 'chan-public', userId: 'user-x', roleIds: ['role-x'] }), false);
  });

  it('usuwa wykluczenia i nie duplikuje wpisow', () => {
    assert.equal(logsRepo.addIgnore(GUILD, 'channel', 'chan-1'), true);
    assert.equal(logsRepo.addIgnore(GUILD, 'channel', 'chan-1'), false, 'duplikat');
    assert.equal(logsRepo.removeIgnore(GUILD, 'channel', 'chan-1'), true);
    assert.equal(logsRepo.isIgnored(GUILD, { channelId: 'chan-1' }), false);
  });

  it('nie miesza wykluczen miedzy serwerami', () => {
    logsRepo.addIgnore(GUILD, 'user', 'user-1');
    assert.equal(logsRepo.isIgnored(OTHER_GUILD, { userId: 'user-1' }), false);
  });
});

describe('wysylka logow', () => {
  it('nie wysyla nic, gdy kategoria nie jest skonfigurowana', async () => {
    const guild = createGuild();
    const sent = await serverLogs.send(guild, 'messages', { title: 'Test' });

    assert.equal(sent, false);
    assert.equal(guild.sent.length, 0);
  });

  it('wysyla kontener Components V2 na skonfigurowany kanal', async () => {
    const guild = createGuild();
    logsRepo.setChannel(GUILD, 'messages', 'log-channel');

    const sent = await serverLogs.send(guild, 'messages', {
      title: 'Wiadomosc usunieta',
      fields: [{ name: 'Autor', value: 'ktos' }],
    });

    assert.equal(sent, true);
    assert.equal(guild.sent.length, 1);

    const payload = guild.sent[0];
    const container = payload.components[0].toJSON();
    assert.equal(container.type, 17, 'Container (17)');
    assert.equal(payload.flags, require('discord.js').MessageFlags.IsComponentsV2);
    assert.deepEqual(payload.allowedMentions, { parse: [] }, 'logi nie pinguja');
    assert.match(JSON.stringify(container), /Wiadomosc usunieta/);
  });

  it('pomija wysylke przy wylaczonej kategorii', async () => {
    const guild = createGuild();
    logsRepo.setChannel(GUILD, 'voice', 'log-channel');
    logsRepo.setEnabled(GUILD, 'voice', false);

    assert.equal(await serverLogs.send(guild, 'voice', { title: 'Test' }), false);
    assert.equal(guild.sent.length, 0);
  });

  it('nie wywraca sie, gdy bot nie ma uprawnien do kanalu', async () => {
    const guild = createGuild(GUILD, { canSend: false });
    logsRepo.setChannel(GUILD, 'server', 'log-channel');

    assert.equal(await serverLogs.send(guild, 'server', { title: 'Test' }), false);
  });

  it('kazda kategoria ma opis i emoji', () => {
    for (const category of logsRepo.CATEGORIES) {
      const meta = serverLogs.CATEGORY_META[category];
      assert.ok(meta?.label, `${category}: brak etykiety`);
      assert.ok(meta?.emoji, `${category}: brak emoji`);
      assert.ok(meta?.description, `${category}: brak opisu`);
    }
  });
});

describe('znaczniki akcji bota', () => {
  it('pozwalaja pominac zdarzenie wywolane komenda bota', () => {
    serverLogs.markBotAction(GUILD, 'user-1', 'ban');

    assert.equal(serverLogs.consumeBotAction(GUILD, 'user-1', 'ban'), true, 'pierwsze sprawdzenie');
    assert.equal(serverLogs.consumeBotAction(GUILD, 'user-1', 'ban'), false, 'znacznik jest jednorazowy');
  });

  it('nie myli uzytkownikow, akcji ani serwerow', () => {
    serverLogs.markBotAction(GUILD, 'user-1', 'ban');

    assert.equal(serverLogs.consumeBotAction(GUILD, 'user-2', 'ban'), false);
    assert.equal(serverLogs.consumeBotAction(GUILD, 'user-1', 'timeout'), false);
    assert.equal(serverLogs.consumeBotAction(OTHER_GUILD, 'user-1', 'ban'), false);
    assert.equal(serverLogs.consumeBotAction(GUILD, 'user-1', 'ban'), true, 'oryginalny znacznik nadal dziala');
  });
});
