'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const economy = require('../src/database/repositories/economy');
const shopRepo = require('../src/database/repositories/shop');
const shopService = require('../src/services/shop');

const GUILD = 'guild-shop';
const USER = 'user-shop';

/** Minimalne atrapy obiektow discord.js potrzebne w logice zakupu. */
function createGuild({ roleFails = false } = {}) {
  const role = { id: 'role-vip', name: 'VIP', managed: false, position: 5, toString: () => '<@&role-vip>' };

  return {
    id: GUILD,
    roles: {
      cache: new Map([[role.id, role]]),
      everyone: { id: 'everyone' },
    },
    members: {
      me: { permissions: { has: () => true }, roles: { highest: { position: 50 } } },
    },
    client: { user: { id: 'bot' } },
    _role: role,
    _roleFails: roleFails,
  };
}

function createMember(guild, { roles = [] } = {}) {
  const cache = new Map(roles.map((id) => [id, { id }]));

  return {
    id: USER,
    guild,
    roles: {
      cache,
      add: async (role) => {
        if (guild._roleFails) throw new Error('Missing Permissions');
        cache.set(role.id ?? role, role);
      },
    },
  };
}

function addItem(overrides = {}) {
  return shopRepo.addItem(GUILD, {
    name: 'Rola VIP',
    description: 'Wyroznienie na liscie czlonkow',
    price: 100,
    type: 'role',
    roleId: 'role-vip',
    ...overrides,
  });
}

before(() => {
  database.init();
  guilds.update(GUILD, { economy_enabled: true });
});

beforeEach(() => {
  economy.resetGuild(GUILD);
  for (const item of shopRepo.listItems(GUILD)) shopRepo.removeItem(GUILD, item.id);
  // Historia zakupow nie jest czyszczona przez resetGuild — kasujemy ja,
  // zeby kolejne przypadki startowaly z pustym stanem.
  database.getDb().prepare('DELETE FROM shop_purchases WHERE guild_id = ?').run(GUILD);
});

/** dueExpirations() celowo obejmuje wszystkie serwery (uzywa go scheduler). */
function dueForGuild(at) {
  return shopRepo.dueExpirations(at).filter((entry) => entry.guild_id === GUILD);
}

describe('zakupy w sklepie', () => {
  it('pobiera punkty, nadaje role i zapisuje zakup', async () => {
    const guild = createGuild();
    const member = createMember(guild);
    const item = addItem();

    economy.grant({ guildId: GUILD, userId: USER, amount: 150, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member, item });

    assert.equal(result.ok, true);
    assert.equal(economy.getBalance(GUILD, USER), 50);
    assert.ok(member.roles.cache.has('role-vip'), 'rola zostala nadana');
    assert.equal(shopRepo.listPurchases(GUILD, USER)[0].item_name, 'Rola VIP');
    assert.equal(result.transaction.type, 'shop_purchase');
  });

  it('blokuje zakup bez wystarczajacych srodkow', async () => {
    const guild = createGuild();
    const member = createMember(guild);
    const item = addItem();

    economy.grant({ guildId: GUILD, userId: USER, amount: 30, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member, item });

    assert.equal(result.ok, false);
    assert.match(result.reason, /srodk/i);
    assert.equal(economy.getBalance(GUILD, USER), 30, 'saldo bez zmian');
    assert.equal(shopRepo.listPurchases(GUILD, USER).length, 0);
  });

  it('zwraca punkty, gdy nadanie roli sie nie powiedzie', async () => {
    const guild = createGuild({ roleFails: true });
    const member = createMember(guild);
    const item = addItem();

    economy.grant({ guildId: GUILD, userId: USER, amount: 100, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member, item });

    assert.equal(result.ok, false);
    assert.equal(economy.getBalance(GUILD, USER), 100, 'punkty wrocily na konto');
    assert.equal(shopRepo.listPurchases(GUILD, USER).length, 0, 'zakup nie zostal zapisany');

    const lastEntry = economy.history(GUILD, { limit: 1 })[0];
    assert.equal(lastEntry.type, 'revert', 'zwrot jest widoczny w ksiedze');
  });

  it('nie pozwala kupic dwa razy tej samej roli na stale', async () => {
    const guild = createGuild();
    const item = addItem();
    const member = createMember(guild, { roles: ['role-vip'] });

    economy.grant({ guildId: GUILD, userId: USER, amount: 500, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member, item });

    assert.equal(result.ok, false);
    assert.match(result.reason, /Masz juz role/);
    assert.equal(economy.getBalance(GUILD, USER), 500);
  });

  it('pilnuje stanu magazynowego', async () => {
    const guild = createGuild();
    const item = addItem({ stock: 1, type: 'custom', roleId: null });

    economy.grant({ guildId: GUILD, userId: USER, amount: 500, actorId: 'admin' });

    const first = await shopService.purchase({ guild, member: createMember(guild), item });
    assert.equal(first.ok, true);
    assert.equal(shopRepo.getItem(GUILD, item.id).stock, 0);

    const soldOut = await shopService.purchase({ guild, member: createMember(guild), item: shopRepo.getItem(GUILD, item.id) });
    assert.equal(soldOut.ok, false);
    assert.match(soldOut.reason, /wyprzedan/i);
  });

  it('odrzuca zakup wylaczonego przedmiotu', async () => {
    const guild = createGuild();
    const item = addItem();
    shopRepo.updateItem(GUILD, item.id, { enabled: false });

    economy.grant({ guildId: GUILD, userId: USER, amount: 500, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member: createMember(guild), item: shopRepo.getItem(GUILD, item.id) });
    assert.equal(result.ok, false);
  });
});

