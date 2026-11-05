'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

const { config } = require('../config');
const guilds = require('../database/repositories/guilds');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const logger = require('../utils/logger');

/**
 * Aktualizacja bota z gita. Bot dziala pod PM2 — po `git pull` konczymy
 * proces kodem 0, a PM2 uruchamia go ponownie juz z nowym kodem.
 * Wszystkie polecenia ida przez execFile (bez powloki i bez interpolacji).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REMOTE = 'origin';
const BRANCH = 'main';
const UPSTREAM = `${REMOTE}/${BRANCH}`;
const GIT_TIMEOUT_MS = 60 * 1000;
const NPM_TIMEOUT_MS = 10 * 60 * 1000;
const RESTART_DELAY_MS = 2000;
/** Bez AUTO_UPDATE sprawdzamy w tle rzadziej — tylko na potrzeby /status. */
const PASSIVE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_LISTED_COMMITS = 10;
const DEPLOY_SCRIPT = path.join('src', 'deploy-commands.js');

/** Czy zmieniony plik wplywa na definicje komend slash. */
function commandsChanged(file) {
  return file.startsWith('src/commands/') || file === 'src/deploy-commands.js' || file === 'src/handlers/commands.js';
}

/** Domyslny runner: execFile z cwd = katalog repozytorium. */
function defaultRunner(command, args, { timeout = GIT_TIMEOUT_MS } = {}) {
  // Na Windowsie npm to plik .cmd, ktory wymaga powloki (argumenty sa stale).
  const isNpm = command === 'npm';
  const file = isNpm && process.platform === 'win32' ? 'npm.cmd' : command;

  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: REPO_ROOT, timeout, windowsHide: true, shell: isNpm && process.platform === 'win32', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

let runner = defaultRunner;
let exit = (code) => process.exit(code);

/** Stan ostatniego sprawdzenia (uzywany przez /status). */
const state = {
  checkedAt: null,
  behind: null,
  commits: [],
  error: null,
};

let busy = false;
let lastAutoRun = 0;
let versionCache = null;

async function git(...args) {
  const { stdout } = await runner('git', args, { timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

/** Krotki hash + temat aktualnego commita (cache — HEAD zmienia sie tylko przy restarcie). */
async function currentVersion() {
  if (versionCache) return versionCache;
  try {
    const line = await git('log', '-1', '--format=%h%x09%s');
    const [hash, ...subject] = line.split('\t');
    versionCache = { hash, subject: subject.join('\t'), source: 'git' };
  } catch {
    const { version } = require('../../package.json');
    versionCache = { hash: null, subject: `v${version}`, source: 'package.json' };
  }
  return versionCache;
}

/** Pobiera origin i liczy commity, o ktore jestesmy do tylu. */
async function check() {
  try {
    await git('fetch', '--quiet', REMOTE, BRANCH);
    const behind = Number.parseInt(await git('rev-list', '--count', `HEAD..${UPSTREAM}`), 10) || 0;
    const log = behind
      ? await git('log', `--max-count=${MAX_LISTED_COMMITS}`, '--format=%h%x09%s', `HEAD..${UPSTREAM}`)
      : '';
    const commits = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ...subject] = line.split('\t');
        return { hash, subject: subject.join('\t') };
      });

    Object.assign(state, { checkedAt: Date.now(), behind, commits, error: null });
  } catch (error) {
    Object.assign(state, { checkedAt: Date.now(), error: shortError(error) });
  }
  return { ...state };
}

function shortError(error) {
  const detail = String(error?.stderr || error?.message || error).trim().split('\n')[0];
  return detail.slice(0, 300);
}

/**
 * Przeprowadza aktualizacje: kontrola czystego drzewa i fast-forward,
 * `git pull --ff-only`, a gdy zmienil sie package-lock.json — `npm ci --omit=dev`.
 * Zwraca { ok, updated, reason?, from, to, commits, installed }.
 */
async function update() {
  if (busy) return { ok: false, reason: 'Aktualizacja juz trwa.' };
  busy = true;

  try {
    const dirty = await git('status', '--porcelain', '--untracked-files=no');
    if (dirty) {
      return { ok: false, reason: 'W katalogu bota sa niezatwierdzone zmiany (git status) — aktualizacja wstrzymana.' };
    }

    const checked = await check();
    if (checked.error) return { ok: false, reason: `Blad git fetch: ${checked.error}` };
    if (!checked.behind) return { ok: true, updated: false, commits: [] };

    try {
      await runner('git', ['merge-base', '--is-ancestor', 'HEAD', UPSTREAM], { timeout: GIT_TIMEOUT_MS });
    } catch {
      return { ok: false, reason: `Lokalna galaz rozjechala sie z ${UPSTREAM} — wymagana reczna aktualizacja (brak fast-forward).` };
    }

    const from = await git('rev-parse', '--short', 'HEAD');
    const changed = (await git('diff', '--name-only', 'HEAD', UPSTREAM)).split('\n').map((line) => line.trim());

    await git('pull', '--ff-only', REMOTE, BRANCH);
    const to = await git('rev-parse', '--short', 'HEAD');

    let installed = false;
    if (changed.includes('package-lock.json')) {
      await runner('npm', ['ci', '--omit=dev'], { timeout: NPM_TIMEOUT_MS });
      installed = true;
    }

    // Nowe lub zmienione komendy trzeba zarejestrowac w Discordzie (npm run deploy),
    // inaczej po restarcie bot ma nowy kod, a Discord stare komendy.
    let deployed = false;
    let deployError = null;
    if (changed.some(commandsChanged)) {
      try {
        await runner(process.execPath, [DEPLOY_SCRIPT], { timeout: GIT_TIMEOUT_MS });
        deployed = true;
      } catch (error) {
        // Kod juz jest pobrany — nie cofamy aktualizacji, tylko zglaszamy problem.
        deployError = shortError(error);
        logger.warn('Rejestracja komend po aktualizacji nie powiodla sie:', deployError);
      }
    }

    Object.assign(state, { checkedAt: Date.now(), behind: 0, commits: [], error: null });
    logger.info(`Zaktualizowano bota ${from} -> ${to}${installed ? ' (npm ci)' : ''}${deployed ? ' (deploy komend)' : ''}.`);
    return {
      ok: true,
      updated: true,
      from,
      to,
      commits: checked.commits,
      behindCount: checked.behind,
      installed,
      deployed,
      deployError,
    };
  } catch (error) {
    return { ok: false, reason: shortError(error) };
  } finally {
    busy = false;
  }
}

/** Konczy proces po chwili, zeby zdazyc wyslac odpowiedz — PM2 uruchomi bota ponownie. */
function scheduleRestart(delay = RESTART_DELAY_MS) {
  logger.info(`Restart po aktualizacji za ${delay} ms (PM2 uruchomi bota ponownie).`);
  const timer = setTimeout(() => exit(0), delay);
  return timer;
}

/** Krotka notka na kanale logow moderacji kazdego serwera (jesli ustawiony). */
async function notify(client, result) {
  const container = panel({
    color: COLORS.info,
    title: '🔄 Automatyczna aktualizacja bota',
    description:
      `Wersja \`${result.from}\` → \`${result.to}\` (${result.behindCount} commit(ow)).` +
      (result.installed ? '\nZaktualizowano zaleznosci (npm ci).' : '') +
      (result.deployed ? '\nZarejestrowano komendy slash.' : '') +
      (result.deployError ? '\n⚠️ Rejestracja komend nie powiodla sie — potrzebne `npm run deploy`.' : '') +
      '\nBot zaraz uruchomi sie ponownie.',
  });

  for (const guild of client.guilds.cache.values()) {
    const channelId = guilds.get(guild.id).modlog_channel_id;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased?.()) continue;
    await channel
      .send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch((error) => logger.debug(`Notka o aktualizacji (${guild.id}):`, error.message));
  }
}

