'use strict';

const { dir: tmpDir } = require('./setup');

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, before, after, beforeEach } = require('node:test');

process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
process.env.OWNER_IDS = 'owner-1';

const database = require('../src/database');
const backup = require('../src/services/backup');
const updater = require('../src/services/updater');
const statusCommand = require('../src/commands/admin/status');
const backupCommand = require('../src/commands/admin/backup');
const aktualizuj = require('../src/commands/admin/aktualizuj');
const { createUser, createMember, createGuild, createInteraction, replyText } = require('./helpers/interaction');

before(() => database.init());

// ─── Kopie zapasowe ─────────────────────────────────────────────────────────

describe('kopie zapasowe bazy', () => {
  const backupDir = process.env.BACKUP_DIR;

  it('tworzy kopie bazy w BACKUP_DIR', async () => {
    const created = await backup.create();
    assert.ok(fs.existsSync(created.path));
    assert.ok(created.size > 0);
    assert.equal(path.dirname(created.path), backupDir);
    assert.match(created.name, backup.FILE_PATTERN);
    assert.equal(backup.list()[0].name, created.name);
    assert.ok(backup.lastBackupAt() > 0);
  });

  it('usuwa kopie starsze niz okres przechowywania i ignoruje obce pliki', () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const old = path.join(backupDir, 'nlbot-2020-01-01_00-00-00.db');
    const foreign = path.join(backupDir, 'notatki.txt');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(foreign, 'x');
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, longAgo, longAgo);
    fs.utimesSync(foreign, longAgo, longAgo);

    const removed = backup.cleanup({ dir: backupDir, retentionDays: 14 });
    assert.equal(removed, 1);
    assert.ok(!fs.existsSync(old));
    assert.ok(fs.existsSync(foreign), 'pliki spoza wzorca nie sa ruszane');
  });

  it('tick nie robi kolejnej kopii, gdy ostatnia ma mniej niz dobe', async () => {
    const before = backup.list().length;
    assert.equal(await backup.tick(), null);
    assert.equal(backup.list().length, before);
  });
});

describe('/backup teraz', () => {
  async function run(userId) {
    const members = new Map();
    const guild = createGuild('guild-backup', { members });
    const member = createMember(createUser(userId), { guild, admin: true });
    const interaction = createInteraction({ guild, member, subcommand: 'teraz' });
    await backupCommand.execute(interaction);
    return interaction;
  }

  it('wlasciciel dostaje plik kopii jako zalacznik z komponentem File', async () => {
    const interaction = await run('owner-1');
    const last = interaction.replies.at(-1);
    assert.equal(interaction.ephemeral, true);
    assert.equal(last.files?.length, 1);
    assert.match(replyText(interaction), /attachment:\/\/nlbot-/);
  });

  it('administrator spoza OWNER_IDS dostaje tylko potwierdzenie', async () => {
    const interaction = await run('admin-x');
    assert.equal(interaction.replies.at(-1).files, undefined);
    assert.match(replyText(interaction), /OWNER_IDS/);
  });
});

// ─── Aktualizacje ───────────────────────────────────────────────────────────

/** Atrapa gita: odpowiedzi wg pierwszego argumentu, zapis wszystkich wywolan. */
function fakeRunner(responses) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args].join(' '));
    const key = command === 'npm' ? 'npm' : args[0];
    const response = responses[key];
    if (response instanceof Error) throw response;
    if (typeof response === 'function') return { stdout: response(args), stderr: '' };
    return { stdout: response ?? '', stderr: '' };
  };
  run.calls = calls;
  return run;
}

