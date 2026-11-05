'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');

const database = require('../src/database');
const birthdaysRepo = require('../src/database/repositories/birthdays');
const starboardRepo = require('../src/database/repositories/starboard');
const ticketsRepo = require('../src/database/repositories/supportTickets');
const birthdays = require('../src/services/birthdays');
const starboard = require('../src/services/starboard');
const tickets = require('../src/services/supportTickets');

const GUILD = 'guild-social';

/** Limity Discorda dla wiadomosci Components V2. */
const MAX_COMPONENTS = 40;
const MAX_CHARACTERS = 4000;

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

function assertModal(modal) {
  const json = modal.toJSON();
  assert.ok(json.title.length <= 45, 'tytul modala do 45 znakow');
  assert.ok(json.components.length <= 5, 'limit 5 pol');
  assert.ok(json.components.every((component) => component.type === 18), 'pola to Label (18)');
  assert.ok(json.components.every((component) => component.label.length <= 45), 'etykiety do 45 znakow');
  return json;
}

const day = (year, month, dayOfMonth, hour = 12) => ({ year, month, day: dayOfMonth, hour, minute: 0 });

before(() => database.init());

describe('urodziny — logika dat', () => {
  it('rozpoznaje lata przestepne', () => {
    assert.equal(birthdays.isLeapYear(2024), true);
    assert.equal(birthdays.isLeapYear(2025), false);
    assert.equal(birthdays.isLeapYear(1900), false);
    assert.equal(birthdays.isLeapYear(2000), true);
  });

  it('waliduje 29 lutego zaleznie od roku', () => {
    assert.equal(birthdays.validate(29, 2, null, 2026).ok, true, 'bez roku dozwolone');
    assert.equal(birthdays.validate(29, 2, 2004, 2026).ok, true, 'rok przestepny');
    assert.equal(birthdays.validate(29, 2, 2003, 2026).ok, false, 'rok nieprzestepny');
    assert.equal(birthdays.validate(31, 4, null, 2026).ok, false, 'kwiecien ma 30 dni');
    assert.equal(birthdays.validate(10, 5, 2030, 2026).ok, false, 'rok z przyszlosci');
    assert.equal(birthdays.validate(10, 5, 1990, 2026).ok, true);
  });

  it('29 lutego swietujemy 28 lutego w latach nieprzestepnych', () => {
    const leapling = { day: 29, month: 2 };
    assert.deepEqual(birthdays.celebrationDate(leapling, 2025), { month: 2, day: 28 });
    assert.deepEqual(birthdays.celebrationDate(leapling, 2028), { month: 2, day: 29 });
    assert.equal(birthdays.isBirthdayOn(leapling, day(2027, 2, 28)), true);
    assert.equal(birthdays.isBirthdayOn(leapling, day(2028, 2, 28)), false);
    assert.equal(birthdays.isBirthdayOn(leapling, day(2028, 2, 29)), true);
  });

  it('liczy dni do urodzin, takze przez przelom roku', () => {
    assert.equal(birthdays.daysUntil({ day: 5, month: 11 }, day(2026, 11, 5)), 0);
    assert.equal(birthdays.daysUntil({ day: 6, month: 11 }, day(2026, 11, 5)), 1);
    assert.equal(birthdays.daysUntil({ day: 2, month: 1 }, day(2026, 12, 30)), 3);
    assert.equal(birthdays.daysUntil({ day: 4, month: 11 }, day(2026, 11, 5)), 364);
    // 29.02 widziane z 27.02.2027 -> 28.02.2027
    assert.equal(birthdays.daysUntil({ day: 29, month: 2 }, day(2027, 2, 27)), 1);
  });

  it('lista nadchodzacych jest posortowana przez przelom roku i ograniczona do 30 dni', () => {
    const entries = [
      { user_id: 'c', day: 10, month: 1, year: 2000 },
      { user_id: 'a', day: 25, month: 12, year: null },
      { user_id: 'd', day: 1, month: 3, year: null },
      { user_id: 'b', day: 2, month: 1, year: null },
      { user_id: 'e', day: 20, month: 12, year: null },
    ];
    const list = birthdays.upcoming(entries, day(2026, 12, 20), 30);
    assert.deepEqual(
      list.map((entry) => entry.user_id),
      ['e', 'a', 'b', 'c'],
    );
    assert.deepEqual(
      list.map((entry) => entry.inDays),
      [0, 5, 13, 21],
    );
    assert.equal(list[3].age, 27, 'wiek w nastepnym roku');
  });

  it('wysyla zyczenia dopiero po 9:00 i raz dziennie', () => {
    assert.equal(birthdays.shouldPost(day(2026, 11, 5, 8), null), false);
    assert.equal(birthdays.shouldPost(day(2026, 11, 5, 9), null), true);
    assert.equal(birthdays.shouldPost(day(2026, 11, 5, 15), '2026-11-05'), false);
    assert.equal(birthdays.shouldPost(day(2026, 11, 6, 9), '2026-11-05'), true);
  });

  it('przelicza czas na strefe Europe/Warsaw (CET i CEST)', () => {
    const winter = birthdays.warsawParts(new Date('2026-11-05T08:30:00Z'));
    assert.deepEqual([winter.year, winter.month, winter.day, winter.hour], [2026, 11, 5, 9]);
    const summer = birthdays.warsawParts(new Date('2026-07-01T22:30:00Z'));
    assert.deepEqual([summer.month, summer.day, summer.hour], [7, 2, 0]);
    assert.equal(birthdays.dateKey(winter), '2026-11-05');
  });
});

