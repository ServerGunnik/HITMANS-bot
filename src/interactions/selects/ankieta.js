'use strict';

const { MessageFlags } = require('discord.js');

const pollsRepo = require('../../database/repositories/polls');
const pollsService = require('../../services/polls');
const { COLORS, panel, reply, V2_FLAGS } = require('../../ui/components');

/** Obsluga wyboru w selectcie dla ankiet z >5 opcjami. */
module.exports = {
  namespace: pollsService.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action !== 'vote') return;

    const pollId = Number(args[0]);
    const poll = pollsRepo.get(pollId);

    if (!poll || poll.guild_id !== interaction.guild.id) {
      return reply.error(interaction, 'Nie znalazlem tej ankiety w bazie.');
    }
    if (poll.closed) return reply.error(interaction, 'Ta ankieta jest juz zamknieta.');

    await interaction.deferUpdate();

    const selectedIds = interaction.values.map((value) => Number(value));
    const validOptionIds = new Set(poll.options.map((option) => option.id));
    const chosen = selectedIds.filter((id) => validOptionIds.has(id));

    if (chosen.length === 0) return;

    // Dla ankiety pojedynczej: przy uzyciu selecta traktujemy wybor jako zamiane glosu.
    // Dla wielokrotnej: kazdy wybor to toggle.
    const changes = [];
    for (const optionId of chosen) {
      const outcome = pollsRepo.toggleVote({
        pollId: poll.id,
        optionId,
        userId: interaction.user.id,
        multi: poll.multi,
      });
      const option = poll.options.find((entry) => entry.id === optionId);
      changes.push({ option, outcome });
    }

    const refreshed = pollsRepo.get(poll.id);
    await interaction.message.edit({
      components: [pollsService.buildPanel(refreshed)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    const summary = changes
      .map((change) => `${change.outcome === 'added' ? '✅' : '↩️'} ${change.option.label}`)
      .join('\n');

    return interaction.followUp({
      components: [panel({ color: COLORS.success, description: summary })],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
