'use strict';

const { dir: tmpDir } = require('./setup');

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, before, after, beforeEach } = require('node:test');

const database = require('../src/database');
const capes = require('../src/services/capes');
const { config } = require('../src/config');

const UUID_A = 'a'.repeat(32);
const UUID_B = 'b'.repeat(32);

/** Minimalny "PNG": magiczne bajty + naglowek IHDR z podanym rozmiarem. */
function fakePng(width, height, extra = 80) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(extra, 7)]);
}

let base;

async function call(method, pathname, body) {
  const response = await fetch(base + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
}

before(async () => {
  database.init();
  // "Mojang": nick alice -> UUID_A, bob -> UUID_B, reszta nie przechodzi.
  capes._setVerifier(async (username, serverId) => {
    if (serverId !== 'c0ffee00') return null;
    return { alice: UUID_A, bob: UUID_B }[username] ?? null;
  });
  const server = capes.start(null, { port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await capes.stop();
  capes._setVerifier(null);
});

beforeEach(() => {
  fs.rmSync(path.join(path.dirname(config.databasePath), 'capes'), { recursive: true, force: true });
  capes._reset();
});

describe('API peleryn Musicmod', () => {
  it('ustawia wbudowana peleryne po potwierdzeniu konta i pokazuje ja innym', async () => {
    const set = await call('POST', '/v1/cape', { username: 'alice', serverId: 'c0ffee00', cape: 'galaxy' });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { cape: 'galaxy', custom: null });

    const seen = await call('GET', `/v1/capes?uuids=${UUID_A},${UUID_B},smieci`);
    assert.deepEqual(seen.body, { [UUID_A]: { cape: 'galaxy' } });

    const cleared = await call('POST', '/v1/cape', { username: 'alice', serverId: 'c0ffee00', cape: '' });
    assert.equal(cleared.body.cape, '');
    assert.deepEqual((await call('GET', `/v1/capes?uuids=${UUID_A}`)).body, {});
  });

  it('na serwerach non-premium oddaje peleryne po nicku (bez rozrozniania wielkosci liter)', async () => {
    await call('POST', '/v1/cape', { username: 'alice', serverId: 'c0ffee00', cape: 'moon' });
    const seen = await call('GET', '/v1/capes?uuids=&names=ALICE,bob,zly%20nick');
    assert.deepEqual(seen.body, { '@alice': { cape: 'moon' } });
  });

  it('odrzuca zapis bez potwierdzonego konta i zla nazwe peleryny', async () => {
    const stranger = await call('POST', '/v1/cape', { username: 'mallory', serverId: 'c0ffee00', cape: 'galaxy' });
    assert.equal(stranger.status, 401);
    const wrongServer = await call('POST', '/v1/cape', { username: 'alice', serverId: 'deadbeef', cape: 'galaxy' });
    assert.equal(wrongServer.status, 401);
    const badName = await call('POST', '/v1/cape', { username: 'alice', serverId: 'c0ffee00', cape: '../etc' });
    assert.equal(badName.status, 400);
    assert.deepEqual((await call('GET', `/v1/capes?uuids=${UUID_A}`)).body, {});
  });

  it('wlasna peleryna jest widoczna dopiero po akceptacji, a po odrzuceniu znika', async () => {
    const image = fakePng(512, 256);
    const sent = await call('POST', '/v1/submit', {
      username: 'bob',
      serverId: 'c0ffee00',
      image: image.toString('base64'),
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.custom, 'pending');
    await call('POST', '/v1/cape', { username: 'bob', serverId: 'c0ffee00', cape: 'custom' });

    // Oczekuje: inni nic nie widza, a obrazka nie da sie pobrac.
    assert.deepEqual((await call('GET', `/v1/capes?uuids=${UUID_B}`)).body, {});
    assert.deepEqual((await call('GET', `/v1/me?uuid=${UUID_B}`)).body, { cape: 'custom', custom: 'pending' });

    const entry = capes.review(UUID_B, true, 'admin');
    assert.equal(entry.custom.state, 'approved');
    const visible = (await call('GET', `/v1/capes?uuids=${UUID_B}`)).body[UUID_B];
    assert.equal(visible.cape, 'custom');
    const download = await call('GET', `/v1/image/${visible.hash}`);
    assert.equal(download.status, 200);
    assert.ok(download.body.equals(image));

    capes.review(UUID_B, false, 'admin');
    assert.deepEqual((await call('GET', `/v1/capes?uuids=${UUID_B}`)).body, {});
    assert.equal((await call('GET', `/v1/image/${visible.hash}`)).status, 404);
    assert.equal((await call('GET', `/v1/me?uuid=${UUID_B}`)).body.custom, 'rejected');
  });

  it('pilnuje standardu obrazka: PNG, proporcje 2:1, rozmiar', async () => {
    const submit = (image) =>
      call('POST', '/v1/submit', { username: 'alice', serverId: 'c0ffee00', image: image.toString('base64') });
    assert.equal((await submit(Buffer.alloc(200, 1))).status, 400);
    assert.equal((await submit(fakePng(300, 300))).status, 400);
    assert.equal((await submit(fakePng(4096, 2048))).status, 400);
    assert.equal((await submit(fakePng(64, 32, config.capesMaxKb * 1024))).status, 400);
    assert.equal(capes.status(UUID_A).custom, null);
  });

  it('karta zgloszenia ma przyciski tylko dla oczekujacych i zaakceptowanych', async () => {
    await call('POST', '/v1/submit', { username: 'bob', serverId: 'c0ffee00', image: fakePng(64, 32).toString('base64') });
    const ids = (entry) => JSON.stringify(capes.buildCard(UUID_B, entry, { withPreview: false }).toJSON());
    const pending = ids(capes.review(UUID_B, true, 'x') && { name: 'bob', custom: { state: 'pending', hash: 'h' } });
    assert.match(pending, /cape:approve:b+/);
    assert.match(pending, /cape:reject:b+/);
    const approved = ids({ name: 'bob', custom: { state: 'approved', hash: 'h', reviewer: 'x' } });
    assert.doesNotMatch(approved, /cape:approve/);
    assert.match(approved, /cape:reject/);
    assert.doesNotMatch(ids({ name: 'bob', custom: { state: 'rejected', hash: 'h' } }), /cape:(approve|reject)/);
  });
});
