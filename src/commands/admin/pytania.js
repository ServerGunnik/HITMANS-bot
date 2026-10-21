'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const recruitment = require('../../database/repositories/recruitment');
const questionsPanel = require('../../services/questionsPanel');
const { reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pytania')
    .setDescription('Zarzadzanie pytaniami formularza rekrutacyjnego')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Interaktywny panel do zarzadzania pytaniami')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('lista')
        .setDescription('Pokazuje liste pytan formularza')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dodaj')
        .setDescription('Dodaje nowe pytanie do formularza')
        .addStringOption((option) =>
          option.setName('pytanie').setDescription('Tresc pytania (max 45 znakow)').setMaxLength(45).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('opis')
            .setDescription('Dodatkowe wyjasnienie pod pytaniem (max 100 znakow)')
            .setMaxLength(100)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('podpowiedz')
            .setDescription('Szary tekst w polu odpowiedzi (max 100 znakow)')
            .setMaxLength(100)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('styl')
            .setDescription('Rodzaj pola odpowiedzi')
            .addChoices(
              { name: 'Krotka odpowiedz (jedna linia)', value: 'short' },
              { name: 'Dluga odpowiedz (wiele linii)', value: 'paragraph' },
            )
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('wymagane').setDescription('Czy odpowiedz jest obowiazkowa (domyslnie tak)').setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_dlugosc')
            .setDescription('Maksymalna dlugosc odpowiedzi (1-4000)')
            .setMinValue(1)
            .setMaxValue(4000)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa pytanie z formularza')
        .addIntegerOption((option) =>
          option.setName('pytanie').setDescription('Ktore pytanie usunac').setAutocomplete(true).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('przesun')
        .setDescription('Zmienia kolejnosc pytania w formularzu')
        .addIntegerOption((option) =>
          option.setName('pytanie').setDescription('Ktore pytanie przesunac').setAutocomplete(true).setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('pozycja').setDescription('Nowa pozycja (1 = pierwsze)').setMinValue(1).setMaxValue(5).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('domyslne')
        .setDescription('Wgrywa przykladowy zestaw pytan (zastepuje obecny)')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('wyczysc')
        .setDescription('Usuwa wszystkie pytania wybranego zestawu')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory zestaw pytan (domyslnie: kandydat)')
            .addChoices(
              { name: '📝 Formularz kandydata', value: 'applicant' },
              { name: '🧭 Ankieta rekrutera (widoczna tylko dla administracji)', value: 'reviewer' },
            )
            .setRequired(false),
        ),
    ),

  async autocomplete(interaction) {
    const audience = interaction.options.getString('typ') ?? 'applicant';
    const questions = recruitment.listQuestions(interaction.guild.id, audience);
    const focused = String(interaction.options.getFocused() ?? '').toLowerCase();

    const choices = questions
      .filter((question) => question.label.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((question) => ({
        name: truncate(`${question.position}. ${question.label}`, 100),
        value: question.id,
      }));

    return interaction.respond(choices);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const audience = recruitment.normalizeAudience(interaction.options.getString('typ'));

    if (subcommand === 'panel' || subcommand === 'lista') {
      return reply.panel(
        interaction,
        questionsPanel.build(interaction.guild, { audience, interactive: subcommand === 'panel' }),
      );
    }

    if (subcommand === 'dodaj') {
      if (recruitment.countQuestions(guildId, audience) >= recruitment.MAX_QUESTIONS) {
        return reply.error(
          interaction,
          `Zestaw moze miec maksymalnie **${recruitment.MAX_QUESTIONS}** pytan (limit modali Discorda). Usun jakies pytanie, aby dodac nowe.`,
        );
      }

      const question = recruitment.addQuestion(guildId, {
        label: interaction.options.getString('pytanie', true),
        description: interaction.options.getString('opis'),
        placeholder: interaction.options.getString('podpowiedz'),
        style: interaction.options.getString('styl') ?? 'paragraph',
        required: interaction.options.getBoolean('wymagane') ?? true,
        maxLength: interaction.options.getInteger('max_dlugosc') ?? 1000,
      }, audience);

      return reply.panel(interaction, [
        questionsPanel.build(interaction.guild, {
          audience,
          interactive: true,
          notice: `✅ Dodano pytanie **${question.position}. ${question.label}**`,
        }),
      ]);
    }

    if (subcommand === 'usun') {
      const id = interaction.options.getInteger('pytanie', true);
      const removed = recruitment.removeQuestion(guildId, id);

      if (!removed) return reply.error(interaction, 'Nie znalazlem takiego pytania.');

      return reply.panel(interaction, [
        questionsPanel.build(interaction.guild, {
          audience,
          interactive: true,
          notice: `🗑️ Usunieto pytanie **${removed.label}**`,
        }),
      ]);
    }

    if (subcommand === 'przesun') {
      const id = interaction.options.getInteger('pytanie', true);
      const position = interaction.options.getInteger('pozycja', true);
      const result = recruitment.moveQuestion(guildId, id, position);

      if (!result) return reply.error(interaction, 'Nie znalazlem takiego pytania.');

      return reply.panel(interaction, [
        questionsPanel.build(interaction.guild, { audience, interactive: true, notice: '🔀 Zmieniono kolejnosc pytan.' }),
      ]);
    }

    if (subcommand === 'domyslne') {
      const created = recruitment.seedDefaultQuestions(guildId, audience);
      return reply.panel(interaction, [
        questionsPanel.build(interaction.guild, {
          audience,
          interactive: true,
          notice: `✅ Wgrano domyslny zestaw **${created.length}** pytan.`,
        }),
      ]);
    }

    // wyczysc
    const removed = recruitment.clearQuestions(guildId, audience);
    return reply.panel(interaction, [
      questionsPanel.build(interaction.guild, {
        interactive: true,
        notice: removed > 0 ? `🗑️ Usunieto **${removed}** pytan.` : 'Formularz byl juz pusty.',
      }),
    ]);
  },
};
