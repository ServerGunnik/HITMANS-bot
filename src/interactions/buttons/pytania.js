'use strict';

const questionsPanel = require('../../services/questionsPanel');
const recruitment = require('../../database/repositories/recruitment');
const recruitmentService = require('../../services/recruitment');
const { isAdmin } = require('../../utils/permissions');
const { V2_FLAGS, reply } = require('../../ui/components');

/**
 * Przyciski panelu zarzadzania pytaniami (`/pytania panel`).
 * Ostatni czlon customId to zestaw pytan: applicant (kandydat) lub reviewer (rekruter).
 */
module.exports = {
  namespace: questionsPanel.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Ta akcja wymaga uprawnienia **Zarzadzanie serwerem**.');
    }

    const { guild } = interaction;
    const audience = recruitment.normalizeAudience(args[0]);

    if (action === 'add') {
      if (recruitment.countQuestions(guild.id, audience) >= recruitment.MAX_QUESTIONS) {
        return reply.error(
          interaction,
          `Ten zestaw ma juz maksymalna liczbe pytan (**${recruitment.MAX_QUESTIONS}**).`,
        );
      }
      return interaction.showModal(questionsPanel.buildQuestionModal(null, audience));
    }

    if (action === 'edit' || action === 'remove') {
      const select = questionsPanel.buildQuestionSelect(
        guild,
        action === 'edit' ? 'editSelect' : 'removeSelect',
        audience,
      );
      if (!select) return reply.error(interaction, 'Ten zestaw nie ma jeszcze zadnych pytan.');

      return interaction.update({
        components: [questionsPanel.build(guild, { audience, interactive: false }), select],
        flags: V2_FLAGS,
      });
    }

    if (action === 'preview') {
      const questions = recruitment.listQuestions(guild.id, audience).slice(0, recruitment.MAX_QUESTIONS);
      const modal = recruitmentService.buildQuestionModal(questions, {
        // Podglad uzywa innego customId, wiec odpowiedzi nie trafiaja do bazy.
        modalCustomId: `${questionsPanel.NAMESPACE}:previewSubmit`,
        title: `Podglad — ${questionsPanel.AUDIENCE_META[audience].label}`,
      });

      if (!modal) return reply.error(interaction, 'Ten zestaw nie ma jeszcze zadnych pytan.');
      return interaction.showModal(modal);
    }

    if (action === 'defaults') {
      const created = recruitment.seedDefaultQuestions(guild.id, audience);
      return interaction.update({
        components: [
          questionsPanel.build(guild, {
            audience,
            interactive: true,
            notice: `✅ Wgrano domyslny zestaw **${created.length}** pytan.`,
          }),
        ],
        flags: V2_FLAGS,
      });
    }

    // switch / refresh — przelaczenie na drugi zestaw albo odswiezenie biezacego
    return interaction.update({
      components: [questionsPanel.build(guild, { audience, interactive: true })],
      flags: V2_FLAGS,
    });
  },
};
