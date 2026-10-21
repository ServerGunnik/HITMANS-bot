'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const economy = require('../src/database/repositories/economy');
const { createUser, createMember, createGuild, createInteraction, replyText } = require('./helpers/interaction');

const ekonomiaCommand = require('../src/commands/economy/ekonomia');
const saldoCommand = require('../src/commands/economy/saldo');
const przelejCommand = require('../src/commands/economy/przelej');
const rankingCommand = require('../src/commands/economy/ranking');
const [dodajPunkty, odejmijPunkty] = require('../src/commands/economy/punkty');

const GUILD = 'guild-exec';

let guild;
let admin;
let alice;
let bob;

before(() => database.init());

beforeEach(() => {
  economy.resetGuild(GUILD);
  guilds.update(GUILD, {
    economy_enabled: true,
    currency_name: 'Punkty klanowe',
    currency_emoji: '🪙',
    economy_transfer_min: 1,
  });

  const adminUser = createUser('admin-1', 'admin');
  const aliceUser = createUser('alice-1', 'alice');
  const bobUser = createUser('bob-1', 'bob');

  const members = new Map();
  guild = createGuild(GUILD, { members });

  admin = createMember(adminUser, { guild, admin: true });
  alice = createMember(aliceUser, { guild });
  bob = createMember(bobUser, { guild });

  for (const member of [admin, alice, bob]) members.set(member.id, member);
});

describe('/ekonomia ustaw', () => {
  it('przyjmuje opcje tekstowe (regresja: getBoolean na opcji String rzucal bledem)', async () => {
    const interaction = createInteraction({
      guild,
      member: admin,
      subcommand: 'ustaw',
      options: [
        { name: 'nazwa_waluty', type: 'string', value: 'Kredyty' },
        { name: 'emoji_waluty', type: 'string', value: '💎' },
      ],
    });

    await ekonomiaCommand.execute(interaction);

    const settings = guilds.get(GUILD);
    assert.equal(settings.currency_name, 'Kredyty');
    assert.equal(settings.currency_emoji, '💎');
  });

  it('miesza typy opcji w jednym wywolaniu', async () => {
    const interaction = createInteraction({
      guild,
      member: admin,
      subcommand: 'ustaw',
      options: [
        { name: 'wlaczona', type: 'boolean', value: true },
        { name: 'nazwa_waluty', type: 'string', value: 'Dukaty' },
        { name: 'nagroda_wiadomosc', type: 'integer', value: 5 },
        { name: 'cooldown_wiadomosc', type: 'integer', value: 120 },
      ],
    });

    await ekonomiaCommand.execute(interaction);

    const settings = guilds.get(GUILD);
    assert.equal(settings.economy_enabled, true);
    assert.equal(settings.currency_name, 'Dukaty');
    assert.equal(settings.economy_message_reward, 5);
    assert.equal(settings.economy_message_cooldown, 120);
  });

  it('wylacza ekonomie wartoscia false', async () => {
    const interaction = createInteraction({
      guild,
      member: admin,
      subcommand: 'ustaw',
      options: [{ name: 'wlaczona', type: 'boolean', value: false }],
    });

    await ekonomiaCommand.execute(interaction);
    assert.equal(guilds.get(GUILD).economy_enabled, false);
  });
});

describe('/saldo', () => {
  it('pokazuje wlasne saldo', async () => {
    economy.grant({ guildId: GUILD, userId: alice.id, amount: 320, actorId: 'admin' });

    const interaction = createInteraction({ guild, member: alice });
    await saldoCommand.execute(interaction);

    assert.match(replyText(interaction), /320/);
  });

  it('nie pozwala zwyklemu czlonkowi podejrzec cudzego salda', async () => {
    const interaction = createInteraction({
      guild,
      member: alice,
      options: [{ name: 'uzytkownik', type: 'user', value: bob.user }],
    });

    await saldoCommand.execute(interaction);
    assert.match(replyText(interaction), /tylko administracja/i);
  });

  it('pozwala administracji sprawdzic cudze saldo', async () => {
    economy.grant({ guildId: GUILD, userId: bob.id, amount: 77, actorId: 'admin' });

    const interaction = createInteraction({
      guild,
      member: admin,
      options: [{ name: 'uzytkownik', type: 'user', value: bob.user }],
    });

    await saldoCommand.execute(interaction);
    assert.match(replyText(interaction), /77/);
  });
});

