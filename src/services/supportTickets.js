'use strict';

const {
  AttachmentBuilder,
  ChannelType,
  FileBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const ticketsRepo = require('../database/repositories/supportTickets');
const { COLORS, V2_FLAGS, button, panel, row } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { isAdmin } = require('../utils/permissions');
const { timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'ticket';
/** Po ilu ms od zamkniecia usuwamy kanal ticketu. */
const DELETE_DELAY_MS = 10 * 1000;
/** Gorny limit wiadomosci w transkrypcji (ochrona przed bardzo dlugimi ticketami). */
const MAX_TRANSCRIPT_MESSAGES = 5000;

const CATEGORIES = {
  pomoc: { label: 'Pomoc', emoji: '🆘', style: 'primary', hint: 'Pytanie lub problem, w ktorym potrzebujesz pomocy' },
  skarga: { label: 'Skarga', emoji: '⚠️', style: 'danger', hint: 'Zgloszenie naruszenia zasad lub skarga na osobe' },
  inne: { label: 'Inne', emoji: '💬', style: 'secondary', hint: 'Wszystko inne — propozycje, wspolpraca, pytania' },
};

function categoryMeta(category) {
  return CATEGORIES[category] ?? { label: category, emoji: '🎫', style: 'secondary', hint: '' };
}

/** Czy osoba nalezy do obslugi ticketow. */
function isStaff(member, settings) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  return settings?.staff_role_id ? member.roles.cache.has(settings.staff_role_id) : false;
}

/** Publiczny panel z przyciskami kategorii. */
function buildPanel({ title, description } = {}) {
  return panel({
    color: COLORS.primary,
    title: title || '🎫 Centrum pomocy',
    description:
      description ||
      'Potrzebujesz pomocy administracji? Wybierz kategorie ponizej i opisz krotko sprawe — ' +
        'utworzymy prywatny kanal, ktory zobaczysz tylko Ty i obsluga.',
    fields: Object.values(CATEGORIES).map((meta) => ({ name: `${meta.emoji} ${meta.label}`, value: meta.hint, inline: true })),
    rows: [
      row(
        Object.entries(CATEGORIES).map(([key, meta]) =>
          button({ id: customId(NAMESPACE, 'open', key), label: meta.label, emoji: meta.emoji, style: meta.style }),
        ),
      ),
    ],
    footer: 'Mozesz miec jeden otwarty ticket w kazdej kategorii.',
  });
}

/** Modal z krotkim opisem sprawy. */
function buildOpenModal(category) {
  const meta = categoryMeta(category);
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'submit', category))
    .setTitle(truncate(`Nowy ticket — ${meta.label}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Opisz krotko sprawe')
        .setDescription(truncate(meta.hint, 100))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('opis')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(1000)
            .setPlaceholder('np. Nie dostalem roli po rekrutacji...'),
        ),
    );
}

/** Modal zamkniecia z opcjonalnym powodem. */
function buildCloseModal(ticketId) {
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'close', ticketId))
    .setTitle(`Zamkniecie ticketu #${ticketId}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Powod zamkniecia (opcjonalnie)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('powod')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(300)
            .setPlaceholder('np. Sprawa rozwiazana'),
        ),
    );
}