/**
 * Wywolywane przez scheduler. Z AUTO_UPDATE=true sprawdza co
 * AUTO_UPDATE_INTERVAL_MINUTES i sam sie aktualizuje; bez tego
 * tylko odswieza informacje o zaleglosciach (rzadko).
 */
async function tick(client, { now = Date.now() } = {}) {
  const interval = config.autoUpdate ? config.autoUpdateIntervalMinutes * 60 * 1000 : PASSIVE_CHECK_INTERVAL_MS;
  if (lastAutoRun && now - lastAutoRun < interval) return null;
  lastAutoRun = now;

  if (!config.autoUpdate) {
    const result = await check();
    if (result.error) logger.debug('Sprawdzanie aktualizacji:', result.error);
    return null;
  }

  const result = await update();
  if (!result.ok) {
    logger.warn('Automatyczna aktualizacja nieudana:', result.reason);
    return result;
  }
  if (result.updated) {
    await notify(client, result);
    scheduleRestart();
  }
  return result;
}

module.exports = {
  REPO_ROOT,
  UPSTREAM,
  state,
  currentVersion,
  check,
  update,
  scheduleRestart,
  tick,
  /** Podmiana runnera i exit — tylko dla testow. */
  _setRunner: (fn) => {
    runner = fn ?? defaultRunner;
    versionCache = null;
  },
  _setExit: (fn) => {
    exit = fn ?? ((code) => process.exit(code));
  },
  _reset: () => {
    Object.assign(state, { checkedAt: null, behind: null, commits: [], error: null });
    busy = false;
    lastAutoRun = 0;
    versionCache = null;
  },
};