describe('aktualizacja bota', () => {
  beforeEach(() => updater._reset());
  after(() => {
    updater._setRunner(null);
    updater._setExit(null);
  });

  it('check liczy zalegle commity i ich tematy', async () => {
    const runner = fakeRunner({
      fetch: '',
      'rev-list': '2\n',
      log: 'abc1234\tNowa funkcja\ndef5678\tPoprawka bledu\n',
    });
    updater._setRunner(runner);

    const result = await updater.check();
    assert.equal(result.behind, 2);
    assert.deepEqual(result.commits, [
      { hash: 'abc1234', subject: 'Nowa funkcja' },
      { hash: 'def5678', subject: 'Poprawka bledu' },
    ]);
    assert.ok(runner.calls.includes('git fetch --quiet origin main'));
    assert.equal(updater.state.behind, 2);
  });

  it('odmawia przy niezatwierdzonych zmianach', async () => {
    const runner = fakeRunner({ status: ' M src/index.js\n' });
    updater._setRunner(runner);
    const result = await updater.update();
    assert.equal(result.ok, false);
    assert.match(result.reason, /niezatwierdzone/);
    assert.ok(!runner.calls.some((call) => call.startsWith('git pull')));
  });

  it('odmawia, gdy nie da sie zrobic fast-forward', async () => {
    const runner = fakeRunner({
      status: '',
      'rev-list': '1',
      log: 'abc\tx',
      'merge-base': new Error('exit 1'),
    });
    updater._setRunner(runner);
    const result = await updater.update();
    assert.equal(result.ok, false);
    assert.match(result.reason, /fast-forward/);
    assert.ok(!runner.calls.some((call) => call.startsWith('git pull')));
  });

  it('robi pull --ff-only i npm ci tylko przy zmianie package-lock.json', async () => {
    let head = 'aaa1111';
    const responses = {
      status: '',
      'rev-list': '1',
      log: 'bbb2222\tAktualizacja zaleznosci',
      'merge-base': '',
      'rev-parse': () => head,
      diff: 'package-lock.json\nsrc/index.js\n',
      pull: () => {
        head = 'bbb2222';
        return '';
      },
      npm: '',
    };
    const runner = fakeRunner(responses);
    updater._setRunner(runner);

    const result = await updater.update();
    assert.equal(result.ok, true);
    assert.equal(result.updated, true);
    assert.equal(result.from, 'aaa1111');
    assert.equal(result.to, 'bbb2222');
    assert.equal(result.installed, true);
    assert.ok(runner.calls.includes('git pull --ff-only origin main'));
    assert.ok(runner.calls.includes('npm ci --omit=dev'));

    // bez zmiany package-lock.json — bez npm ci
    head = 'aaa1111';
    responses.diff = 'src/index.js\n';
    const runner2 = fakeRunner(responses);
    updater._setRunner(runner2);
    const second = await updater.update();
    assert.equal(second.installed, false);
    assert.ok(!runner2.calls.some((call) => call.startsWith('npm')));
  });

  it('rejestruje komendy slash tylko, gdy zmienily sie pliki komend', async () => {
    let head = 'aaa1111';
    const responses = {
      status: '',
      'rev-list': '1',
      log: 'bbb2222\tNowa komenda',
      'merge-base': '',
      'rev-parse': () => head,
      diff: 'src/commands/general/nowa.js\n',
      pull: () => {
        head = 'bbb2222';
        return '';
      },
    };
    const isDeploy = (call) => call.includes('deploy-commands.js');

    const runner = fakeRunner(responses);
    updater._setRunner(runner);
    const result = await updater.update();
    assert.equal(result.deployed, true);
    assert.ok(runner.calls.some(isDeploy));

    head = 'aaa1111';
    responses.diff = 'src/services/economy.js\n';
    const runner2 = fakeRunner(responses);
    updater._setRunner(runner2);
    const second = await updater.update();
    assert.equal(second.deployed, false);
    assert.ok(!runner2.calls.some(isDeploy));
  });

  it('nic nie robi, gdy bot jest aktualny', async () => {
    const runner = fakeRunner({ status: '', 'rev-list': '0' });
    updater._setRunner(runner);
    const result = await updater.update();
    assert.deepEqual({ ok: result.ok, updated: result.updated }, { ok: true, updated: false });
    assert.ok(!runner.calls.some((call) => call.startsWith('git pull')));
  });

  it('scheduleRestart konczy proces kodem 0', async () => {
    let code = null;
    updater._setExit((value) => {
      code = value;
    });
    updater.scheduleRestart(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(code, 0);
  });

  it('/aktualizuj teraz jest zablokowane dla osob spoza OWNER_IDS', async () => {
    const runner = fakeRunner({});
    updater._setRunner(runner);
    const members = new Map();
    const guild = createGuild('guild-upd', { members });
    const admin = createMember(createUser('not-owner'), { guild, admin: true });
    const interaction = createInteraction({ guild, member: admin, subcommand: 'teraz' });
    await aktualizuj.execute(interaction);
    assert.match(replyText(interaction), /wlasciciel/);
    assert.equal(runner.calls.length, 0);
  });

  it('/status pokazuje wersje z gita i stan bez pobierania z origin', async () => {
    const runner = fakeRunner({ log: 'abc1234\tOstatni commit' });
    updater._setRunner(runner);
    const members = new Map();
    const guild = createGuild('guild-status', { members });
    guild.client.guilds = { cache: new Map([[guild.id, guild]]) };
    guild.client.ws = { ping: 42 };
    const admin = createMember(createUser('admin-status'), { guild, admin: true });
    const interaction = createInteraction({ guild, member: admin });

    await statusCommand.execute(interaction);
    const text = replyText(interaction);
    assert.match(text, /abc1234/);
    assert.match(text, /42 ms/);
    assert.ok(!runner.calls.some((call) => call.includes('fetch')), '/status nie robi git fetch');
  });
});