/** Wiadomosc w kanale ticketu — opis + przyciski Przejmij / Zamknij. */
function buildTicketMessage(ticket) {
  const meta = categoryMeta(ticket.category);
  const open = ticket.status === 'open';
  return panel({
    color: ticket.claimed_by ? COLORS.success : COLORS.warning,
    title: `${meta.emoji} Ticket #${ticket.id} — ${meta.label}`,
    description: `Zglaszajacy: <@${ticket.user_id}>${ticket.user_tag ? ` \`${ticket.user_tag}\`` : ''}\nOtwarty: ${timestamp(ticket.created_at, 'f')}`,
    fields: [
      { name: 'Opis', value: truncate(ticket.description, 1000) },
      { name: 'Obsluguje', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : '*nikt jeszcze nie przejal*', inline: true },
    ],
    rows: open
      ? [
          row(
            button({
              id: customId(NAMESPACE, 'claim', ticket.id),
              label: ticket.claimed_by ? 'Przejety' : 'Przejmij',
              emoji: '🙋',
              style: 'success',
              disabled: Boolean(ticket.claimed_by),
            }),
            button({ id: customId(NAMESPACE, 'close', ticket.id), label: 'Zamknij', emoji: '🔒', style: 'danger' }),
          ),
        ]
      : [],
    footer: 'Obsluga odpowie tutaj. Zamkniecie zapisze transkrypcje i usunie kanal.',
  });
}

const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 'YYYY-MM-DD HH:mm:ss' w czasie polskim. */
function formatTime(ms) {
  const parts = Object.fromEntries(timeFormatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Sprowadza wiadomosc Discorda do prostego obiektu dla transkrypcji. */
function toTranscriptEntry(message) {
  return {
    id: message.id,
    createdTimestamp: message.createdTimestamp,
    authorId: message.author?.id ?? null,
    authorTag: message.author?.tag ?? 'nieznany',
    bot: Boolean(message.author?.bot),
    content: message.content ?? '',
    attachments: [...(message.attachments?.values?.() ?? [])].map((file) => ({ name: file.name, url: file.url })),
    embeds: message.embeds?.length ?? 0,
    components: (message.components?.length ?? 0) > 0,
  };
}

/** Buduje tekst transkrypcji (chronologicznie, z autorami i linkami do zalacznikow). */
function formatTranscript(ticket, entries, { guildName, closedByTag, reason, closedAt = Date.now() } = {}) {
  const meta = categoryMeta(ticket.category);
  const lines = [
    `Transkrypcja ticketu #${ticket.id} — ${meta.label}`,
    guildName ? `Serwer: ${guildName}` : null,
    `Zglaszajacy: ${ticket.user_tag ?? ticket.user_id} (${ticket.user_id})`,
    `Otwarty: ${formatTime(ticket.created_at)}`,
    `Zamkniety: ${formatTime(closedAt)}${closedByTag ? ` przez ${closedByTag}` : ''}`,
    ticket.claimed_by ? `Obslugiwal: ${ticket.claimed_by}` : null,
    reason ? `Powod: ${reason}` : null,
    `Opis: ${ticket.description}`,
    '='.repeat(60),
  ].filter((line) => line !== null);

  const sorted = [...entries].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const entry of sorted) {
    const author = `${entry.authorTag}${entry.bot ? ' [BOT]' : ''} (${entry.authorId ?? '?'})`;
    let body = entry.content?.trim() ?? '';
    if (!body && !entry.attachments.length) {
      body = entry.components ? '[wiadomosc z komponentami]' : entry.embeds ? `[embedy: ${entry.embeds}]` : '[pusta wiadomosc]';
    }
    lines.push(`[${formatTime(entry.createdTimestamp)}] ${author}: ${body.replace(/\r?\n/g, '\n    ')}`);
    for (const file of entry.attachments) lines.push(`    [zalacznik] ${file.name}: ${file.url}`);
  }

  lines.push('='.repeat(60), `Wiadomosci: ${sorted.length}`);
  return lines.join('\n');
}

/** Pobiera cala historie kanalu (od najstarszej). */
async function collectMessages(channel, limit = MAX_TRANSCRIPT_MESSAGES) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.lastKey();
    if (batch.size < 100) break;
  }
  return messages.reverse();
}

