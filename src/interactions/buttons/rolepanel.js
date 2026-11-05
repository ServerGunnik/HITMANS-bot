'use strict';

const rolePanelsRepo = require('../../database/repositories/rolePanels');
const rolePanels = require('../../services/rolePanels');
const { reply } = require('../../ui/components');
const logger = require('../../utils/logger');

/** Klikniecie przycisku w panelu rol do wyboru. */
module.exports = {
  namespace: rolePanels.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action !== 'toggle') return reply.error(interaction, 'Nieznana akcja panelu rol.');

    const rolePanel = rolePanelsRepo.getForGuild(interaction.guild.id, Number(args[0]));
    if (!rolePanel) return reply.error(interaction, 'Ten panel rol zostal usuniety.');

    const member = interaction.member;
    let outcome;
    try {
      outcome = await rolePanels.toggleRole(member, rolePanel, args[1]);
    } catch (error) {
      logger.debug(`Panel rol #${rolePanel.id}:`, error.message);
      return reply.error(interaction, 'Nie udalo sie zmienic roli — sprawdz, czy rola bota jest wyzej w hierarchii.');
    }

    if (!outcome.ok) return reply.error(interaction, outcome.reason);

    if (outcome.action === 'removed') {
      return reply.warning(interaction, `Zdjeto role ${outcome.role}.`);
    }

    const removedNote = outcome.removed.length
      ? `\nZdjeto poprzednia: ${outcome.removed.map((role) => `${role}`).join(', ')}.`
      : '';
    return reply.success(interaction, `Nadano role ${outcome.role}.${removedNote}`);
  },
};
