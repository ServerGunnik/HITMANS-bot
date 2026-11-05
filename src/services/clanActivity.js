'use strict';

const activityRepo = require('../database/repositories/clanActivity');
const leaves = require('./leaves');
const voiceActivity = require('./voiceActivity');
const weeklyReport = require('./weeklyReport');
const logger = require('../utils/logger');

/**
 * Punkt wejscia funkcji "aktywnosc klanu" dla eventow i schedulera:
 * sledzenie aktywnosci, urlopy i raport tygodniowy.
 */

/** messageCreate: dzienna aktywnosc osoby. */
function onMessage(message) {
  try {
    activityRepo.trackMessageDay(message.guild.id, message.author.id);
  } catch (error) {
    logger.debug('Nie udalo sie zapisac dziennej aktywnosci:', error.message);
  }
}

/** voiceStateUpdate: czas na kanalach glosowych. */
function onVoiceState(oldState, newState) {
  try {
    voiceActivity.handleVoiceState(oldState, newState);
  } catch (error) {
    logger.debug('Nie udalo sie zapisac aktywnosci glosowej:', error.message);
  }
}

/** guildMemberAdd / guildMemberRemove: licznik dolaczen i wyjsc do raportu. */
function onMemberEvent(member, type) {
  if (!member?.guild || member.user?.bot) return;
  try {
    activityRepo.recordMemberEvent(member.guild.id, member.id, type);
  } catch (error) {
    logger.debug('Nie udalo sie zapisac dolaczenia/wyjscia:', error.message);
  }
}

/** Wywolywane przez scheduler co 30 s. */
async function tick(client) {
  voiceActivity.flush(client);
  await leaves.processDue(client).catch((error) => logger.warn('Scheduler urlopow:', error.message));
  await weeklyReport.processDue(client).catch((error) => logger.warn('Scheduler raportu tygodniowego:', error.message));
}

module.exports = { onMessage, onVoiceState, onMemberEvent, tick };