/** Karta podsumowania zamknietego ticketu z plikiem transkrypcji. */
function buildClosedCard(ticket, { closedBy, reason, count, fileName }) {
  const meta = categoryMeta(ticket.category);
  const container = panel({
    color: COLORS.neutral,
    title: `🔒 Ticket #${ticket.id} zamkniety — ${meta.label}`,
    fields: [
      { name: 'Zglaszajacy', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Obslugiwal', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'nikt', inline: true },
      { name: 'Zamknal', value: closedBy ? `<@${closedBy}>` : 'nieznany', inline: true },
      { name: 'Otwarty', value: timestamp(ticket.created_at, 'f'), inline: true },
      { name: 'Wiadomosci', value: String(count), inline: true },
      { name: 'Powod', value: reason ? truncate(reason, 300) : 'brak' },
      { name: 'Opis', value: truncate(ticket.description, 500) },
    ],
  });
  if (fileName) container.addFileComponents(new FileBuilder().setURL(`attachment://${fileName}`));
  return container;
}

/** Tickety w trakcie tworzenia — dwa szybkie zgloszenia nie otworza dwoch kanalow. */
const creating = new Set();

/** Tworzy ticket; rownolegle wywolania dla tej samej osoby i kategorii sa odrzucane. */
async function createTicket(interaction, category, description) {
  const key = `${interaction.guild.id}:${interaction.user.id}:${category}`;
  if (creating.has(key)) return { ok: false, reason: 'Twoj ticket w tej kategorii jest juz tworzony.' };
  creating.add(key);
  try {
    return await openTicket(interaction, category, description);
  } finally {
    creating.delete(key);
  }
}

/** Tworzy prywatny kanal ticketu. */
async function openTicket(interaction, category, description) {
  const { guild, user } = interaction;
  if (!CATEGORIES[category]) return { ok: false, reason: 'Nieznana kategoria ticketu.' };

  const settings = ticketsRepo.getSettings(guild.id);
  if (!settings.category_id || !settings.staff_role_id) {
    return { ok: false, reason: 'Tickety nie sa skonfigurowane. Admin: `/ticket-panel ustaw`.' };
  }

  const parent = guild.channels.cache.get(settings.category_id);
  if (!parent) return { ok: false, reason: 'Skonfigurowana kategoria ticketow juz nie istnieje.' };
  const staffRole = guild.roles.cache.get(settings.staff_role_id);
  if (!staffRole) return { ok: false, reason: 'Skonfigurowana rola obslugi juz nie istnieje.' };

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, reason: 'Brakuje mi uprawnienia **Zarzadzanie kanalami**, aby stworzyc ticket.' };
  }

  const existing = ticketsRepo.findOpen(guild.id, user.id, category);
  if (existing) {
    if (existing.channel_id && guild.channels.cache.has(existing.channel_id)) {
      return { ok: false, reason: `Masz juz otwarty ticket w tej kategorii: <#${existing.channel_id}>.` };
    }
    // Kanal zniknal (np. usuniety recznie) — zamykamy osierocony wpis.
    ticketsRepo.markClosed(existing.id, guild.client.user.id, 'Kanal usuniety');
  }

  const ticket = ticketsRepo.create({ guildId: guild.id, userId: user.id, userTag: user.tag, category, description });
  const channelName = `${category}-${user.username}-${ticket.id}`.toLowerCase().slice(0, 100);

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: truncate(`Ticket #${ticket.id} (${categoryMeta(category).label}) — ${user.tag}`, 1024),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: staffRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ManageMessages,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
      reason: `Ticket pomocy #${ticket.id} — ${user.tag}`,
    });
  } catch (error) {
    ticketsRepo.markClosed(ticket.id, guild.client.user.id, 'Nie udalo sie utworzyc kanalu');
    return { ok: false, reason: `Nie udalo sie stworzyc kanalu: ${error.message}` };
  }

  ticketsRepo.setChannel(ticket.id, channel.id);
  const updated = ticketsRepo.get(ticket.id);

  try {
    await channel.send({ components: [buildTicketMessage(updated)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    // Osobna, zwykla wiadomosc z pingiem — Components V2 nie pozwala na `content`.
    await channel.send({
      content: `<@${user.id}> <@&${staffRole.id}>`,
      allowedMentions: { users: [user.id], roles: [staffRole.id] },
    });
  } catch (error) {
    logger.warn(`Nie udalo sie wyslac powitania w tickecie pomocy #${ticket.id}:`, error.message);
  }

  return { ok: true, ticket: updated, channel };
}

/** Przejecie ticketu przez osobe z obslugi. */
async function claimTicket(interaction, ticket) {
  const updated = ticketsRepo.claim(ticket.id, interaction.user.id);
  await interaction.update({ components: [buildTicketMessage(updated)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
  await interaction.channel
    ?.send({
      components: [panel({ color: COLORS.success, description: `🙋 <@${interaction.user.id}> przejal ten ticket.` })],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  return updated;
}

/**
 * Zamyka ticket: transkrypcja na kanal logow i w DM, a po chwili usuniecie kanalu.
 * Zwraca { ok, reason?, dmSent?, logged? }.
 */
async function closeTicket(interaction, ticket, reason = null) {
  const { guild, user } = interaction;
  if (!ticketsRepo.markClosed(ticket.id, user.id, reason)) {
    return { ok: false, reason: 'Ten ticket jest juz zamkniety.' };
  }
  const closed = ticketsRepo.get(ticket.id);
  const settings = ticketsRepo.getSettings(guild.id);
  const channel = guild.channels.cache.get(ticket.channel_id);

  let entries = [];
  if (channel?.isTextBased()) {
    entries = (await collectMessages(channel).catch(() => [])).map(toTranscriptEntry);
  }

  const fileName = `ticket-${ticket.id}.txt`;
  const transcript = formatTranscript(closed, entries, {
    guildName: guild.name,
    closedByTag: user.tag,
    reason,
    closedAt: closed.closed_at,
  });
  const buffer = Buffer.from(transcript, 'utf8');
  const cardOptions = { closedBy: user.id, reason, count: entries.length, fileName };

  let logged = false;
  const logChannel = settings.log_channel_id ? guild.channels.cache.get(settings.log_channel_id) : null;
  if (logChannel?.isTextBased()) {
    try {
      await logChannel.send({
        components: [buildClosedCard(closed, cardOptions)],
        files: [new AttachmentBuilder(buffer, { name: fileName })],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      logged = true;
    } catch (error) {
      logger.warn(`Nie wyslano transkrypcji ticketu #${ticket.id}:`, error.message);
    }
  }

  let dmSent = false;
  const owner = await guild.client.users.fetch(ticket.user_id).catch(() => null);
  if (owner) {
    try {
      await owner.send({
        components: [buildClosedCard(closed, cardOptions)],
        files: [new AttachmentBuilder(buffer, { name: fileName })],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      dmSent = true;
    } catch {
      // uzytkownik ma wylaczone DM
    }
  }

  if (channel) {
    await channel
      .send({
        components: [
          panel({
            color: COLORS.danger,
            description:
              `🔒 Ticket zamkniety przez <@${user.id}>${reason ? ` — ${truncate(reason, 300)}` : ''}.\n` +
              `Kanal zostanie usuniety za ${Math.round(DELETE_DELAY_MS / 1000)} s.`,
          }),
        ],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});

    setTimeout(() => {
      channel
        .delete(`Zamkniecie ticketu pomocy #${ticket.id} przez ${user.tag}`)
        .catch((error) => logger.warn(`Nie usunieto kanalu ticketu #${ticket.id}:`, error.message));
    }, DELETE_DELAY_MS).unref?.();
  }

  return { ok: true, dmSent, logged };
}

module.exports = {
  NAMESPACE,
  CATEGORIES,
  DELETE_DELAY_MS,
  categoryMeta,
  isStaff,
  buildPanel,
  buildOpenModal,
  buildCloseModal,
  buildTicketMessage,
  buildClosedCard,
  formatTime,
  toTranscriptEntry,
  formatTranscript,
  collectMessages,
  createTicket,
  claimTicket,
  closeTicket,
};
