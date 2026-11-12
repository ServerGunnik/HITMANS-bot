'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { AttachmentBuilder } = require('discord.js');

const { config } = require('../config');
const guilds = require('../database/repositories/guilds');
const { COLORS, V2_FLAGS, button, panel, row } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const logger = require('../utils/logger');

/**
 * Peleryny Musicmod widoczne na kazdym serwerze Minecraft.
 *
 * Mod (klient) rozmawia z tym serwisem po HTTP:
 *   GET  /v1/capes?uuids=a,b,c   — co nosza podani gracze
 *   GET  /v1/image/<hash>        — obrazek zatwierdzonej wlasnej peleryny (PNG)
 *   GET  /v1/me?uuid=<uuid>      — stan gracza (wybor + stan zgloszenia)
 *   POST /v1/cape                — ustawienie peleryny (wbudowanej / wlasnej / brak)
 *   POST /v1/submit              — zgloszenie wlasnej peleryny do akceptacji
 *
 * Zapisy (POST) wymagaja potwierdzenia konta Minecraft: klient wykonuje
 * `joinServer` z losowym `serverId`, a my pytamy Mojang (`hasJoined`), czy gracz
 * o tym nicku faktycznie to zrobil. Haslo ani token gracza do nas nie trafiaja.
 *
 * Wlasny obrazek jest widoczny dla innych dopiero po akceptacji administracji:
 * zgloszenie trafia jako karta z przyciskami na kanal Discorda.
 */

const NAMESPACE = 'cape';
const CUSTOM = 'custom';
const CAPE_ID = /^[a-z0-9_]{0,32}$/;
const UUID = /^[0-9a-f]{32}$/;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;
const SERVER_ID = /^[0-9a-f]{8,64}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MAX_BODY_BYTES = 700 * 1024;
const MAX_UUIDS_PER_QUERY = 100;
const MAX_WIDTH = 1024;
const SUBMIT_COOLDOWN_MS = 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 240;

const dataDir = () => path.join(path.dirname(config.databasePath), 'capes');
const stateFile = () => path.join(dataDir(), 'state.json');
const imagePath = (hash) => path.join(dataDir(), `${hash}.png`);
const previewPath = (hash) => path.join(dataDir(), `${hash}.preview.png`);

/** uuid -> { name, cape, custom: { state, hash, submittedAt, reviewer } | null } */
let state = null;
let server = null;
let discord = null;
let verifier = verifyWithMojang;
const hits = new Map();

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    state = { players: {} };
  }
  if (!state.players) state.players = {};
  return state;
}

function save() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${stateFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, stateFile());
}

function player(uuid) {
  const players = load().players;
  if (!players[uuid]) players[uuid] = { name: '', cape: '', custom: null };
  return players[uuid];
}

/** Co widza inni gracze: null (nic), { cape: 'id' } albo { cape: 'custom', hash }. */
function visibleCape(uuid) {
  const entry = load().players[uuid];
  if (!entry || !entry.cape) return null;
  if (entry.cape === CUSTOM) {
    return entry.custom?.state === 'approved' ? { cape: CUSTOM, hash: entry.custom.hash } : null;
  }
  return { cape: entry.cape };
}

