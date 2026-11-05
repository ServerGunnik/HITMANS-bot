'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');

const database = require('../src/database');
const eventsRepo = require('../src/database/repositories/events');
const warsRepo = require('../src/database/repositories/wars');
const remindersRepo = require('../src/database/repositories/reminders');
const eventsService = require('../src/services/events');
const warsService = require('../src/services/wars');
const remindersService = require('../src/services/reminders');
const eventCommand = require('../src/commands/clan/event');
const wojnaCommand = require('../src/commands/clan/wojna');
const przypomnijCommands = require('../src/commands/general/przypomnij');
const { createUser, createMember, createGuild, createInteraction, replyText } = require('./helpers/interaction');

const GUILD = 'guild-events';
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

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

const snowflake = (n) => String(100000000000000000n + BigInt(n));

/** Atrapa klienta zbierajaca wyslane wiadomosci. */
function createClient({ dmBlocked = false } = {}) {
  const sent = { channel: [], dm: [], edits: [] };
  const message = { edit: async (payload) => sent.edits.push(payload) };
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      sent.channel.push(payload);
      return { id: 'msg', url: 'https://discord.com/x' };
    },
    messages: { fetch: async () => message },
  };
  return {
    sent,
    channels: { fetch: async () => channel },
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          if (dmBlocked) throw new Error('Cannot send messages to this user');
          sent.dm.push({ id, payload });
        },
      }),
    },
  };
}

function newEvent(overrides = {}, now = Date.now()) {
  return eventsRepo.create(
    {
      guildId: GUILD,
      channelId: 'chan',
      authorId: 'officer',
      title: 'Wojna z Wilkami',
      description: 'Zbiorka na spawnie',
      startsAt: now + 2 * HOUR,
      ...overrides,
    },
    now,
  );
}

before(() => database.init());

describe('repozytorium wydarzen', () => {
  it('zapisy: dodanie, zmiana i wypisanie', () => {
    const event = newEvent();
    assert.equal(eventsRepo.setRsvp(event.id, 'a', 'yes'), 'added');
    assert.equal(eventsRepo.setRsvp(event.id, 'b', 'maybe'), 'added');
    assert.equal(eventsRepo.setRsvp(event.id, 'c', 'no'), 'added');
    assert.equal(eventsRepo.setRsvp(event.id, 'b', 'yes'), 'changed');
    assert.deepEqual(eventsRepo.rsvps(event.id), { yes: ['a', 'b'], maybe: [], no: ['c'] });
    assert.equal(eventsRepo.setRsvp(event.id, 'a', 'yes'), 'removed');
    assert.deepEqual(eventsRepo.rsvps(event.id).yes, ['b']);
  });

  it('nie zwraca wydarzenia z innego serwera', () => {
    const event = newEvent();
    assert.equal(eventsRepo.getForGuild('inny', event.id), null);
    assert.equal(eventsRepo.getForGuild(GUILD, event.id).id, event.id);
  });

  it('przypomnienia: harmonogram i reset po zmianie terminu', () => {
    const now = Date.now();
    const event = newEvent({ startsAt: now + 20 * MIN }, now);
    assert.equal(event.reminded_30, true, 'za pozno na 30 min — oznaczone z gory');
    assert.equal(event.reminded_5, false);

    assert.ok(!eventsRepo.dueReminders(5, now).some((e) => e.id === event.id));
    assert.ok(eventsRepo.dueReminders(5, now + 16 * MIN).some((e) => e.id === event.id));

    const moved = eventsRepo.update(event.id, { starts_at: now + 3 * HOUR }, now);
    assert.equal(moved.reminded_30, false);
    assert.equal(moved.reminded_5, false);
    assert.ok(eventsRepo.dueReminders(30, now + 2.5 * HOUR + MIN).some((e) => e.id === event.id));
  });

  it('obecnosc i statystyki obecnosci', () => {
    const event = newEvent();
    eventsRepo.setAttendance(event.id, ['p1', 'p2'], true, 'officer');
    eventsRepo.setAttendance(event.id, ['p3'], false, 'officer');
    eventsRepo.setAttendance(event.id, ['p2'], false, 'officer');
    const result = eventsRepo.attendance(event.id);
    assert.deepEqual(result.present, ['p1']);
    assert.deepEqual([...result.absent].sort(), ['p2', 'p3']);
    assert.deepEqual(eventsRepo.memberAttendance(GUILD, 'p1'), { present: 1, absent: 0 });
  });
});

