'use strict';

const { MessageFlags } = require('discord.js');

const verification = require('../../services/verification');
const { reply } = require('../../ui/components');
const { humanDuration, plural } = require('../../utils/format');

module.exports = {
  namespace: verification.NAMESPACE,

  async execute(interaction, { action }) {
    if (action !== 'answer') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const challenge = verification.consumeChallenge(interaction.guild.id, interaction.user.id);
    if (!challenge) {
      return reply.error(
        interaction,
        'Zadanie captcha wygaslo. Kliknij ponownie **Zweryfikuj sie** aby otrzymac nowe.',
      );
    }

    const raw = interaction.fields.getTextInputValue('answer').trim();
    const answer = Number(raw.replace(',', '.'));

    if (!Number.isFinite(answer) || Math.trunc(answer) !== answer) {
      const state = verification.registerFailure(interaction.guild.id, interaction.user.id);
      return reply.error(
        interaction,
        state.blocked
          ? `Nieprawidlowa odpowiedz. Za duzo prob — sprobuj ponownie za **${humanDuration(state.resetAt - Date.now())}**.`
          : `Wpisz sama liczbe (bez tekstu). Pozostalo prob: **${state.remaining}**.`,
      );
    }

    if (answer !== challenge.expected) {
      const state = verification.registerFailure(interaction.guild.id, interaction.user.id);
      return reply.error(
        interaction,
        state.blocked
          ? `Bledna odpowiedz. Za duzo prob — sprobuj ponownie za **${humanDuration(state.resetAt - Date.now())}**.`
          : `Bledna odpowiedz. Pozostalo **${state.remaining}** ${plural(state.remaining, 'proba', 'proby', 'prob')}.`,
      );
    }

    const result = await verification.grantVerifiedRole(interaction.member);
    if (!result.ok) {
      return reply.error(interaction, `Weryfikacja poprawna, ale ${result.reason}`);
    }

    verification.clearFailures(interaction.guild.id, interaction.user.id);
    return reply.success(
      interaction,
      result.alreadyHad
        ? 'Byles juz zweryfikowany — nic nie zmienialem.'
        : 'Weryfikacja zaliczona! Rola nadana, milego pobytu.',
    );
  },
};
