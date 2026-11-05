'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const eventsRepo = require('../../database/repositories/events');
const warsRepo = require('../../database/repositories/wars');
const eventsService = require('../../services/events');
const warsService = require('../../services/wars');
const { reply } = require('../../ui/components');
const { parseUserIds } = require('../../utils/mentions');
const { parseTime, TIME_HELP } = require('../../utils/time');

/** Uczestnicy bitwy: z listy wzmianek, a gdy jej brak — z obecnosci / zapisow wydarzenia. */
function resolveParticipants(text, event) {
  const fromText = parseUserIds(text);
  if (fromText.length || !event) return fromText;
  const attendance = eventsRepo.attendance(event.id);
  if (attendance.present.length) return attendance.present;
  return eventsRepo.rsvps(event.id).yes;
}

async function handleRecord(interaction) {
  if (!eventsService.isOfficer(interaction.member)) {
    return reply.error(interaction, 'Wyniki wojen moga zapisywac tylko oficerowie (Zarzadzanie wydarzeniami).');
  }

  const opponent = interaction.options.getString('przeciwnik', true).trim();
  const result = interaction.options.getString('rezultat', true);
  const score = interaction.options.getString('wynik_punktowy')?.trim() || null;
  const eventId = interaction.options.getInteger('wydarzenie');
  const when = interaction.options.getString('kiedy');

  let event = null;
  if (eventId) {
    event = eventsRepo.getForGuild(interaction.guild.id, eventId);
    if (!event) return reply.error(interaction, `Nie znalazlem wydarzenia **#${eventId}** na tym serwerze.`);
  }

  let foughtAt = event?.starts_at ?? Date.now();
  if (when) {
    foughtAt = parseTime(when);
    if (!foughtAt) return reply.error(interaction, `Nie rozumiem daty bitwy. ${TIME_HELP}`);
  }

  const participants = resolveParticipants(interaction.options.getString('uczestnicy'), event);

  const war = warsRepo.create({
    guildId: interaction.guild.id,
    opponent,
    result,
    score,
    eventId: event?.id ?? null,
    participants,
    recordedBy: interaction.user.id,
    foughtAt,
  });

  return reply.panel(interaction, warsService.buildWarCard(war), { ephemeral: false });
}

async function handleRemove(interaction) {
  if (!eventsService.isOfficer(interaction.member)) {
    return reply.error(interaction, 'Bitwy moga usuwac tylko oficerowie (Zarzadzanie wydarzeniami).');
  }
  const id = interaction.options.getInteger('id', true);
  if (!warsRepo.remove(interaction.guild.id, id)) {
    return reply.error(interaction, `Nie znalazlem bitwy **#${id}** na tym serwerze.`);
  }
  return reply.success(interaction, `Usunieto bitwe **#${id}**.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wojna')
    .setDescription('Wyniki wojen i podbojow klanu')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('wynik')
        .setDescription('Zapisuje wynik bitwy (oficerowie)')
        .addStringOption((option) =>
          option.setName('przeciwnik').setDescription('Z kim walczylismy').setMaxLength(100).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('rezultat')
            .setDescription('Wynik bitwy')
            .addChoices(
              { name: 'Wygrana', value: 'win' },
              { name: 'Przegrana', value: 'loss' },
              { name: 'Remis', value: 'draw' },
            )
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('wynik_punktowy').setDescription('Np. 3:1 albo 1200-950').setMaxLength(30).setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('uczestnicy')
            .setDescription('Wzmianki uczestnikow (pusto = obecni / zapisani z wydarzenia)')
            .setMaxLength(4000)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option.setName('wydarzenie').setDescription('Numer powiazanego wydarzenia (#id)').setMinValue(1).setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('kiedy').setDescription('Data bitwy, np. 2026-11-20 20:00 (domyslnie teraz)').setMaxLength(40).setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('statystyki')
        .setDescription('Bilans wojen klanu i ostatnie bitwy')
        .addStringOption((option) =>
          option.setName('przeciwnik').setDescription('Tylko bitwy z tym przeciwnikiem').setMaxLength(100).setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ranking')
        .setDescription('Najaktywniejsi wojownicy klanu')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Sortowanie (domyslnie udzial)')
            .addChoices({ name: 'Udzial w bitwach', value: 'battles' }, { name: 'Wygrane', value: 'wins' })
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa blednie zapisana bitwe (oficerowie)')
        .addIntegerOption((option) => option.setName('id').setDescription('Numer bitwy (#id)').setMinValue(1).setRequired(true)),
    ),

  cooldown: 3,

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'wynik') return handleRecord(interaction);
    if (subcommand === 'usun') return handleRemove(interaction);
    if (subcommand === 'statystyki') {
      const opponent = interaction.options.getString('przeciwnik')?.trim() || undefined;
      return reply.panel(interaction, warsService.buildStatsPanel(interaction.guild, { opponent }), { ephemeral: false });
    }
    if (subcommand === 'ranking') {
      const by = interaction.options.getString('typ') ?? 'battles';
      return reply.panel(interaction, warsService.buildRankingPanel(interaction.guild, { by }), { ephemeral: false });
    }
  },
};