describe('karta wydarzenia', () => {
  it('ma 3 przyciski zapisow i miesci sie w limitach przy duzej liczbie zapisanych', () => {
    const event = newEvent({ title: 'T'.repeat(100), description: 'Opis '.repeat(200) });
    for (let i = 0; i < 120; i += 1) {
      eventsRepo.setRsvp(event.id, snowflake(i), ['yes', 'maybe', 'no'][i % 3]);
    }
    const { json, components, characters } = audit(eventsService.buildCard(eventsRepo.get(event.id)));
    assert.equal(json.type, 17);
    assert.ok(components <= MAX_COMPONENTS, `${components} komponentow`);
    assert.ok(characters <= MAX_CHARACTERS, `${characters} znakow`);
    const text = JSON.stringify(json);
    for (const status of ['yes', 'maybe', 'no']) assert.ok(text.includes(`wydarzenie:rsvp:${event.id}:${status}`));
    assert.ok(text.includes('Bede (40)'));
  });

  it('odwolane / rozpoczete wydarzenie nie ma przyciskow', () => {
    const event = newEvent();
    const cancelled = eventsRepo.setStatus(event.id, 'cancelled');
    assert.ok(!JSON.stringify(eventsService.buildCard(cancelled).toJSON()).includes('wydarzenie:rsvp'));
    const started = eventsRepo.setStatus(event.id, 'started');
    assert.ok(!JSON.stringify(eventsService.buildCard(started).toJSON()).includes('wydarzenie:rsvp'));
  });

  it('przypomnienie miesci sie w limitach', () => {
    const event = newEvent();
    const ids = Array.from({ length: 100 }, (_, i) => snowflake(i));
    const { components, characters } = audit(eventsService.buildReminder(event, ids));
    assert.ok(components <= MAX_COMPONENTS);
    assert.ok(characters <= MAX_CHARACTERS, `${characters} znakow`);
  });
});

describe('scheduler wydarzen', () => {
  it('wysyla przypomnienie 30 min z pingiem Bede+Moze, potem 5 min, potem zamyka zapisy', async () => {
    const now = Date.now();
    const event = newEvent({ startsAt: now + 2 * HOUR, dmReminders: true }, now);
    eventsRepo.setRsvp(event.id, 'u-yes', 'yes');
    eventsRepo.setRsvp(event.id, 'u-maybe', 'maybe');
    eventsRepo.setRsvp(event.id, 'u-no', 'no');
    eventsRepo.setMessage(event.id, 'card');

    const client = createClient();
    const at30 = event.starts_at - 29 * MIN;
    await eventsService.processEvents(client, at30);
    const mine = (list) => list.filter((payload) => JSON.stringify(payload.components[0].toJSON()).includes(`Wydarzenie #${event.id}"`));
    assert.equal(mine(client.sent.channel).length, 1);
    assert.deepEqual(mine(client.sent.channel)[0].allowedMentions.users, ['u-yes', 'u-maybe']);
    assert.deepEqual(client.sent.dm.map((entry) => entry.id).filter((id) => id.startsWith('u-')), ['u-yes', 'u-maybe']);

    await eventsService.processEvents(client, at30 + MIN);
    assert.equal(mine(client.sent.channel).length, 1, 'bez duplikatu');

    await eventsService.processEvents(client, event.starts_at - 4 * MIN);
    assert.equal(mine(client.sent.channel).length, 2);

    await eventsService.processEvents(client, event.starts_at + 1000);
    assert.equal(eventsRepo.get(event.id).status, 'started');
  });

  it('nie wysyla spoznionych przypomnien po przestoju bota', async () => {
    const now = Date.now();
    const event = newEvent({ startsAt: now + 2 * HOUR }, now);
    const client = createClient();
    await eventsService.processEvents(client, event.starts_at + MIN);
    const text = JSON.stringify(client.sent.channel.map((p) => p.components[0].toJSON()));
    assert.ok(!text.includes(`Wydarzenie #${event.id}"`));
    const refreshed = eventsRepo.get(event.id);
    assert.equal(refreshed.status, 'started');
    assert.equal(refreshed.reminded_30 && refreshed.reminded_5, true);
  });
});

