'use strict';

const {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const eventsRepo = require('../../database/repositories/events');
const eventsService = require('../../services/events');
const { COLORS, V2_FLAGS, panel, reply } = require('../../ui/components');
const { mentionList, parseUserIds } = require('../../utils/mentions');
const { timestamp, truncate } = require('../../utils/format');
const { parseTime, TIME_HELP } = require('../../utils/time');

const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Sprawdza termin wydarzenia. Zwraca { at } albo { error }. */
function resolveStart(input, now = Date.now()) {
  const at = parseTime(input, { now });
  if (!at) return { error: `Nie rozumiem terminu \`${truncate(input, 50)}\`. ${TIME_HELP}` };
  if (at <= now) return { error: 'Termin wydarzenia musi byc w przyszlosci.' };
  if (at - now > MAX_AHEAD_MS) return { error: 'Wydarzenie mozna zaplanowac maksymalnie rok do przodu.' };
  return { at };
}

function idOption(option) {
  return option.setName('id').setDescription('Numer wydarzenia (#id z karty)').setMinValue(1).setRequired(true);
}

async function handleCreate(interaction) {
  const title = interaction.options.getString('tytul', true).trim();
  const description = interaction.options.getString('opis')?.trim() || null;
  const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
  const role = interaction.options.getRole('rola');
  const dm = interaction.options.getBoolean('dm') ?? false;

  const start = resolveStart(interaction.options.getString('start', true));
  if (start.error) return reply.error(interaction, start.error);

  const permissions = channel.permissionsFor?.(interaction.guild.members.me);
  if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
    return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
  }

  const event = eventsRepo.create({
    guildId: interaction.guild.id,
    channelId: channel.id,
    authorId: interaction.user.id,
    title,
    description,
    startsAt: start.at,
    pingRoleId: role?.id ?? null,
    dmReminders: dm,
  });

  const message = await channel.send({
    components: [eventsService.buildCard(event)],
    flags: V2_FLAGS,
    allowedMentions: { roles: role ? [role.id] : [] },
  });
  eventsRepo.setMessage(event.id, message.id);

  return reply.success(
    interaction,
    `Wydarzenie **#${event.id}** opublikowane: ${message.url}\nStart: ${timestamp(start.at, 'F')} (${timestamp(start.at, 'R')}).`,
  );
}

async function handleList(interaction) {
  const events = eventsRepo.listUpcoming(interaction.guild.id, 15);
  const recent = eventsRepo.listRecent(interaction.guild.id, 5);

  const line = (event) => {
    const signups = eventsRepo.rsvps(event.id);
    const url = eventsService.messageUrl(event);
    return (
      `\`#${event.id}\` **${truncate(event.title, 80)}** — ${timestamp(event.starts_at, 'f')} (${timestamp(event.starts_at, 'R')})` +
      ` · ✅ ${signups.yes.length} · ❔ ${signups.maybe.length}${url ? ` · [karta](${url})` : ''}`
    );
  };

  return reply.panel(
    interaction,
    panel({
      color: COLORS.clan,
      title: '📅 Wydarzenia klanu',
      fields: [
        { name: 'Nadchodzace', value: events.length ? events.map(line).join('\n') : '*Brak zaplanowanych wydarzen.*' },
        recent.length ? { name: 'Ostatnio rozpoczete', value: recent.map(line).join('\n') } : null,
      ],
      footer: 'Nowe wydarzenie: /event utworz · obecnosc: /event obecnosc',
    }),
  );
}

async function handleCancel(interaction) {
  const event = eventsRepo.getForGuild(interaction.guild.id, interaction.options.getInteger('id', true));
  if (!event) return reply.error(interaction, 'Nie znalazlem takiego wydarzenia na tym serwerze.');
  if (event.status === 'cancelled') return reply.error(interaction, 'To wydarzenie jest juz odwolane.');

  const cancelled = eventsRepo.setStatus(event.id, 'cancelled');
  await eventsService.refreshCard(interaction.client, cancelled);
  return reply.success(interaction, `Wydarzenie **#${event.id} ${truncate(event.title, 80)}** zostalo odwolane.`);
}

async function handleEdit(interaction) {
  const event = eventsRepo.getForGuild(interaction.guild.id, interaction.options.getInteger('id', true));
  if (!event) return reply.error(interaction, 'Nie znalazlem takiego wydarzenia na tym serwerze.');
  if (event.status === 'cancelled') return reply.error(interaction, 'Nie mozna edytowac odwolanego wydarzenia.');

  const fields = {};
  const title = interaction.options.getString('tytul')?.trim();
  const description = interaction.options.getString('opis')?.trim();
  const startInput = interaction.options.getString('start');
  const role = interaction.options.getRole('rola');
  const dm = interaction.options.getBoolean('dm');

  if (title) fields.title = title;
  if (description) fields.description = description === '-' ? null : description;
  if (role) fields.ping_role_id = role.id;
  if (dm !== null) fields.dm_reminders = dm;
  if (startInput) {
    const start = resolveStart(startInput);
    if (start.error) return reply.error(interaction, start.error);
    fields.starts_at = start.at;
  }

  if (Object.keys(fields).length === 0) {
    return reply.error(interaction, 'Podaj przynajmniej jedno pole do zmiany.');
  }

  const updated = eventsRepo.update(event.id, fields);
  await eventsService.refreshCard(interaction.client, updated);
  return reply.success(
    interaction,
    `Zaktualizowano wydarzenie **#${event.id}**. Start: ${timestamp(updated.starts_at, 'F')}.` +
      (fields.starts_at ? '\nPrzypomnienia zostana wyslane wg nowego terminu.' : ''),
  );
}

