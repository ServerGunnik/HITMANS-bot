'use strict';

const remindersRepo = require('../database/repositories/reminders');
const { COLORS, panel, V2_FLAGS } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

/** Limit aktywnych przypomnien na osobe (na serwer). */
const MAX_PER_USER = 25;

function buildReminderPanel(reminder, { mention = false } = {}) {
  return panel({
    color: COLORS.info,
    title: '⏰ Przypomnienie',
    description: `${mention ? `<@${reminder.user_id}> ` : ''}${truncate(reminder.content, 1500)}`,
    footer: `Ustawione ${timestamp(reminder.created_at, 'R')} · #${reminder.id}`,
  });
}

/** Dostarcza jedno przypomnienie: najpierw DM, a gdy sie nie uda — kanal, w ktorym je ustawiono. */
async function deliver(client, reminder) {
  const user = await client.users.fetch(reminder.user_id).catch(() => null);
  if (user) {
    const sent = await user
      .send({ components: [buildReminderPanel(reminder)], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .then(() => true)
      .catch(() => false);
    if (sent) return 'dm';
  }

  const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
  if (channel?.isTextBased?.()) {
    const sent = await channel
      .send({
        components: [buildReminderPanel(reminder, { mention: true })],
        flags: V2_FLAGS,
        allowedMentions: { users: [reminder.user_id] },
      })
      .then(() => true)
      .catch(() => false);
    if (sent) return 'channel';
  }
  return null;
}

/** Wysyla zalegle przypomnienia (wywolywane przez scheduler co 30 s). */
async function deliverDue(client, now = Date.now()) {
  const delivered = [];
  for (const reminder of remindersRepo.due(now)) {
    // Usuwamy przed wysylka, zeby blad nie powodowal zapetlenia co tick
    remindersRepo.remove(reminder.id);
    try {
      const via = await deliver(client, reminder);
      if (!via) logger.debug(`Nie udalo sie dostarczyc przypomnienia #${reminder.id}.`);
      delivered.push({ id: reminder.id, via });
    } catch (error) {
      logger.warn(`Blad przypomnienia #${reminder.id}:`, error.message);
    }
  }
  return delivered;
}

module.exports = { MAX_PER_USER, buildReminderPanel, deliver, deliverDue };