describe('wojny', () => {
  const WG = 'guild-wars';

  it('bilans, procent wygranych i ranking', () => {
    warsRepo.create({ guildId: WG, opponent: 'Wilki', result: 'win', score: '3:1', participants: ['a', 'b'], recordedBy: 'o', foughtAt: 1000 });
    warsRepo.create({ guildId: WG, opponent: 'wilki', result: 'loss', participants: ['a', 'c'], recordedBy: 'o', foughtAt: 2000 });
    warsRepo.create({ guildId: WG, opponent: 'Orly', result: 'draw', participants: ['a', 'a', 'b'], recordedBy: 'o', foughtAt: 3000 });
    warsRepo.create({ guildId: WG, opponent: 'Orly', result: 'win', participants: ['b'], recordedBy: 'o', foughtAt: 4000 });

    assert.deepEqual({ ...warsRepo.summary(WG) }, { wins: 2, losses: 1, draws: 1, total: 4 });
    assert.deepEqual({ ...warsRepo.summary(WG, { opponent: 'WILKI' }) }, { wins: 1, losses: 1, draws: 0, total: 2 });
    assert.equal(warsService.winRate(warsRepo.summary(WG)), 50);

    const byBattles = warsRepo.ranking(WG);
    // a i b maja po 3 bitwy — remis rozstrzygaja wygrane
    assert.deepEqual(byBattles.map((e) => [e.user_id, e.battles, e.wins]), [['b', 3, 2], ['a', 3, 1], ['c', 1, 0]]);
    const byWins = warsRepo.ranking(WG, { by: 'wins' });
    assert.equal(byWins[0].user_id, 'b');
    assert.equal(byWins[0].wins, 2);

    assert.deepEqual({ ...warsRepo.memberStats(WG, 'a') }, { battles: 3, wins: 1, losses: 1, draws: 1 });
    assert.match(warsService.profileSummary(WG, 'a'), /Bitwy: \*\*3\*\*/);
    assert.equal(warsService.profileSummary(WG, 'nikt'), null);

    assert.equal(warsRepo.recent(WG, { limit: 2 })[0].opponent, 'Orly');
  });

  it('usuwanie dziala tylko w obrebie serwera', () => {
    const war = warsRepo.create({ guildId: WG, opponent: 'X', result: 'win', recordedBy: 'o' });
    assert.equal(warsRepo.remove('inny', war.id), false);
    assert.equal(warsRepo.remove(WG, war.id), true);
    assert.equal(warsRepo.get(war.id), null);
  });

  it('panele miesza sie w limitach', () => {
    const guild = { id: WG, name: 'Klan' };
    for (let i = 0; i < 15; i += 1) {
      warsRepo.create({
        guildId: WG,
        opponent: 'Bardzo dluga nazwa przeciwnika '.repeat(4),
        result: 'win',
        score: '1234567890:1234567890',
        participants: Array.from({ length: 30 }, (_, n) => snowflake(n + i)),
        recordedBy: 'o',
      });
    }
    for (const container of [
      warsService.buildStatsPanel(guild),
      warsService.buildRankingPanel(guild, { by: 'wins' }),
      warsService.buildWarCard(warsRepo.get(warsRepo.recent(WG, { limit: 1 })[0].id)),
    ]) {
      const { components, characters } = audit(container);
      assert.ok(components <= MAX_COMPONENTS);
      assert.ok(characters <= MAX_CHARACTERS, `${characters} znakow`);
    }
  });
});

describe('przypomnienia', () => {
  it('repozytorium: lista, usuwanie i termin', () => {
    const now = Date.now();
    const a = remindersRepo.create({ guildId: GUILD, channelId: 'c', userId: 'r1', content: 'A', remindAt: now + HOUR });
    remindersRepo.create({ guildId: GUILD, channelId: 'c', userId: 'r1', content: 'B', remindAt: now + MIN });
    assert.deepEqual(remindersRepo.listForUser(GUILD, 'r1').map((r) => r.content), ['B', 'A']);
    assert.equal(remindersRepo.countForUser(GUILD, 'r1'), 2);
    assert.equal(remindersRepo.removeForUser(GUILD, 'r2', a.id), false, 'cudzego nie usunie');
    assert.equal(remindersRepo.removeForUser(GUILD, 'r1', a.id), true);
    assert.equal(remindersRepo.countForUser(GUILD, 'r1'), 1);
  });

  it('dostarcza w DM, a przy zablokowanych DM na kanale; usuwa po dostarczeniu', async () => {
    const now = Date.now();
    const dm = remindersRepo.create({ guildId: GUILD, channelId: 'c', userId: 'dm-user', content: 'Wojna!', remindAt: now - 1 });
    let client = createClient();
    let delivered = await remindersService.deliverDue(client, now);
    assert.deepEqual(delivered.find((d) => d.id === dm.id), { id: dm.id, via: 'dm' });
    assert.equal(remindersRepo.get(dm.id), null);

    const fallback = remindersRepo.create({ guildId: GUILD, channelId: 'c', userId: 'blocked', content: 'Hej', remindAt: now - 1 });
    client = createClient({ dmBlocked: true });
    delivered = await remindersService.deliverDue(client, now);
    assert.deepEqual(delivered.find((d) => d.id === fallback.id), { id: fallback.id, via: 'channel' });
    assert.deepEqual(client.sent.channel[0].allowedMentions, { users: ['blocked'] });
  });

  it('wylicza termin z opcji za/kiedy', () => {
    const now = Date.UTC(2026, 10, 5, 14, 0);
    const { resolveRemindAt } = przypomnijCommands;
    assert.equal(resolveRemindAt({ za: '2h' }, now).at, now + 2 * HOUR);
    assert.equal(resolveRemindAt({ za: 'za 30m' }, now).at, now + 30 * MIN);
    assert.equal(resolveRemindAt({ kiedy: 'jutro 20:00' }, now).at, Date.UTC(2026, 10, 6, 19, 0));
    assert.ok(resolveRemindAt({}, now).error);
    assert.ok(resolveRemindAt({ za: '2h', kiedy: '20:00' }, now).error);
    assert.ok(resolveRemindAt({ za: '10s' }, now).error, 'za krotko');
    assert.ok(resolveRemindAt({ kiedy: 'kiedys' }, now).error);
  });
});