describe('urodziny — repozytorium i wysylka', () => {
  it('zapisuje, nadpisuje i usuwa date', () => {
    birthdaysRepo.set(GUILD, 'u1', { day: 1, month: 5, year: 1999 });
    birthdaysRepo.set(GUILD, 'u1', { day: 2, month: 6 });
    const entry = birthdaysRepo.get(GUILD, 'u1');
    assert.equal(entry.day, 2);
    assert.equal(entry.month, 6);
    assert.equal(entry.year, null);
    assert.equal(birthdaysRepo.remove(GUILD, 'u1'), true);
    assert.equal(birthdaysRepo.remove(GUILD, 'u1'), false);
  });

  it('claimDay oznacza dzien tylko raz', () => {
    birthdaysRepo.updateSettings(GUILD, { channel_id: 'ch' });
    assert.equal(birthdaysRepo.claimDay(GUILD, '2026-11-05'), true);
    assert.equal(birthdaysRepo.claimDay(GUILD, '2026-11-05'), false);
    assert.equal(birthdaysRepo.claimDay(GUILD, '2026-11-06'), true);
  });

  it('wygasle role to te nadane innego dnia', () => {
    birthdaysRepo.addRoleGrant(GUILD, 'u2', 'role', '2026-11-04');
    birthdaysRepo.addRoleGrant(GUILD, 'u3', 'role', '2026-11-05');
    const expired = birthdaysRepo.expiredRoleGrants('2026-11-05').filter((grant) => grant.guild_id === GUILD);
    assert.deepEqual(expired.map((grant) => grant.user_id), ['u2']);
    birthdaysRepo.removeRoleGrant(GUILD, 'u2', 'role');
    birthdaysRepo.removeRoleGrant(GUILD, 'u3', 'role');
  });

  it('tick wysyla zyczenia raz — restart tego samego dnia nie dubluje', async () => {
    const guildId = 'guild-bday-tick';
    const sent = [];
    const channel = { isTextBased: () => true, send: async (payload) => sent.push(payload) };
    const member = { id: 'solenizant', roles: { cache: new Map(), add: async () => {} } };
    const guild = {
      id: guildId,
      name: 'Test',
      channels: { cache: new Map([['bday-ch', channel]]) },
      roles: { cache: new Map() },
      members: { fetch: async (id) => (id === 'solenizant' ? member : null) },
    };
    const client = { guilds: { cache: new Map([[guildId, guild]]) } };

    birthdaysRepo.updateSettings(guildId, { channel_id: 'bday-ch' });
    birthdaysRepo.set(guildId, 'solenizant', { day: 5, month: 11, year: 2000 });
    birthdaysRepo.set(guildId, 'ktos-kto-wyszedl', { day: 5, month: 11 });

    const early = new Date('2026-11-05T07:00:00Z'); // 8:00 w Polsce
    const later = new Date('2026-11-05T09:00:00Z'); // 10:00 w Polsce

    await birthdays.tick(client, early);
    assert.equal(sent.length, 0, 'przed 9:00 nic nie wysylamy');

    await birthdays.tick(client, later);
    await birthdays.tick(client, later);
    assert.equal(sent.length, 1, 'jedna wiadomosc dziennie');
    assert.deepEqual(sent[0].allowedMentions.users, ['solenizant']);
    assert.ok(JSON.stringify(sent[0].components[0].toJSON()).includes('**26**'), 'wiek w zyczeniach');
  });
});