/** Rozmiar PNG z naglowka IHDR albo null, gdy to nie jest PNG. */
function pngSize(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Sprawdza "standard" peleryny: PNG, proporcje 2:1, rozsadny rozmiar. */
function checkCapeImage(buffer) {
  if (buffer.length > config.capesMaxKb * 1024) return `Obrazek jest za duzy (limit ${config.capesMaxKb} KB).`;
  const size = pngSize(buffer);
  if (!size) return 'To nie jest plik PNG.';
  if (size.width !== size.height * 2) return 'Tekstura peleryny musi miec proporcje 2:1.';
  if (size.width < 64 || size.width > MAX_WIDTH) return `Szerokosc tekstury musi byc od 64 do ${MAX_WIDTH} px.`;
  return null;
}

/** Pyta Mojang, czy gracz `username` dolaczyl do "serwera" `serverId`. Zwraca uuid (bez myslnikow) albo null. */
async function verifyWithMojang(username, serverId) {
  const url =
    'https://sessionserver.mojang.com/session/minecraft/hasJoined' +
    `?username=${encodeURIComponent(username)}&serverId=${encodeURIComponent(serverId)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (response.status !== 200) return null;
  const profile = await response.json();
  return typeof profile?.id === 'string' ? profile.id.toLowerCase() : null;
}

async function authenticate(body) {
  const username = String(body?.username ?? '');
  const serverId = String(body?.serverId ?? '');
  if (!USERNAME.test(username) || !SERVER_ID.test(serverId)) return null;
  try {
    const uuid = await verifier(username, serverId);
    return uuid && UUID.test(uuid) ? { uuid, username } : null;
  } catch (error) {
    logger.debug('Peleryny: weryfikacja Mojang nieudana:', error.message);
    return null;
  }
}

// ─── Operacje ───────────────────────────────────────────────────────────────

function setCape(uuid, username, cape) {
  const entry = player(uuid);
  entry.name = username;
  entry.cape = cape;
  save();
  return status(uuid);
}

function status(uuid) {
  const entry = load().players[uuid];
  return {
    cape: entry?.cape ?? '',
    custom: entry?.custom?.state ?? null,
  };
}

/** Zapisuje zgloszenie wlasnej peleryny jako oczekujace i wysyla karte do administracji. */
async function submit(uuid, username, image, preview) {
  const entry = player(uuid);
  const now = Date.now();
  if (entry.custom?.submittedAt && now - entry.custom.submittedAt < SUBMIT_COOLDOWN_MS) {
    return { error: 'Poczekaj chwile przed kolejnym zgloszeniem.', code: 429 };
  }
  const problem = checkCapeImage(image);
  if (problem) return { error: problem, code: 400 };

  const hash = crypto.createHash('sha256').update(image).digest('hex').slice(0, 32);
  removeFiles(entry.custom?.hash, hash);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(imagePath(hash), image);
  const hasPreview = preview && pngSize(preview) && preview.length <= 200 * 1024;
  if (hasPreview) fs.writeFileSync(previewPath(hash), preview);

  entry.name = username;
  entry.custom = { state: 'pending', hash, submittedAt: now, reviewer: null };
  save();

  const posted = await postReviewCard(uuid).catch((error) => {
    logger.warn('Peleryny: nie udalo sie wyslac karty zgloszenia:', error.message);
    return false;
  });
  if (!posted) logger.warn(`Peleryny: zgloszenie ${username} czeka, ale brak kanalu dla administracji (CAPES_REVIEW_CHANNEL_ID).`);
  return { ok: true, custom: 'pending' };
}

function removeFiles(hash, keep) {
  if (!hash || hash === keep) return;
  for (const file of [imagePath(hash), previewPath(hash)]) {
    fs.rmSync(file, { force: true });
  }
}

/** Decyzja administracji. Zwraca wpis gracza albo null, gdy nie ma czego oceniac. */
function review(uuid, approved, reviewer) {
  const entry = load().players[uuid];
  if (!entry?.custom) return null;
  entry.custom.state = approved ? 'approved' : 'rejected';
  entry.custom.reviewer = reviewer ?? null;
  if (!approved) {
    removeFiles(entry.custom.hash);
    if (entry.cape === CUSTOM) entry.cape = '';
  }
  save();
  return entry;
}

// ─── Discord ────────────────────────────────────────────────────────────────

function reviewChannel() {
  if (!discord) return null;
  if (config.capesReviewChannelId) {
    return discord.channels.cache.get(config.capesReviewChannelId) ?? null;
  }
  // Bez osobnego kanalu: pierwszy skonfigurowany kanal logow moderacji.
  for (const guild of discord.guilds.cache.values()) {
    const channelId = guilds.get(guild.id).modlog_channel_id;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (channel?.isTextBased?.()) return channel;
  }
  return null;
}

/** Karta zgloszenia / decyzji. `entry.custom.state` decyduje o kolorze i przyciskach. */
function buildCard(uuid, entry, { withPreview = true } = {}) {
  const custom = entry.custom;
  const labels = {
    pending: ['🧥 Nowa peleryna do akceptacji', COLORS.warning],
    approved: ['✅ Peleryna zaakceptowana', COLORS.success],
    rejected: ['❌ Peleryna odrzucona', COLORS.danger],
  };
  const [title, color] = labels[custom.state] ?? labels.pending;
  const rows = [];
  if (custom.state === 'pending') {
    rows.push(
      row(
        button({ id: customId(NAMESPACE, 'approve', uuid), label: 'Akceptuj', style: 'success' }),
        button({ id: customId(NAMESPACE, 'reject', uuid), label: 'Odrzuc', style: 'danger' }),
      ),
    );
  } else if (custom.state === 'approved') {
    rows.push(row(button({ id: customId(NAMESPACE, 'reject', uuid), label: 'Cofnij akceptacje', style: 'secondary' })));
  }

  return panel({
    color,
    title,
    description:
      custom.state === 'pending'
        ? 'Gracz chce, zeby inni widzieli jego wlasna peleryne. Akceptuj tylko obrazki zgodne z regulaminem peleryn.'
        : undefined,
    thumbnail: withPreview ? { url: 'attachment://podglad.png', description: 'Podglad peleryny' } : undefined,
    fields: [
      { name: 'Gracz', value: `\`${entry.name || '?'}\``, inline: true },
      { name: 'UUID', value: `\`${uuid}\``, inline: true },
      custom.reviewer ? { name: 'Decyzja', value: custom.reviewer, inline: true } : null,
    ],
    rows,
    footer: 'Standard: PNG, proporcje 2:1, do 1024 px szerokosci. Obrazek widza wszyscy gracze z Musicmod.',
  });
}

