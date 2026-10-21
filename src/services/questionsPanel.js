'use strict';

const {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const recruitment = require('../database/repositories/recruitment');
const { build: customId } = require('../utils/customId');
const { COLORS, button, panel, row } = require('../ui/components');
const { truncate } = require('../utils/format');

const NAMESPACE = 'pytania';

const STYLE_LABELS = {
  short: 'krotka odpowiedz',
  paragraph: 'dluga odpowiedz',
};

/**
 * Dwa niezalezne zestawy pytan:
 *  - applicant — formularz wypelniany przez kandydata (`/rekrutacja`),
 *  - reviewer  — ankieta oceny wypelniana przez rekrutera przy zgloszeniu.
 */
const AUDIENCE_META = {
  applicant: {
    label: 'Formularz kandydata',
    emoji: '📝',
    title: 'Pytania dla kandydata',
    description: 'Te pytania widzi osoba skladajaca zgloszenie przez `/rekrutacja`.',
    empty: 'Uzyj przycisku **Dodaj pytanie** lub `/pytania domyslne`.',
  },
  reviewer: {
    label: 'Ankieta rekrutera',
    emoji: '🧭',
    title: 'Pytania dla rekrutera',
    description:
      'Te pytania widzi **tylko administracja** — ankieta oceny pod zgloszeniem ' +
      '(przycisk 🧭 Wypelnij ocene). Kandydat nigdy ich nie zobaczy.',
    empty: 'Dodaj pytania, a pod kazdym zgloszeniem pojawi sie przycisk oceny kandydata.',
  },
};

function other(audience) {
  return audience === 'reviewer' ? 'applicant' : 'reviewer';
}

/** Panel administracyjny z lista pytan wybranego zestawu i przyciskami akcji. */
function build(guild, { audience = 'applicant', interactive = true, notice = null } = {}) {
  const target = recruitment.normalizeAudience(audience);
  const meta = AUDIENCE_META[target];
  const questions = recruitment.listQuestions(guild.id, target);
  const full = questions.length >= recruitment.MAX_QUESTIONS;

  const blocks = questions.length
    ? questions.map((question) => {
        const flags = [
          STYLE_LABELS[question.style] ?? question.style,
          question.required ? 'wymagane' : 'opcjonalne',
          question.max_length ? `max ${question.max_length} zn.` : null,
        ]
          .filter(Boolean)
          .join(' • ');

        return (
          `**${question.position}. ${truncate(question.label, 100)}**\n` +
          (question.description ? `> ${truncate(question.description, 150)}\n` : '') +
          (question.placeholder ? `> *podpowiedz:* ${truncate(question.placeholder, 100)}\n` : '') +
          `-# ID ${question.id} • ${flags}`
        );
      })
    : [`*Ten zestaw nie ma jeszcze zadnych pytan.*\n${meta.empty}`];

  const otherAudience = other(target);
  const otherCount = recruitment.countQuestions(guild.id, otherAudience);

  const rows = interactive
    ? [
        row(
          button({
            id: customId(NAMESPACE, 'add', target),
            label: 'Dodaj pytanie',
            emoji: '➕',
            style: 'success',
            disabled: full,
          }),
          button({
            id: customId(NAMESPACE, 'edit', target),
            label: 'Edytuj',
            emoji: '✏️',
            style: 'primary',
            disabled: questions.length === 0,
          }),
          button({
            id: customId(NAMESPACE, 'remove', target),
            label: 'Usun',
            emoji: '🗑️',
            style: 'danger',
            disabled: questions.length === 0,
          }),
        ),
        row(
          button({
            id: customId(NAMESPACE, 'preview', target),
            label: 'Podglad formularza',
            emoji: '👁️',
            style: 'secondary',
            disabled: questions.length === 0,
          }),
          button({ id: customId(NAMESPACE, 'defaults', target), label: 'Zestaw domyslny', emoji: '📋', style: 'secondary' }),
          button({
            id: customId(NAMESPACE, 'switch', otherAudience),
            label: `${AUDIENCE_META[otherAudience].label} (${otherCount})`,
            emoji: AUDIENCE_META[otherAudience].emoji,
            style: 'secondary',
          }),
        ),
      ]
    : [];

  return panel({
    color: target === 'reviewer' ? COLORS.info : COLORS.primary,
    title: `${meta.emoji} ${meta.title}`,
    description:
      `${meta.description}\n` +
      `Zestaw zawiera **${questions.length}** z maksymalnie **${recruitment.MAX_QUESTIONS}** pytan ` +
      '(limit pol w modalu Discorda).',
    blocks: [notice, ...blocks].filter(Boolean),
    rows,
    footer: full
      ? 'Osiagnieto limit pytan — usun jedno, aby dodac nowe.'
      : 'Zmiany dzialaja od razu przy kolejnym zgloszeniu.',
  });
}

/** Modal dodawania / edycji pytania (pusty lub wypelniony istniejacymi danymi). */
function buildQuestionModal(question = null, audience = 'applicant') {
  const target = recruitment.normalizeAudience(question?.audience ?? audience);
  const meta = AUDIENCE_META[target];

  const modal = new ModalBuilder()
    .setCustomId(
      question ? customId(NAMESPACE, 'save', target, question.id) : customId(NAMESPACE, 'save', target),
    )
    .setTitle(truncate(question ? `Edycja pytania #${question.position}` : `Nowe pytanie — ${meta.label}`, 45));

  const labelInput = new TextInputBuilder()
    .setCustomId('label')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(45)
    .setPlaceholder(target === 'reviewer' ? 'np. Ocena kandydata (1-5)' : 'np. Dlaczego chcesz dolaczyc?');
  if (question) labelInput.setValue(question.label);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setPlaceholder('Wyjasnienie wyswietlane pod pytaniem');
  if (question?.description) descriptionInput.setValue(question.description);

  const placeholderInput = new TextInputBuilder()
    .setCustomId('placeholder')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setPlaceholder('Szary tekst w polu odpowiedzi');
  if (question?.placeholder) placeholderInput.setValue(question.placeholder);

  const maxLengthInput = new TextInputBuilder()
    .setCustomId('max_length')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(4)
    .setPlaceholder('1-4000 (domyslnie 1000)');
  if (question?.max_length) maxLengthInput.setValue(String(question.max_length));

  const styleSelect = new StringSelectMenuBuilder().setCustomId('style').addOptions(
    new StringSelectMenuOptionBuilder()
      .setLabel('Dluga odpowiedz')
      .setDescription('Pole wielolinijkowe')
      .setValue('paragraph|true')
      .setDefault(!question || (question.style === 'paragraph' && question.required)),
    new StringSelectMenuOptionBuilder()
      .setLabel('Dluga odpowiedz (opcjonalna)')
      .setDescription('Pole wielolinijkowe, mozna pominac')
      .setValue('paragraph|false')
      .setDefault(Boolean(question && question.style === 'paragraph' && !question.required)),
    new StringSelectMenuOptionBuilder()
      .setLabel('Krotka odpowiedz')
      .setDescription('Pole jednolinijkowe')
      .setValue('short|true')
      .setDefault(Boolean(question && question.style === 'short' && question.required)),
    new StringSelectMenuOptionBuilder()
      .setLabel('Krotka odpowiedz (opcjonalna)')
      .setDescription('Pole jednolinijkowe, mozna pominac')
      .setValue('short|false')
      .setDefault(Boolean(question && question.style === 'short' && !question.required)),
  );

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Tresc pytania').setTextInputComponent(labelInput),
    new LabelBuilder()
      .setLabel('Opis (opcjonalny)')
      .setDescription('Krotkie wyjasnienie pod pytaniem')
      .setTextInputComponent(descriptionInput),
    new LabelBuilder().setLabel('Podpowiedz w polu (opcjonalna)').setTextInputComponent(placeholderInput),
    new LabelBuilder().setLabel('Maksymalna dlugosc odpowiedzi').setTextInputComponent(maxLengthInput),
    new LabelBuilder().setLabel('Rodzaj pola').setStringSelectMenuComponent(styleSelect),
  );

  return modal;
}

/** Select z lista pytan wybranego zestawu — uzywany przy edycji i usuwaniu. */
function buildQuestionSelect(guild, action, audience = 'applicant') {
  const target = recruitment.normalizeAudience(audience);
  const questions = recruitment.listQuestions(guild.id, target);
  if (questions.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId(NAMESPACE, action, target))
    .setPlaceholder(action === 'editSelect' ? 'Wybierz pytanie do edycji' : 'Wybierz pytanie do usuniecia')
    .addOptions(
      questions.map((question) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(`${question.position}. ${question.label}`, 100))
          .setDescription(truncate(question.description ?? STYLE_LABELS[question.style] ?? '—', 100))
          .setValue(String(question.id)),
      ),
    );

  return row(select);
}

module.exports = { NAMESPACE, AUDIENCE_META, build, buildQuestionModal, buildQuestionSelect, STYLE_LABELS };
