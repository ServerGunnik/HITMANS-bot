'use strict';

const suggestionsRepo = require('../../database/repositories/suggestions');
const suggestionsService = require('../../services/suggestions');
const { V2_FLAGS, payloads, reply } = require('../../ui/components');

const MESSAGES = {
  added: (value) => (value === 1 ? '👍 Zaglosowano **za** propozycja.' : '👎 Zaglosowano **przeciw** propozycji.'),
  changed: (value) => (value === 1 ? '🔄 Zmieniono glos na **za**.' : '🔄 Zmieniono glos na **przeciw**.'),
  removed: () => '↩️ Wycofano glos.',
};

/** Glosowanie 👍/👎 na karcie propozycji. */
module.exports = {
  namespace: suggestionsService.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action !== 'vote') return reply.error(interaction, 'Nieznana akcja propozycji.');

    const suggestion = suggestionsRepo.getForGuild(interaction.guild.id, Number(args[0]));
    if (!suggestion) return reply.error(interaction, 'Nie znalazlem tej propozycji w bazie.');
    if (!suggestionsService.isOpen(suggestion)) {
      return reply.error(interaction, 'Glosowanie na te propozycje jest juz zakonczone.');
    }

    const value = args[1] === 'up' ? 1 : -1;
    const outcome = suggestionsRepo.vote(suggestion.id, interaction.user.id, value);

    await interaction.deferUpdate();
    await interaction.message.edit({
      components: [suggestionsService.buildCard(suggestion)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    return interaction.followUp(payloads.info(MESSAGES[outcome](value)));
  },
};
