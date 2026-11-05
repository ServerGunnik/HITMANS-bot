'use strict';

const { ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration } = require('discord.js');

const suggestionsRepo = require('../database/repositories/suggestions');
const { COLORS, V2_FLAGS, button, panel, row } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'propozycja';
const MAX_CONTENT = 1500;

const STATUS_META = {
  pending: { label: 'Oczekuje na decyzje', emoji: '🕓', color: COLORS.primary },
  in_progress: { label: 'W realizacji', emoji: '🛠️', color: COLORS.warning },
  accepted: { label: 'Przyjeta', emoji: '✅', color: COLORS.success },
  rejected: { label: 'Odrzucona', emoji: '❌', color: COLORS.danger },
};

/** Mapowanie wartosci opcji komendy (polskie) na statusy w bazie. */
const STATUS_CHOICES = {
  przyjeta: 'accepted',
  odrzucona: 'rejected',
  'w-realizacji': 'in_progress',
};

/** Czy na propozycje mozna jeszcze glosowac. */
function isOpen(suggestion) {
  return suggestion.status === 'pending' || suggestion.status === 'in_progress';
}

/** Pasek proporcji glosow za/przeciw. */
function voteBar(up, down, width = 16) {
  const total = up + down;
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((up / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Karta propozycji z licznikami glosow. */
function buildCard(suggestion) {
  const { up, down } = suggestionsRepo.counts(suggestion.id);
  const meta = STATUS_META[suggestion.status] ?? STATUS_META.pending;
  const total = up + down;
  const percent = total > 0 ? Math.round((up / total) * 100) : 0;
  const open = isOpen(suggestion);

  const fields = [
    { name: 'Status', value: `${meta.emoji} ${meta.label}`, inline: true },
    { name: 'Glosy', value: `👍 **${up}** • 👎 **${down}** • \`${voteBar(up, down)}\` ${percent}%`, inline: true },
  ];
  if (suggestion.status !== 'pending' && suggestion.status_by) {
    fields.push({
      name: 'Decyzja',
      value:
        `<@${suggestion.status_by}> ${timestamp(suggestion.status_at, 'R')}` +
        (suggestion.status_reason ? `\n> ${truncate(suggestion.status_reason, 500)}` : ''),
    });
  }

  return panel({
    color: meta.color,
    title: `💡 Propozycja #${suggestion.id}`,
    description: `-# od <@${suggestion.author_id}> • ${timestamp(suggestion.created_at, 'R')}`,
    blocks: [truncate(suggestion.content, MAX_CONTENT)],
    fields,
    rows: [
      row(
        button({ id: customId(NAMESPACE, 'vote', suggestion.id, 'up'), label: String(up), emoji: '👍', style: 'success', disabled: !open }),
        button({ id: customId(NAMESPACE, 'vote', suggestion.id, 'down'), label: String(down), emoji: '👎', style: 'danger', disabled: !open }),
      ),
    ],
    footer: open
      ? 'Jeden glos na osobe — kliknij drugi przycisk, aby zmienic zdanie, lub ten sam, aby wycofac glos.'
      : 'Glosowanie zakonczone.',
  });
}

/** Publikuje propozycje na kanale i zaklada watek do dyskusji (jesli sie da). */
async function publish(channel, suggestion) {
  const message = await channel.send({
    components: [buildCard(suggestion)],
    flags: V2_FLAGS,
    allowedMentions: { parse: [] },
  });

  let threadId = null;
  const me = channel.guild?.members?.me;
  const canThread =
    channel.type === ChannelType.GuildText &&
    typeof message.startThread === 'function' &&
    (!me || channel.permissionsFor?.(me)?.has(PermissionFlagsBits.CreatePublicThreads));

  if (canThread) {
    try {
      const thread = await message.startThread({
        name: truncate(`Propozycja #${suggestion.id}: ${suggestion.content.replace(/\s+/g, ' ')}`, 90),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Dyskusja nad propozycja #${suggestion.id}`,
      });
      threadId = thread.id;
    } catch (error) {
      logger.debug(`Nie udalo sie utworzyc watku propozycji #${suggestion.id}:`, error.message);
    }
  }

  suggestionsRepo.setMessage(suggestion.id, message.id, threadId);
  return { message, threadId };
}

/** Odswieza wiadomosc z karta propozycji. */
async function refreshCard(guild, suggestion) {
  if (!suggestion.message_id) return false;
  try {
    const channel = guild.channels.cache.get(suggestion.channel_id) ?? (await guild.channels.fetch(suggestion.channel_id).catch(() => null));
    const message = await channel?.messages?.fetch(suggestion.message_id).catch(() => null);
    if (!message) return false;
    await message.edit({ components: [buildCard(suggestion)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.debug(`Nie udalo sie odswiezyc propozycji #${suggestion.id}:`, error.message);
    return false;
  }
}

/** Wiadomosc prywatna do autora o zmianie statusu. */
function buildStatusDm(guild, suggestion) {
  const meta = STATUS_META[suggestion.status];
  return panel({
    color: meta.color,
    title: `${meta.emoji} Twoja propozycja #${suggestion.id}: ${meta.label}`,
    description: `Serwer **${guild.name}** zmienil status Twojej propozycji.`,
    blocks: [`> ${truncate(suggestion.content, 800).replace(/\n/g, '\n> ')}`],
    fields: suggestion.status_reason ? [{ name: 'Powod', value: truncate(suggestion.status_reason, 1000) }] : [],
  });
}

/** Zmienia status, odswieza karte i powiadamia autora. Zwraca { suggestion, cardUpdated, dmSent }. */
async function changeStatus(guild, suggestion, { status, reason, moderatorId }) {
  const updated = suggestionsRepo.setStatus(suggestion.id, { status, reason, moderatorId });
  const cardUpdated = await refreshCard(guild, updated);

  let dmSent = false;
  try {
    const author = await guild.client.users.fetch(updated.author_id);
    if (author) {
      await author.send({ components: [buildStatusDm(guild, updated)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
      dmSent = true;
    }
  } catch (error) {
    logger.debug(`Nie udalo sie wyslac DM o propozycji #${updated.id}:`, error.message);
  }

  return { suggestion: updated, cardUpdated, dmSent };
}

module.exports = {
  NAMESPACE,
  MAX_CONTENT,
  STATUS_META,
  STATUS_CHOICES,
  isOpen,
  voteBar,
  buildCard,
  buildStatusDm,
  publish,
  refreshCard,
  changeStatus,
};
