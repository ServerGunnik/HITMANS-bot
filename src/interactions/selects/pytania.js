'use strict';

const questionsPanel = require('../../services/questionsPanel');
const recruitment = require('../../database/repositories/recruitment');
const { isAdmin } = require('../../utils/permissions');
const { V2_FLAGS, reply } = require('../../ui/components');

/** Wybor pytania do edycji lub usuniecia w panelu `/pytania panel`. */
module.exports = {
  namespace: questionsPanel.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Ta akcja wymaga uprawnienia **Zarzadzanie serwerem**.');
    }

    const audience = recruitment.normalizeAudience(args[0]);
    const questionId = Number(interaction.values[0]);
    const question = recruitment.getQuestion(interaction.guild.id, questionId);

    if (!question) {
      return interaction.update({
        components: [
          questionsPanel.build(interaction.guild, {
            audience,
            interactive: true,
            notice: '⚠️ To pytanie juz nie istnieje.',
          }),
        ],
        flags: V2_FLAGS,
      });
    }

    if (action === 'editSelect') {
      return interaction.showModal(questionsPanel.buildQuestionModal(question, audience));
    }

    // removeSelect
    recruitment.removeQuestion(interaction.guild.id, questionId);
    return interaction.update({
      components: [
        questionsPanel.build(interaction.guild, {
          audience,
          interactive: true,
          notice: `🗑️ Usunieto pytanie **${question.label}**`,
        }),
      ],
      flags: V2_FLAGS,
    });
  },
};