describe('urodziny — karty', () => {
  it('lista 40 osob miesci sie w limitach', () => {
    const entries = Array.from({ length: 40 }, (_, index) => ({
      user_id: String(100000000000000000n + BigInt(index)),
      day: (index % 28) + 1,
      month: 11,
      year: 1990,
    }));
    const list = birthdays.upcoming(entries, day(2026, 11, 1), 30);
    assertLimits(birthdays.buildList('Klan', list), 'lista urodzin');
    assertLimits(birthdays.buildList('Klan', []), 'pusta lista');
    assertLimits(birthdays.buildWishes(entries, day(2026, 11, 5)), 'zyczenia');
  });
});

describe('starboard', () => {
  it('nie liczy gwiazdki autora ani botow', () => {
    const users = [
      { id: 'author' },
      { id: 'a' },
      { id: 'bot', bot: true },
      { id: 'b' },
      { id: 'c' },
    ];
    assert.equal(starboard.countStars(users, 'author'), 3);
    assert.equal(starboard.countStars([], 'author'), 0);
  });

  it('decyduje o tworzeniu, aktualizacji i usuwaniu karty', () => {
    assert.equal(starboard.decide({ stars: 2, threshold: 3, existing: null }), 'none');
    assert.equal(starboard.decide({ stars: 3, threshold: 3, existing: null }), 'create');
    assert.equal(starboard.decide({ stars: 4, threshold: 3, existing: { stars: 3 } }), 'update');
    assert.equal(starboard.decide({ stars: 4, threshold: 3, existing: { stars: 4 } }), 'none');
    assert.equal(starboard.decide({ stars: 2, threshold: 3, existing: { stars: 3 } }), 'delete');
  });

  it('karta zawiera tresc, obrazek, link i miesci sie w limitach', () => {
    const message = {
      id: '3',
      channelId: '2',
      url: 'https://discord.com/channels/1/2/3',
      createdTimestamp: Date.UTC(2026, 10, 5),
      content: 'Bardzo dluga wiadomosc '.repeat(300),
      author: { id: '42', username: 'gracz', tag: 'gracz', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
      attachments: new Map([
        ['a', { name: 'screen.png', url: 'https://cdn.discordapp.com/a/screen.png', contentType: 'image/png' }],
        ['b', { name: 'log.txt', url: 'https://cdn.discordapp.com/a/log.txt', contentType: 'text/plain' }],
      ]),
    };
    const card = starboard.buildCard(message, 7);
    assertLimits(card, 'karta starboardu');
    const json = JSON.stringify(card.toJSON());
    assert.ok(json.includes('"type":12'), 'MediaGallery z obrazkiem');
    assert.ok(json.includes('screen.png'));
    assert.ok(json.includes('log.txt'), 'pozostale zalaczniki jako linki');
    assert.ok(json.includes(message.url), 'link do oryginalu');
    assert.ok(json.includes('**⭐ 7**'));
  });

  it('repozytorium: ustawienia domyslne i posty', () => {
    const settings = starboardRepo.getSettings(GUILD);
    assert.equal(settings.threshold, 3);
    assert.equal(settings.enabled, false);

    starboardRepo.updateSettings(GUILD, { channel_id: 'sb', enabled: true });
    starboardRepo.updateSettings(GUILD, { threshold: 5 });
    assert.deepEqual(
      (({ channel_id, threshold, enabled }) => ({ channel_id, threshold, enabled }))(starboardRepo.getSettings(GUILD)),
      { channel_id: 'sb', threshold: 5, enabled: true },
    );

    starboardRepo.createPost({
      guildId: GUILD,
      sourceChannelId: 'c',
      sourceMessageId: 'm1',
      authorId: 'u',
      starboardChannelId: 'sb',
      starboardMessageId: 'card1',
      stars: 5,
    });
    starboardRepo.updateStars('m1', 6);
    assert.equal(starboardRepo.getPost('m1').stars, 6);
    assert.equal(starboardRepo.getPostByStarboardMessage('card1').source_message_id, 'm1');
    assert.equal(starboardRepo.removePost('m1'), true);
    assert.equal(starboardRepo.getPost('m1'), null);
  });
});

describe('tickety pomocy', () => {
  it('jeden otwarty ticket na uzytkownika w kazdej kategorii', () => {
    const first = ticketsRepo.create({ guildId: GUILD, userId: 'u', userTag: 'u', category: 'pomoc', description: 'x' });
    ticketsRepo.create({ guildId: GUILD, userId: 'u', userTag: 'u', category: 'skarga', description: 'y' });

    assert.equal(ticketsRepo.findOpen(GUILD, 'u', 'pomoc').id, first.id);
    assert.ok(ticketsRepo.findOpen(GUILD, 'u', 'skarga'));
    assert.equal(ticketsRepo.findOpen(GUILD, 'u', 'inne'), null);

    ticketsRepo.setChannel(first.id, 'chan-1');
    assert.equal(ticketsRepo.getByChannel('chan-1').id, first.id);
    assert.equal(ticketsRepo.claim(first.id, 'staff').claimed_by, 'staff');

    assert.equal(ticketsRepo.markClosed(first.id, 'staff', 'zalatwione'), true);
    assert.equal(ticketsRepo.markClosed(first.id, 'staff'), false, 'drugie zamkniecie nic nie robi');
    const closed = ticketsRepo.get(first.id);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.close_reason, 'zalatwione');
    assert.equal(ticketsRepo.findOpen(GUILD, 'u', 'pomoc'), null);
  });

  it('ustawienia sa scalane przy aktualizacji', () => {
    ticketsRepo.updateSettings(GUILD, { category_id: 'cat', staff_role_id: 'role' });
    ticketsRepo.updateSettings(GUILD, { log_channel_id: 'logs' });
    const settings = ticketsRepo.getSettings(GUILD);
    assert.equal(settings.category_id, 'cat');
    assert.equal(settings.staff_role_id, 'role');
    assert.equal(settings.log_channel_id, 'logs');
  });

  it('transkrypcja jest chronologiczna, z czasem, autorami i zalacznikami', () => {
    const ticket = {
      id: 7,
      category: 'skarga',
      user_id: '111',
      user_tag: 'zglaszajacy',
      description: 'Ktos spamuje',
      created_at: Date.UTC(2026, 10, 5, 8, 0, 0),
      claimed_by: '222',
    };
    const entries = [
      {
        createdTimestamp: Date.UTC(2026, 10, 5, 8, 5, 0),
        authorId: '222',
        authorTag: 'admin',
        bot: false,
        content: 'Sprawdzam\ndruga linia',
        attachments: [{ name: 'dowod.png', url: 'https://cdn.discordapp.com/x/dowod.png' }],
        embeds: 0,
        components: false,
      },
      {
        createdTimestamp: Date.UTC(2026, 10, 5, 8, 1, 0),
        authorId: 'bot',
        authorTag: 'bot',
        bot: true,
        content: '',
        attachments: [],
        embeds: 0,
        components: true,
      },
    ];

    const transcript = tickets.formatTranscript(ticket, entries, {
      guildName: 'Klan',
      closedByTag: 'admin',
      reason: 'Zalatwione',
      closedAt: Date.UTC(2026, 10, 5, 9, 0, 0),
    });
    const lines = transcript.split('\n');

    assert.ok(lines[0].includes('#7') && lines[0].includes('Skarga'));
    assert.ok(transcript.includes('Powod: Zalatwione'));
    assert.ok(transcript.includes('Otwarty: 2026-11-05 09:00:00'), 'czas polski (CET)');
    const botLine = lines.findIndex((line) => line.includes('bot [BOT] (bot): [wiadomosc z komponentami]'));
    const adminLine = lines.findIndex((line) => line.startsWith('[2026-11-05 09:05:00] admin (222): Sprawdzam'));
    assert.ok(botLine > 0 && adminLine > botLine, 'kolejnosc chronologiczna');
    assert.equal(lines[adminLine + 1], '    druga linia', 'wielolinijkowa tresc z wcieciem');
    assert.equal(lines[adminLine + 2], '    [zalacznik] dowod.png: https://cdn.discordapp.com/x/dowod.png');
    assert.ok(lines.at(-1).includes('Wiadomosci: 2'));
  });

  it('sprowadza wiadomosc Discorda do wpisu transkrypcji', () => {
    const entry = tickets.toTranscriptEntry({
      id: '1',
      createdTimestamp: 1,
      author: { id: '5', tag: 'gracz', bot: false },
      content: 'hej',
      attachments: new Map([['a', { name: 'a.png', url: 'https://x/a.png' }]]),
      embeds: [],
      components: [],
    });
    assert.deepEqual(entry.attachments, [{ name: 'a.png', url: 'https://x/a.png' }]);
    assert.equal(entry.authorTag, 'gracz');
    assert.equal(entry.components, false);
  });

  it('panel, karta ticketu i podsumowanie mieszcza sie w limitach', () => {
    const panelJson = audit(tickets.buildPanel()).json;
    for (const category of Object.keys(tickets.CATEGORIES)) {
      assert.ok(JSON.stringify(panelJson).includes(`"custom_id":"ticket:open:${category}"`));
    }
    assertLimits(tickets.buildPanel({ title: 'T'.repeat(100), description: 'D'.repeat(1500) }), 'panel');

    const ticket = {
      id: 12,
      category: 'pomoc',
      user_id: '1',
      user_tag: 'gracz',
      description: 'Opis '.repeat(200),
      created_at: Date.now(),
      status: 'open',
      claimed_by: null,
    };
    const open = audit(tickets.buildTicketMessage(ticket)).json;
    assert.ok(JSON.stringify(open).includes('ticket:claim:12'));
    assert.ok(JSON.stringify(open).includes('ticket:close:12'));
    assertLimits(tickets.buildTicketMessage(ticket), 'karta ticketu');

    const claimed = JSON.stringify(tickets.buildTicketMessage({ ...ticket, claimed_by: '9' }).toJSON());
    assert.ok(claimed.includes('"disabled":true'), 'Przejmij wylaczony po przejeciu');

    const closedCard = tickets.buildClosedCard(ticket, { closedBy: '9', reason: 'R'.repeat(300), count: 10, fileName: 'ticket-12.txt' });
    assertLimits(closedCard, 'podsumowanie');
    assert.ok(JSON.stringify(closedCard.toJSON()).includes('attachment://ticket-12.txt'), 'komponent pliku');
  });

  it('modale ticketow spelniaja limity', () => {
    for (const category of Object.keys(tickets.CATEGORIES)) {
      assert.equal(assertModal(tickets.buildOpenModal(category)).custom_id, `ticket:submit:${category}`);
    }
    assert.equal(assertModal(tickets.buildCloseModal(123456)).custom_id, 'ticket:close:123456');
  });
});