async function handleAttendance(interaction) {
  const event = eventsRepo.getForGuild(interaction.guild.id, interaction.options.getInteger('id', true));
  if (!event) return reply.error(interaction, 'Nie znalazlem takiego wydarzenia na tym serwerze.');
  if (event.status === 'cancelled') return reply.error(interaction, 'To wydarzenie zostalo odwolane.');
  if (event.starts_at > Date.now()) {
    return reply.error(interaction, `Obecnosc mozna oznaczyc po rozpoczeciu wydarzenia (${timestamp(event.starts_at, 'R')}).`);
  }

  const signups = eventsRepo.rsvps(event.id);
  const present = parseUserIds(interaction.options.getString('obecni'));
  const absent = parseUserIds(interaction.options.getString('nieobecni'));
  if (interaction.options.getBoolean('zapisani')) {
    for (const userId of signups.yes) if (!present.includes(userId) && !absent.includes(userId)) present.push(userId);
  }

  if (present.length) eventsRepo.setAttendance(event.id, present, true, interaction.user.id);
  if (absent.length) eventsRepo.setAttendance(event.id, absent, false, interaction.user.id);

  const current = eventsRepo.attendance(event.id);
  const marked = new Set([...current.present, ...current.absent]);
  const unmarked = signups.yes.filter((userId) => !marked.has(userId));

  return reply.panel(
    interaction,
    panel({
      color: COLORS.info,
      title: `📋 Obecnosc — #${event.id} ${truncate(event.title, 150)}`,
      description: `🕒 ${timestamp(event.starts_at, 'F')}` +
        (present.length || absent.length ? `\n✅ Zapisano: obecni **${present.length}**, nieobecni **${absent.length}**.` : ''),
      fields: [
        { name: `Obecni (${current.present.length})`, value: mentionList(current.present, 40) },
        { name: `Nieobecni (${current.absent.length})`, value: mentionList(current.absent, 40) },
        unmarked.length ? { name: `Zapisani "Bede" bez oznaczenia (${unmarked.length})`, value: mentionList(unmarked, 40) } : null,
      ],
      footer: 'Podaj wzmianki w polach obecni/nieobecni albo uzyj zapisani:True, aby oznaczyc wszystkich "Bede".',
    }),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Wydarzenia i wojny klanowe z zapisami')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand((sub) =>
      sub
        .setName('utworz')
        .setDescription('Tworzy wydarzenie z zapisami Bede / Moze / Nie bede')
        .addStringOption((option) => option.setName('tytul').setDescription('Nazwa wydarzenia').setMaxLength(100).setRequired(true))
        .addStringOption((option) =>
          option
            .setName('start')
            .setDescription('Termin (czas PL), np. 2026-11-20 20:00, jutro 20:00, 20:00, za 2h')
            .setMaxLength(40)
            .setRequired(true),
        )
        .addStringOption((option) => option.setName('opis').setDescription('Opis / szczegoly').setMaxLength(1000).setRequired(false))
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Gdzie opublikowac (domyslnie biezacy kanal)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addRoleOption((option) => option.setName('rola').setDescription('Rola do oznaczenia przy publikacji').setRequired(false))
        .addBooleanOption((option) =>
          option.setName('dm').setDescription('Wysylac przypomnienia takze w DM (domyslnie nie)').setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName('lista').setDescription('Nadchodzace wydarzenia'))
    .addSubcommand((sub) =>
      sub.setName('anuluj').setDescription('Odwoluje wydarzenie').addIntegerOption(idOption),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edytuj')
        .setDescription('Zmienia tytul, opis, termin lub role wydarzenia')
        .addIntegerOption(idOption)
        .addStringOption((option) => option.setName('tytul').setDescription('Nowa nazwa').setMaxLength(100).setRequired(false))
        .addStringOption((option) =>
          option.setName('start').setDescription('Nowy termin, np. jutro 21:00').setMaxLength(40).setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('opis').setDescription('Nowy opis ("-" usuwa opis)').setMaxLength(1000).setRequired(false),
        )
        .addRoleOption((option) => option.setName('rola').setDescription('Nowa rola wydarzenia').setRequired(false))
        .addBooleanOption((option) => option.setName('dm').setDescription('Przypomnienia w DM').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('obecnosc')
        .setDescription('Oznacza obecnosc po wydarzeniu (bez opcji pokazuje liste)')
        .addIntegerOption(idOption)
        .addStringOption((option) =>
          option.setName('obecni').setDescription('Wzmianki obecnych, np. @Gracz1 @Gracz2').setMaxLength(4000).setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('nieobecni').setDescription('Wzmianki nieobecnych').setMaxLength(4000).setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('zapisani').setDescription('Oznacz wszystkich zapisanych "Bede" jako obecnych').setRequired(false),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'utworz') return handleCreate(interaction);
    if (subcommand === 'lista') return handleList(interaction);
    if (subcommand === 'anuluj') return handleCancel(interaction);
    if (subcommand === 'edytuj') return handleEdit(interaction);
    if (subcommand === 'obecnosc') return handleAttendance(interaction);
  },

  resolveStart,
};