describe('komendy', () => {
  let guild;
  let officer;
  let member;

  before(() => {
    const members = new Map();
    guild = createGuild('guild-cmd-events', { members });
    officer = createMember(createUser('officer-1', 'oficer'), { guild, admin: true });
    member = createMember(createUser('member-1', 'gracz'), { guild });
    members.set(officer.id, officer);
    members.set(member.id, member);
  });

  it('/event utworz publikuje karte i zapisuje wydarzenie', async () => {
    const interaction = createInteraction({
      guild,
      member: officer,
      subcommand: 'utworz',
      options: [
        { name: 'tytul', type: 'string', value: 'Obrona zamku' },
        { name: 'start', type: 'string', value: 'za 3h' },
      ],
    });
    const published = [];
    interaction.channel.send = async (payload) => {
      published.push(payload);
      return { id: 'card-msg', url: 'https://discord.com/card' };
    };

    await eventCommand.execute(interaction);
    assert.equal(published.length, 1);
    assert.match(replyText(interaction), /opublikowane/);
    const [event] = eventsRepo.listUpcoming('guild-cmd-events');
    assert.equal(event.title, 'Obrona zamku');
    assert.equal(event.message_id, 'card-msg');
  });

  it('/event utworz odrzuca termin w przeszlosci', async () => {
    const interaction = createInteraction({
      guild,
      member: officer,
      subcommand: 'utworz',
      options: [
        { name: 'tytul', type: 'string', value: 'X' },
        { name: 'start', type: 'string', value: '2020-01-01 20:00' },
      ],
    });
    await eventCommand.execute(interaction);
    assert.match(replyText(interaction), /przyszlosci/);
  });

  it('/wojna wynik wymaga oficera i bierze uczestnikow z wydarzenia', async () => {
    const denied = createInteraction({
      guild,
      member,
      subcommand: 'wynik',
      options: [
        { name: 'przeciwnik', type: 'string', value: 'Wilki' },
        { name: 'rezultat', type: 'string', value: 'win' },
      ],
    });
    await wojnaCommand.execute(denied);
    assert.match(replyText(denied), /oficerowie/);

    const event = eventsRepo.create({ guildId: 'guild-cmd-events', channelId: 'c', authorId: 'o', title: 'E', startsAt: Date.now() + HOUR });
    eventsRepo.setRsvp(event.id, 'warrior-1', 'yes');
    eventsRepo.setRsvp(event.id, 'warrior-2', 'maybe');

    const interaction = createInteraction({
      guild,
      member: officer,
      subcommand: 'wynik',
      options: [
        { name: 'przeciwnik', type: 'string', value: 'Wilki' },
        { name: 'rezultat', type: 'string', value: 'win' },
        { name: 'wynik_punktowy', type: 'string', value: '3:0' },
        { name: 'wydarzenie', type: 'integer', value: event.id },
      ],
    });
    await wojnaCommand.execute(interaction);
    assert.match(replyText(interaction), /Wygrana/);
    const [war] = warsRepo.recent('guild-cmd-events', { limit: 1 });
    assert.deepEqual(warsRepo.get(war.id).participants, ['warrior-1']);
    assert.equal(war.event_id, event.id);
  });

  it('/przypomnij zapisuje przypomnienie, a /przypomnienia je pokazuje', async () => {
    const [przypomnij, przypomnienia] = przypomnijCommands;
    const create = createInteraction({
      guild,
      member,
      options: [
        { name: 'tresc', type: 'string', value: 'Zbiorka na wojne' },
        { name: 'za', type: 'string', value: '2h' },
      ],
    });
    await przypomnij.execute(create);
    assert.match(replyText(create), /Przypomne/);

    const list = createInteraction({ guild, member, subcommand: 'lista' });
    await przypomnienia.execute(list);
    assert.match(replyText(list), /Zbiorka na wojne/);
  });
});