describe('komendy spolecznosci', () => {
  const { createUser, createMember, createGuild, createInteraction, replyText } = require('./helpers/interaction');
  const urodziny = require('../src/commands/general/urodziny');
  const starboardCommand = require('../src/commands/admin/starboard');
  const ticketPanel = require('../src/commands/admin/ticket-panel');

  const CMD_GUILD = 'guild-social-cmd';
  const members = new Map();
  const guild = createGuild(CMD_GUILD, { members });
  const user = createMember(createUser('member-1', 'gracz'), { guild });
  const admin = createMember(createUser('admin-1', 'admin'), { guild, admin: true });
  members.set(user.id, user);
  members.set(admin.id, admin);

  it('/urodziny ustaw odrzuca 29.02 w roku nieprzestepnym i zapisuje poprawna date', async () => {
    const bad = createInteraction({
      guild,
      member: user,
      subcommand: 'ustaw',
      options: [
        { name: 'dzien', type: 'integer', value: 29 },
        { name: 'miesiac', type: 'integer', value: 2 },
        { name: 'rok', type: 'integer', value: 2001 },
      ],
    });
    await urodziny.execute(bad);
    assert.ok(replyText(bad).includes('28 dni'));
    assert.equal(birthdaysRepo.get(CMD_GUILD, user.id), null);

    const good = createInteraction({
      guild,
      member: user,
      subcommand: 'ustaw',
      options: [
        { name: 'dzien', type: 'integer', value: 29 },
        { name: 'miesiac', type: 'integer', value: 2 },
      ],
    });
    await urodziny.execute(good);
    assert.ok(replyText(good).includes('28 lutego'));
    assert.equal(birthdaysRepo.get(CMD_GUILD, user.id).day, 29);
  });

  it('/urodziny kanal wymaga uprawnien administratora', async () => {
    const channel = { id: 'bday', type: 0, toString: () => '<#bday>' };
    const denied = createInteraction({
      guild,
      member: user,
      subcommand: 'kanal',
      options: [{ name: 'kanal', type: 'channel', value: channel }],
    });
    await urodziny.execute(denied);
    assert.ok(replyText(denied).includes('tylko dla administracji'));
    assert.equal(birthdaysRepo.getSettings(CMD_GUILD).channel_id, null);

    const allowed = createInteraction({
      guild,
      member: admin,
      subcommand: 'kanal',
      options: [{ name: 'kanal', type: 'channel', value: channel }],
    });
    await urodziny.execute(allowed);
    assert.equal(birthdaysRepo.getSettings(CMD_GUILD).channel_id, 'bday');
  });

  it('/urodziny lista odpowiada panelem', async () => {
    const interaction = createInteraction({ guild, member: user, subcommand: 'lista' });
    await urodziny.execute(interaction);
    assert.ok(replyText(interaction).includes('Nadchodzace urodziny'));
  });

  it('/starboard kanal, prog i wylacz zapisuja ustawienia', async () => {
    const channel = { id: 'stars', type: 0, toString: () => '<#stars>' };
    await starboardCommand.execute(
      createInteraction({ guild, member: admin, subcommand: 'kanal', options: [{ name: 'kanal', type: 'channel', value: channel }] }),
    );
    await starboardCommand.execute(
      createInteraction({ guild, member: admin, subcommand: 'prog', options: [{ name: 'liczba', type: 'integer', value: 4 }] }),
    );
    let settings = starboardRepo.getSettings(CMD_GUILD);
    assert.deepEqual([settings.channel_id, settings.threshold, settings.enabled], ['stars', 4, true]);

    await starboardCommand.execute(createInteraction({ guild, member: admin, subcommand: 'wylacz' }));
    settings = starboardRepo.getSettings(CMD_GUILD);
    assert.equal(settings.enabled, false);
  });

  it('/ticket-panel opublikuj wymaga wczesniejszej konfiguracji', async () => {
    const interaction = createInteraction({ guild, member: admin, subcommand: 'opublikuj' });
    await ticketPanel.execute(interaction);
    assert.ok(replyText(interaction).includes('/ticket-panel ustaw'));

    const category = { id: 'cat', type: 4, name: 'Tickety' };
    const role = { id: 'staff', name: 'Obsluga', toString: () => '<@&staff>' };
    await ticketPanel.execute(
      createInteraction({
        guild,
        member: admin,
        subcommand: 'ustaw',
        options: [
          { name: 'kategoria', type: 'channel', value: category },
          { name: 'rola-obslugi', type: 'role', value: role },
        ],
      }),
    );
    const settings = ticketsRepo.getSettings(CMD_GUILD);
    assert.deepEqual([settings.category_id, settings.staff_role_id, settings.log_channel_id], ['cat', 'staff', null]);
  });
});
