'use strict';

const questionsPanel = require('../../services/questionsPanel');
const recruitment = require('../../database/repositories/recruitment');
const { isAdmin } = require('../../utils/permissions');
const { V2_FLAGS, reply } = require('../../ui/components');

function readOptional(interaction, field) {
  try {
    const value = interaction.fields.getTextInputValue(field).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Zapis pytania z modala (dodawanie i edycja) oraz podglad formularza. */
module.exports = {
  namespace: questionsPanel.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action === 'previewSubmit') {
      return reply.info(
        interaction,
        'To byl tylko podglad formularza — odpowiedzi nie zostaly nigdzie zapisane.',
      );
    }

    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Ta akcja wymaga uprawnienia **Zarzadzanie serwerem**.');
    }

    const { guild } = interaction;
    // customId: pytania:save:<zestaw>[:<id pytania>]
    const audience = recruitment.normalizeAudience(args[0]);
    const questionId = args[1] ? Number(args[1]) : null;

    const label = interaction.fields.getTextInputValue('label').trim();
    if (!label) return reply.error(interaction, 'Tresc pytania nie moze byc pusta.');

    const maxLengthRaw = readOptional(interaction, 'max_length');
    let maxLength = maxLengthRaw === null ? 1000 : Number.parseInt(maxLengthRaw, 10);
    if (!Number.isFinite(maxLength) || maxLength < 1 || maxLength > 4000) {
      return reply.error(interaction, 'Maksymalna dlugosc odpowiedzi musi byc liczba z zakresu **1–4000**.');
    }

    let style = 'paragraph';
    let required = true;
    try {
      const [selectedStyle, selectedRequired] = interaction.fields.getStringSelectValues('style')[0].split('|');
      style = selectedStyle === 'short' ? 'short' : 'paragraph';
      required = selectedRequired === 'true';
    } catch {
      // Brak wyboru — zostawiamy wartosci domyslne.
    }

    if (style === 'short' && maxLength > 500) maxLength = 500;

    const payload = {
      audience,
      label,
      description: readOptional(interaction, 'description'),
      placeholder: readOptional(interaction, 'placeholder'),
      style,
      required,
      maxLength,
    };

    let notice;
    if (questionId) {
      const updated = recruitment.updateQuestion(guild.id, questionId, payload);
      if (!updated) return reply.error(interaction, 'Nie znalazlem tego pytania — moglo zostac usuniete.');
      notice = `✏️ Zapisano zmiany w pytaniu **${updated.label}**`;
    } else {
      if (recruitment.countQuestions(guild.id, audience) >= recruitment.MAX_QUESTIONS) {
        return reply.error(
          interaction,
          `Ten zestaw ma juz maksymalna liczbe pytan (**${recruitment.MAX_QUESTIONS}**).`,
        );
      }
      const created = recruitment.addQuestion(guild.id, payload, audience);
      notice = `✅ Dodano pytanie **${created.position}. ${created.label}**`;
    }

    const components = [questionsPanel.build(guild, { audience, interactive: true, notice })];

    // Modal otwarty z panelu aktualizuje ten panel; modal z komendy tworzy nowa odpowiedz.
    if (interaction.message) {
      return interaction.update({ components, flags: V2_FLAGS });
    }
    return reply.panel(interaction, components);
  },
};