describe('role czasowe', () => {
  it('ustawia termin wygasniecia i blokuje podwojny zakup', async () => {
    const guild = createGuild();
    const item = addItem({ type: 'temp_role', durationHours: 24 });

    economy.grant({ guildId: GUILD, userId: USER, amount: 500, actorId: 'admin' });

    const result = await shopService.purchase({ guild, member: createMember(guild), item });

    assert.equal(result.ok, true);
    assert.ok(result.expiresAt > Date.now(), 'zakup ma termin wygasniecia');
    assert.equal(shopRepo.activeTempRoles(GUILD, USER).length, 1);

    const again = await shopService.purchase({ guild, member: createMember(guild), item });
    assert.equal(again.ok, false);
    assert.match(again.reason, /aktywny zakup/);
  });

  it('wykrywa zakupy do wygaszenia', async () => {
    const guild = createGuild();
    const item = addItem({ type: 'temp_role', durationHours: 24 });

    economy.grant({ guildId: GUILD, userId: USER, amount: 500, actorId: 'admin' });
    const result = await shopService.purchase({ guild, member: createMember(guild), item });

    assert.equal(dueForGuild(Date.now()).length, 0, 'jeszcze nie wygasl');
    assert.equal(dueForGuild(result.expiresAt + 1).length, 1, 'po terminie trafia do kolejki');

    shopRepo.markExpired(dueForGuild(result.expiresAt + 1)[0].id);
    assert.equal(dueForGuild(result.expiresAt + 1).length, 0);
    assert.equal(shopRepo.activeTempRoles(GUILD, USER).length, 0);
  });
});

describe('panel sklepu', () => {
  it('renderuje przedmioty jako sekcje z przyciskami i miesci sie w limitach', () => {
    const guild = createGuild();
    for (let i = 0; i < 12; i += 1) addItem({ name: `Przedmiot ${i}`, price: 10 * (i + 1), type: 'custom', roleId: null });

    const json = shopService.buildShopPanel(guild, { balance: 100 }).toJSON();

    let components = 0;
    let characters = 0;
    const walk = (node) => {
      components += 1;
      if (node.content) characters += node.content.length;
      if (node.accessory) walk(node.accessory);
      for (const child of node.components ?? []) walk(child);
    };
    walk(json);

    assert.equal(json.type, 17);
    assert.ok(components <= 40, `${components} komponentow`);
    assert.ok(characters <= 4000, `${characters} znakow`);

    const sections = json.components.filter((component) => component.type === 9);
    assert.equal(sections.length, shopService.ITEMS_PER_PAGE, 'paginacja ogranicza liczbe pozycji');
    assert.ok(sections.every((section) => section.accessory.type === 2), 'kazda pozycja ma przycisk');
  });

  it('wylacza przycisk zakupu, gdy nie stac uzytkownika', () => {
    const guild = createGuild();
    addItem({ name: 'Drogi przedmiot', price: 9999, type: 'custom', roleId: null });

    const json = shopService.buildShopPanel(guild, { balance: 10 }).toJSON();
    const section = json.components.find((component) => component.type === 9);

    assert.equal(section.accessory.disabled, true);
  });

  it('informuje o pustym sklepie', () => {
    const json = shopService.buildShopPanel(createGuild()).toJSON();
    assert.match(JSON.stringify(json), /Sklep jest pusty/);
  });
});
