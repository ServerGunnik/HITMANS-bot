'use strict';

const {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const guilds = require('../database/repositories/guilds');
const { COLORS, EMOJI, button, panel, row } = require('../ui/components');
const { build: customId } = require('../utils/customId');

const NAMESPACE = 'weryfikacja';

/** Stan zawierajacy oczekujaca captche per user (in-memory). Klucz: `${guildId}:${userId}`. */
const pending = new Map();
/** Licznik nieudanych prob: klucz `${guildId}:${userId}` -> { count, resetAt }. */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPTS_WINDOW_MS = 5 * 60 * 1000;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;

function attemptKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function registerFailure(guildId, userId) {
  const key = attemptKey(guildId, userId);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPTS_WINDOW_MS });
    return { remaining: MAX_ATTEMPTS - 1, blocked: false };
  }
  entry.count += 1;
  const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
  return { remaining, blocked: entry.count >= MAX_ATTEMPTS, resetAt: entry.resetAt };
}

function isBlocked(guildId, userId) {
  const entry = attempts.get(attemptKey(guildId, userId));
  if (!entry) return { blocked: false };
  if (entry.resetAt < Date.now()) {
    attempts.delete(attemptKey(guildId, userId));
    return { blocked: false };
  }
  return { blocked: entry.count >= MAX_ATTEMPTS, resetAt: entry.resetAt };
}

function clearFailures(guildId, userId) {
  attempts.delete(attemptKey(guildId, userId));
}

/** Losuje proste zadanie matematyczne: dodawanie lub odejmowanie na liczbach 1-20. */
function generateChallenge() {
  const a = 1 + Math.floor(Math.random() * 20);
  const b = 1 + Math.floor(Math.random() * 20);
  const op = Math.random() < 0.5 ? '+' : '-';
  const [x, y] = op === '-' && b > a ? [b, a] : [a, b];
  const expected = op === '+' ? x + y : x - y;
  return { question: `${x} ${op} ${y}`, expected };
}

function storeChallenge(guildId, userId, challenge) {
  pending.set(attemptKey(guildId, userId), {
    ...challenge,
    createdAt: Date.now(),
  });
}

function consumeChallenge(guildId, userId) {
  const key = attemptKey(guildId, userId);
  const challenge = pending.get(key);
  pending.delete(key);
  if (!challenge) return null;
  if (Date.now() - challenge.createdAt > CAPTCHA_TTL_MS) return null;
  return challenge;
}

/** Panel publikowany przez administratora — jeden przycisk "Zweryfikuj sie". */
function buildPanel({ title, description } = {}) {
  return panel({
    color: COLORS.info,
    title: title ?? `${EMOJI.shield} Weryfikacja`,
    description:
      description ??
      'Aby uzyskac dostep do pelnej zawartosci serwera, kliknij przycisk ponizej i rozwiaz proste zadanie matematyczne.',
    rows: [
      row(
        button({
          id: customId(NAMESPACE, 'start'),
          label: 'Zweryfikuj sie',
          style: 'success',
          emoji: '🛡️',
        }),
      ),
    ],
    footer: 'Weryfikacja jest jednorazowa — po jej zaliczeniu otrzymasz odpowiednia role.',
  });
}

/** Modal z zadaniem captcha — pokazywany po klikniecu przycisku. */
function buildCaptchaModal(challenge) {
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'answer'))
    .setTitle('Weryfikacja — captcha')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Ile to jest: ${challenge.question} ?`)
        .setDescription('Wpisz sam wynik (liczba, moze byc ujemna).')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('answer')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6)
            .setPlaceholder('np. 12'),
        ),
    );
}

/** Weryfikuje uzytkownika — nadaje role, zwraca { ok, reason }. */
async function grantVerifiedRole(member) {
  const settings = guilds.get(member.guild.id);
  if (!settings.verification_role_id) {
    return { ok: false, reason: 'Rola weryfikacji nie jest ustawiona.' };
  }

  const role = member.guild.roles.cache.get(settings.verification_role_id);
  if (!role) return { ok: false, reason: 'Rola weryfikacji nie istnieje juz na tym serwerze.' };

  if (member.roles.cache.has(role.id)) {
    return { ok: true, alreadyHad: true };
  }

  try {
    await member.roles.add(role, 'Weryfikacja captcha zaliczona');
    return { ok: true, alreadyHad: false };
  } catch (error) {
    return { ok: false, reason: `Nie moglem nadac roli: ${error.message}` };
  }
}

/** Sprzatanie starych captch (uruchamiane cyklicznie). */
function cleanup() {
  const now = Date.now();
  for (const [key, challenge] of pending) {
    if (now - challenge.createdAt > CAPTCHA_TTL_MS) pending.delete(key);
  }
  for (const [key, entry] of attempts) {
    if (entry.resetAt < now) attempts.delete(key);
  }
}

module.exports = {
  NAMESPACE,
  MAX_ATTEMPTS,
  generateChallenge,
  storeChallenge,
  consumeChallenge,
  registerFailure,
  isBlocked,
  clearFailures,
  buildPanel,
  buildCaptchaModal,
  grantVerifiedRole,
  cleanup,
};