describe('/przelej', () => {
  it('wykonuje przelew miedzy czlonkami', async () => {
    economy.grant({ guildId: GUILD, userId: alice.id, amount: 100, actorId: 'admin' });

    const interaction = createInteraction({
      guild,
      member: alice,
      options: [
        { name: 'uzytkownik', type: 'user', value: bob.user },
        { name: 'kwota', type: 'integer', value: 40 },
        { name: 'powod', type: 'string', value: 'za carry' },
      ],
    });

    await przelejCommand.execute(interaction);

    assert.equal(economy.getBalance(GUILD, alice.id), 60);
    assert.equal(economy.getBalance(GUILD, bob.id), 40);
    assert.match(replyText(interaction), /Przelew wykonany/);
  });

  it('blokuje przelew do siebie i do bota', async () => {
    const toSelf = createInteraction({
      guild,
      member: alice,
      options: [
        { name: 'uzytkownik', type: 'user', value: alice.user },
        { name: 'kwota', type: 'integer', value: 10 },
      ],
    });
    await przelejCommand.execute(toSelf);
    assert.match(replyText(toSelf), /samemu sobie/);

    const toBot = createInteraction({
      guild,
      member: alice,
      options: [
        { name: 'uzytkownik', type: 'user', value: createUser('bot-2', 'bot', { bot: true }) },
        { name: 'kwota', type: 'integer', value: 10 },
      ],
    });
    await przelejCommand.execute(toBot);
    assert.match(replyText(toBot), /Boty nie maja kont/);
  });

  it('blokuje przelew ponad saldo', async () => {
    economy.grant({ guildId: GUILD, userId: alice.id, amount: 5, actorId: 'admin' });

    const interaction = createInteraction({
      guild,
      member: alice,
      options: [
        { name: 'uzytkownik', type: 'user', value: bob.user },
        { name: 'kwota', type: 'integer', value: 50 },
      ],
    });

    await przelejCommand.execute(interaction);

    assert.match(replyText(interaction), /wystarczaj/i);
    assert.equal(economy.getBalance(GUILD, alice.id), 5);
  });

  it('odmawia dzialania przy wylaczonej ekonomii', async () => {
    guilds.update(GUILD, { economy_enabled: false });

    const interaction = createInteraction({
      guild,
      member: alice,
      options: [
        { name: 'uzytkownik', type: 'user', value: bob.user },
        { name: 'kwota', type: 'integer', value: 10 },
      ],
    });

    await przelejCommand.execute(interaction);
    assert.match(replyText(interaction), /wylaczona/);
  });
});

describe('/dodaj-punkty i /odejmij-punkty', () => {
  it('przyznaje i odejmuje punkty', async () => {
    const add = createInteraction({
      guild,
      member: admin,
      options: [
        { name: 'uzytkownik', type: 'user', value: bob.user },
        { name: 'kwota', type: 'integer', value: 250 },
        { name: 'powod', type: 'string', value: 'wygrany turniej' },
      ],
    });

    await dodajPunkty.execute(add);
    assert.equal(economy.getBalance(GUILD, bob.id), 250);

    const remove = createInteraction({
      guild,
      member: admin,
      options: [
        { name: 'uzytkownik', type: 'user', value: bob.user },
        { name: 'kwota', type: 'integer', value: 100 },
      ],
    });

    await odejmijPunkty.execute(remove);
    assert.equal(economy.getBalance(GUILD, bob.id), 150);
  });
});

describe('/ranking', () => {
  it('renderuje ranking najbogatszych', async () => {
    economy.grant({ guildId: GUILD, userId: alice.id, amount: 900, actorId: 'admin' });
    economy.grant({ guildId: GUILD, userId: bob.id, amount: 100, actorId: 'admin' });

    const interaction = createInteraction({ guild, member: alice });
    await rankingCommand.execute(interaction);

    const text = replyText(interaction);
    assert.match(text, /900/);
    assert.ok(text.indexOf(alice.id) < text.indexOf(bob.id), 'bogatszy wyzej w rankingu');
  });

  it('ranking aktywnosci dziala przy wylaczonej ekonomii', async () => {
    guilds.update(GUILD, { economy_enabled: false });

    const interaction = createInteraction({
      guild,
      member: alice,
      options: [{ name: 'typ', type: 'string', value: 'wiadomosci' }],
    });

    await rankingCommand.execute(interaction);
    assert.match(replyText(interaction), /Ranking aktywnosci/);
  });
});
