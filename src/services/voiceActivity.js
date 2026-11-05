'use strict';

const activityRepo = require('../database/repositories/clanActivity');
const logger = require('../utils/logger');

/**
 * Pomiar czasu na kanalach glosowych (do /nieaktywni i raportu tygodniowego).
 * Trwajace sesje trzymamy w pamieci i co tick schedulera dopisujemy przyrost do bazy,
 * wiec restart bota traci najwyzej ~30 s.
 */
const sessions = new Map(); // `${guildId}:${userId}` -> { guildId, userId, since }
let seeded = false;

function keyOf(guildId, userId) {
  return `${guildId}:${userId}`;
}

/** Kanal AFK i brak kanalu nie licza sie jako aktywnosc. */
function isCountable(state) {
  return Boolean(state?.channelId) && state.channelId !== state.guild?.afkChannelId;
}

function credit(session, now) {
  const seconds = Math.floor((now - session.since) / 1000);
  if (seconds <= 0) return;
  activityRepo.addVoiceTime(session.guildId, session.userId, seconds, now);
  session.since += seconds * 1000;
}

/** Wywolywane z eventu voiceStateUpdate. */
function handleVoiceState(oldState, newState, now = Date.now()) {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;
  if (!guild || !member || member.user?.bot) return;

  const key = keyOf(guild.id, member.id);
  const was = isCountable(oldState);
  const is = isCountable(newState);
  if (!was && !is) return;

  const session = sessions.get(key);
  if (session) credit(session, now);

  if (is) {
    if (!session) sessions.set(key, { guildId: guild.id, userId: member.id, since: now });
  } else {
    sessions.delete(key);
  }

  // Dolaczenie/wyjscie samo w sobie tez jest "ostatnia aktywnoscia".
  activityRepo.addVoiceTime(guild.id, member.id, 0, now);
}

/** Po starcie bota: zaczyna liczyc osoby, ktore juz siedza na kanalach. */
function seed(client, now = Date.now()) {
  for (const guild of client.guilds?.cache?.values?.() ?? []) {
    for (const state of guild.voiceStates?.cache?.values?.() ?? []) {
      if (!isCountable(state) || state.member?.user?.bot) continue;
      const key = keyOf(guild.id, state.id);
      if (!sessions.has(key)) sessions.set(key, { guildId: guild.id, userId: state.id, since: now });
    }
  }
}

/** Dopisuje czas wszystkich trwajacych sesji (co tick schedulera). */
function flush(client, now = Date.now()) {
  if (!seeded) {
    seeded = true;
    seed(client, now);
  }
  for (const session of sessions.values()) {
    try {
      credit(session, now);
    } catch (error) {
      logger.debug('Nie udalo sie zapisac czasu glosowego:', error.message);
    }
  }
}

function activeSessions() {
  return sessions.size;
}

function reset() {
  sessions.clear();
  seeded = false;
}

module.exports = { handleVoiceState, flush, seed, activeSessions, reset, isCountable };
