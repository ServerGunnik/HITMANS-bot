'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');
const { Collection } = require('discord.js');

const { loadCommands, toApplicationCommands } = require('../src/handlers/commands');
const { loadComponentHandlers } = require('../src/handlers/interactions');

const client = {
  commands: new Collection(),
  buttons: new Collection(),
  modals: new Collection(),
  selects: new Collection(),
};

before(() => {
  loadCommands(client);
  loadComponentHandlers(client);
});

describe('rejestr komend', () => {
  it('laduje wszystkie komendy wymagane przez specyfikacje', () => {
    const expected = [
      'rekrutacja',
      'rekrutacja-panel',
      'pytania',
      'konfiguracja',
      'setup',
      'rola',
      'kick',
      'ban',
      'timeout',
      'warn',
      'ostrzezenia',
      'automod',
      'stats',
      'profil',
      'pomoc',
      // ekonomia
      'saldo',
      'przelej',
      'dodaj-punkty',
      'odejmij-punkty',
      'ranking',
      'sklep',
      'ekonomia',
    ];

    for (const name of expected) {
      assert.ok(client.commands.has(name), `brakuje komendy /${name}`);
    }
  });

  it('kazda komenda ma opis i funkcje execute', () => {
    for (const [name, command] of client.commands) {
      assert.equal(typeof command.execute, 'function', `/${name}: brak execute`);
      assert.ok(command.data.description?.length > 0, `/${name}: brak opisu`);
    }
  });

  it('generuje poprawny payload dla API Discorda', () => {
    const payload = toApplicationCommands(client.commands);

    assert.equal(payload.length, client.commands.size);
    const names = payload.map((command) => command.name);
    assert.equal(new Set(names).size, names.length, 'nazwy komend sa unikalne');

    for (const command of payload) {
      assert.match(command.name, /^[-_\p{Ll}\p{Lm}\p{Lo}\p{N}]{1,32}$/u, `${command.name}: nieprawidlowa nazwa`);
      assert.ok(command.description.length <= 100);
      assert.ok((command.options ?? []).length <= 25);
    }
  });

  it('komendy administracyjne i moderacyjne maja domyslne ograniczenia uprawnien', () => {
    const restricted = [
      'setup',
      'konfiguracja',
      'pytania',
      'rola',
      'automod',
      'kick',
      'ban',
      'timeout',
      'warn',
      'ekonomia',
      'dodaj-punkty',
      'odejmij-punkty',
    ];

    for (const name of restricted) {
      const json = client.commands.get(name).data.toJSON();
      assert.ok(json.default_member_permissions, `/${name}: brak default_member_permissions`);
    }
  });

  it('komendy serwerowe nie sa dostepne w DM', () => {
    for (const [name, command] of client.commands) {
      const json = command.data.toJSON();
      assert.deepEqual(json.contexts, [0], `/${name}: powinna byc ograniczona do serwera`);
    }
  });
});

describe('handlery komponentow', () => {
  it('rejestruje handlery przyciskow, modali i selectow', () => {
    assert.deepEqual([...client.buttons.keys()].sort(), ['pytania', 'rekrutacja', 'setup', 'sklep']);
    assert.deepEqual([...client.modals.keys()].sort(), ['pytania', 'rekrutacja']);
    assert.deepEqual([...client.selects.keys()].sort(), ['pytania']);
  });

  it('komendy uzywajace autocomplete maja jego obsluge', () => {
    for (const [name, command] of client.commands) {
      const json = command.data.toJSON();
      const hasAutocompleteOption = JSON.stringify(json).includes('"autocomplete":true');
      if (hasAutocompleteOption) {
        assert.equal(typeof command.autocomplete, 'function', `/${name}: brak funkcji autocomplete`);
      }
    }
  });

  it('kazdy handler ma namespace i execute', () => {
    for (const collection of ['buttons', 'modals', 'selects']) {
      for (const [namespace, handler] of client[collection]) {
        assert.equal(typeof handler.execute, 'function', `${collection}:${namespace}`);
      }
    }
  });
});