function cardFiles(hash) {
  const preview = fs.existsSync(previewPath(hash)) ? previewPath(hash) : imagePath(hash);
  if (!fs.existsSync(preview)) return [];
  return [new AttachmentBuilder(preview).setName('podglad.png')];
}

async function postReviewCard(uuid) {
  const channel = reviewChannel();
  const entry = load().players[uuid];
  if (!channel || !entry?.custom) return false;
  const files = cardFiles(entry.custom.hash);
  await channel.send({
    components: [buildCard(uuid, entry, { withPreview: files.length > 0 })],
    files,
    flags: V2_FLAGS,
    allowedMentions: { parse: [] },
  });
  return true;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

function rateLimited(ip) {
  const now = Date.now();
  const hit = hits.get(ip);
  if (!hit || now - hit.since > RATE_WINDOW_MS) {
    hits.set(ip, { since: now, count: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  hit.count += 1;
  return hit.count > RATE_LIMIT;
}

function sendJson(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('bad json'), { code: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://capes.local');
  const ip = req.socket.remoteAddress ?? '';
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Za duzo zapytan.' });

  if (req.method === 'GET' && url.pathname === '/v1/capes') {
    const uuids = (url.searchParams.get('uuids') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase().replaceAll('-', ''))
      .filter((value) => UUID.test(value))
      .slice(0, MAX_UUIDS_PER_QUERY);
    const result = {};
    for (const uuid of uuids) {
      const cape = visibleCape(uuid);
      if (cape) result[uuid] = cape;
    }
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/v1/me') {
    const uuid = (url.searchParams.get('uuid') ?? '').toLowerCase().replaceAll('-', '');
    if (!UUID.test(uuid)) return sendJson(res, 400, { error: 'Zly uuid.' });
    return sendJson(res, 200, status(uuid));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/image/')) {
    const hash = url.pathname.slice('/v1/image/'.length).replace(/\.png$/, '');
    const approved =
      /^[0-9a-f]{32}$/.test(hash) &&
      Object.values(load().players).some((entry) => entry.custom?.hash === hash && entry.custom.state === 'approved');
    if (!approved || !fs.existsSync(imagePath(hash))) return sendJson(res, 404, { error: 'Brak obrazka.' });
    const data = fs.readFileSync(imagePath(hash));
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(data);
  }

  if (req.method === 'POST' && (url.pathname === '/v1/cape' || url.pathname === '/v1/submit')) {
    const body = await readJson(req);
    const who = await authenticate(body);
    if (!who) return sendJson(res, 401, { error: 'Nie udalo sie potwierdzic konta Minecraft.' });

    if (url.pathname === '/v1/cape') {
      const cape = String(body.cape ?? '');
      if (!CAPE_ID.test(cape)) return sendJson(res, 400, { error: 'Zla nazwa peleryny.' });
      return sendJson(res, 200, setCape(who.uuid, who.username, cape));
    }

    let image;
    let preview = null;
    try {
      image = Buffer.from(String(body.image ?? ''), 'base64');
      if (body.preview) preview = Buffer.from(String(body.preview), 'base64');
    } catch {
      return sendJson(res, 400, { error: 'Zly obrazek.' });
    }
    const result = await submit(who.uuid, who.username, image, preview);
    if (result.error) return sendJson(res, result.code, { error: result.error });
    return sendJson(res, 200, { ...status(who.uuid), ...result });
  }

  return sendJson(res, 404, { error: 'Nie ma takiego adresu.' });
}

/** Uruchamia API (gdy ustawiony jest port; `null` = wylaczone). Zwraca serwer HTTP albo null. */
function start(client, { port = config.capesPort } = {}) {
  discord = client ?? null;
  if (server) return server;
  if (port === null || port === undefined || Number.isNaN(port)) {
    logger.info('Peleryny: API wylaczone (brak CAPES_PORT / SERVER_PORT).');
    return null;
  }
  server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, error.code === 413 || error.code === 400 ? error.code : 500, { error: 'Blad zapytania.' });
      if (!error.code) logger.warn('Peleryny: blad zapytania:', error.message);
    });
  });
  server.on('error', (error) => logger.warn(`Peleryny: API nie wystartowalo (${error.message}).`));
  server.listen(port, '0.0.0.0', () => logger.info(`Peleryny: API nasluchuje na porcie ${server.address().port}.`));
  return server;
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const closing = server;
    server = null;
    closing.close(() => resolve());
  });
}

module.exports = {
  NAMESPACE,
  CUSTOM,
  start,
  stop,
  status,
  visibleCape,
  setCape,
  submit,
  review,
  buildCard,
  cardFiles,
  checkCapeImage,
  pngSize,
  /** Tylko dla testow. */
  _setVerifier: (fn) => {
    verifier = fn ?? verifyWithMojang;
  },
  _reset: () => {
    state = null;
    hits.clear();
  },
};
