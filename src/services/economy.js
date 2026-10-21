'use strict';

const guilds = require('../database/repositories/guilds');
const economy = require('../database/repositories/economy');
const logger = require('../utils/logger');
const { formatNumber } = require('../utils/format');

/** Jak czesto naliczamy nagrody za obecnosc na kanale glosowym. */
const VOICE_TICK_MS = 60 * 1000;

/** Sformatowana kwota w walucie serwera, np. "🪙 1 250 Punkty klanowe". */
function formatCurrency(guildId, amount, { short = false } = {}) {
  const settings = guilds.get(guildId);
  const emoji = settings.currency_emoji || '🪙';
  const value = formatNumber(amount);
  return short ? `${emoji} ${value}` : `${emoji} **${value}** ${settings.currency_name || 'Punkty klanowe'}`;
}

function currencyName(guildId) {
  return guilds.get(guildId).currency_name || 'Punkty klanowe';
}

/**
 * Nagroda za wiadomosc. Cooldown chroni przed farmieniem punktow spamem —
 * liczy sie czas od ostatniej nagrody, nie liczba wiadomosci.
 */
function rewardMessage(message) {
  const settings = guilds.get(message.guild.id);

  if (!settings.economy_enabled) return null;

  const reward = settings.economy_message_reward ?? 0;
  if (reward <= 0) return null;

  const cooldown = settings.economy_message_cooldown ?? 60;
  if (!economy.canEarnMessage(message.guild.id, message.author.id, cooldown)) return null;

  return economy.earn({
    guildId: message.guild.id,
    userId: message.author.id,
    amount: reward,
    kind: 'message',
    reason: 'Aktywnosc na czacie',
  });
}

/** Czy dany stan glosowy kwalifikuje sie do nagrody. */
function isEligibleVoiceState(state, settings, channelPopulation) {
  if (!state.channelId || !state.member || state.member.user.bot) return false;
  if (state.channelId === state.guild.afkChannelId) return false;

  // Wyciszeni przez siebie (lub zagluszeni) nie uczestnicza w rozmowie.
  if (state.selfDeaf || state.deaf) return false;

  const minMembers = settings.economy_voice_min_members ?? 2;
  return (channelPopulation.get(state.channelId) ?? 0) >= minMembers;
}

/** Nalicza punkty wszystkim uprawnionym osobom na kanalach glosowych. */
function runVoiceTick(client) {
  let rewarded = 0;

  for (const guild of client.guilds.cache.values()) {
    const settings = guilds.get(guild.id);
    if (!settings.economy_enabled) continue;

    const reward = settings.economy_voice_reward ?? 0;
    if (reward <= 0) continue;

    // Liczba osob (bez botow) na kazdym kanale — potrzebna do progu min. uczestnikow.
    const population = new Map();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || state.member?.user.bot) continue;
      population.set(state.channelId, (population.get(state.channelId) ?? 0) + 1);
    }

    for (const state of guild.voiceStates.cache.values()) {
      if (!isEligibleVoiceState(state, settings, population)) continue;

      try {
        economy.earn({
          guildId: guild.id,
          userId: state.id,
          amount: reward,
          kind: 'voice',
          reason: 'Obecnosc na kanale glosowym',
          voiceMinutes: 1,
        });
        rewarded += 1;
      } catch (error) {
        logger.debug(`Nagroda glosowa dla ${state.id} nie powiodla sie:`, error.message);
      }
    }
  }

  return rewarded;
}

/** Uruchamia cykliczne naliczanie nagrod za kanaly glosowe. */
function startVoiceRewards(client) {
  const timer = setInterval(() => {
    try {
      const rewarded = runVoiceTick(client);
      if (rewarded > 0) logger.debug(`Nagrody glosowe: ${rewarded} osob.`);
    } catch (error) {
      logger.warn('Blad naliczania nagrod glosowych:', error.message);
    }
  }, VOICE_TICK_MS);

  timer.unref();
  return timer;
}

module.exports = {
  VOICE_TICK_MS,
  formatCurrency,
  currencyName,
  rewardMessage,
  runVoiceTick,
  isEligibleVoiceState,
  startVoiceRewards,
};
