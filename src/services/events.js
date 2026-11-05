'use strict';

const eventsRepo = require('../database/repositories/events');
const remindersService = require('./reminders');
const { COLORS, button, panel, row, V2_FLAGS } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { mentionList } = require('../utils/mentions');
const { isOfficer } = require('../utils/permissions');
const { timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'wydarzenie';

/** Maksymalna liczba osob pingowanych w jednym przypomnieniu (limit allowed_mentions). */
const MAX_PINGS = 100;

const RSVP_META = {
  yes: { label: 'Bede', emoji: '✅', style: 'success' },
  maybe: { label: 'Moze', emoji: '❔', style: 'secondary' },
  no: { label: 'Nie bede', emoji: '❌', style: 'danger' },
};

function messageUrl(event) {
  if (!event.message_id) return null;
  return `https://discord.com/channels/${event.guild_id}/${event.channel_id}/${event.message_id}`;
}

/** Karta wydarzenia z licznikami zapisow — publikacja i odswiezanie. */
function buildCard(event) {
  const signups = eventsRepo.rsvps(event.id);
  const cancelled = event.status === 'cancelled';
  const started = event.status === 'started';

  const meta = [`Organizuje <@${event.author_id}>`];
  if (event.ping_role_id) meta.push(`dla <@&${event.ping_role_id}>`);

  const blocks = [];
  if (event.description) blocks.push(truncate(event.description, 1000));
  blocks.push(`🕒 **Start:** ${timestamp(event.starts_at, 'F')} (${timestamp(event.starts_at, 'R')})`);
  if (cancelled) blocks.push('🚫 **Wydarzenie odwolane.**');
  else if (started) blocks.push('🏁 **Wydarzenie rozpoczete** — zapisy zamkniete.');

  const fields = Object.entries(RSVP_META).map(([status, info]) => ({
    name: `${info.emoji} ${info.label} (${signups[status].length})`,
    value: mentionList(signups[status], 25),
  }));

  const rows = cancelled || started
    ? []
    : [
        row(
          Object.entries(RSVP_META).map(([status, info]) =>
            button({
              id: customId(NAMESPACE, 'rsvp', event.id, status),
              label: `${info.label} (${signups[status].length})`,
              emoji: info.emoji,
              style: info.style,
            }),
          ),
        ),
      ];

  return panel({
    color: cancelled ? COLORS.danger : started ? COLORS.neutral : COLORS.clan,
    title: `📅 ${truncate(event.title, 200)}`,
    description: `-# ${meta.join(' · ')}`,
    blocks,
    fields,
    rows,
    footer: `Wydarzenie #${event.id}${
      cancelled || started ? '' : ' · Kliknij ponownie swoj wybor, aby sie wypisac. Przypomnienie 30 i 5 min przed startem.'
    }`,
  });
}

/** Odswieza opublikowana karte wydarzenia. */
async function refreshCard(client, event) {
  if (!event?.message_id) return;
  try {
    const channel = await client.channels.fetch(event.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(event.message_id).catch(() => null);
    if (!message) return;
    await message.edit({ components: [buildCard(event)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.debug(`Nie udalo sie odswiezyc wydarzenia #${event.id}:`, error.message);
  }
}

/** Osoby do powiadomienia: "Bede" + "Moze". */
function attendees(eventId) {
  const signups = eventsRepo.rsvps(eventId);
  return [...signups.yes, ...signups.maybe];
}

function buildReminder(event, userIds) {
  const url = messageUrl(event);
  return panel({
    color: COLORS.warning,
    title: `⏰ ${truncate(event.title, 200)} — start ${timestamp(event.starts_at, 'R')}`,
    description: `🕒 ${timestamp(event.starts_at, 'F')}${url ? ` · [karta wydarzenia](${url})` : ''}`,
    blocks: userIds.length > 0 ? [mentionList(userIds, MAX_PINGS)] : ['*Nikt sie jeszcze nie zapisal.*'],
    footer: `Wydarzenie #${event.id}`,
  });
}

/** Wysyla przypomnienie na kanale wydarzenia (+ opcjonalnie w DM). */
async function sendReminder(client, event) {
  const userIds = attendees(event.id).slice(0, MAX_PINGS);
  const channel = await client.channels.fetch(event.channel_id).catch(() => null);

  if (channel?.isTextBased?.()) {
    await channel
      .send({ components: [buildReminder(event, userIds)], flags: V2_FLAGS, allowedMentions: { users: userIds } })
      .catch((error) => logger.debug(`Przypomnienie wydarzenia #${event.id}:`, error.message));
  }

  if (event.dm_reminders) {
    const dm = buildReminder(event, []);
    for (const userId of userIds) {
      const user = await client.users.fetch(userId).catch(() => null);
      await user?.send({ components: [dm], flags: V2_FLAGS, allowedMentions: { parse: [] } }).catch(() => null);
    }
  }
}

/** Przypomnienia 30/5 min przed startem i zamykanie zapisow po starcie. */
async function processEvents(client, now = Date.now()) {
  for (const minutes of [30, 5]) {
    for (const event of eventsRepo.dueReminders(minutes, now)) {
      eventsRepo.markReminded(event.id, minutes);
      // Gdy bot byl wylaczony, nie wysylamy spoznionych przypomnien
      const tooLate = minutes === 30 ? event.starts_at - now <= eventsRepo.REMINDER_OFFSETS[5] : event.starts_at <= now;
      if (tooLate) continue;
      try {
        await sendReminder(client, event);
        logger.info(`Wyslano przypomnienie (${minutes} min) dla wydarzenia #${event.id}.`);
      } catch (error) {
        logger.warn(`Blad przypomnienia wydarzenia #${event.id}:`, error.message);
      }
    }
  }

  for (const id of eventsRepo.dueForStart(now)) {
    const event = eventsRepo.setStatus(id, 'started');
    await refreshCard(client, event);
  }
}

/** Jedno wywolanie ze schedulera: wydarzenia + przypomnienia uzytkownikow. */
async function tick(client) {
  await processEvents(client).catch((error) => logger.warn('Scheduler wydarzen:', error.message));
  await remindersService.deliverDue(client).catch((error) => logger.warn('Scheduler przypomnien:', error.message));
}

module.exports = {
  NAMESPACE,
  RSVP_META,
  isOfficer,
  messageUrl,
  buildCard,
  buildReminder,
  refreshCard,
  sendReminder,
  processEvents,
  tick,
};
