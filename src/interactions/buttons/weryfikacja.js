'use strict';

const guilds = require('../../database/repositories/guilds');
const verification = require('../../services/verification');
const { reply } = require('../../ui/components');
const { humanDuration } = require('../../utils/format');

/** Klik "Zweryfikuj sie" -> pokaz modal z captcha. */
module.exports = {
  namespace: verification.NAMESPACE,

  async execute(interaction, { action }) {
    if (action !== 'start') return;

    const settings = guilds.get(interaction.guild.id);
    if (!settings.verification_enabled || !settings.verification_role_id) {
      return reply.error(interaction, 'Weryfikacja nie jest aktualnie skonfigurowana na tym serwerze.');
    }

    const role = interaction.guild.roles.cache.get(settings.verification_role_id);
    if (role && interaction.member.roles.cache.has(role.id)) {
      return reply.info(interaction, 'Jestes juz zweryfikowany na tym serwerze.');
    }

    const blocked = verification.isBlocked(interaction.guild.id, interaction.user.id);
    if (blocked.blocked) {
      const remainingMs = blocked.resetAt - Date.now();
      return reply.error(
        interaction,
        `Za duzo nieudanych prob. Sprobuj ponownie za **${humanDuration(remainingMs)}**.`,
      );
    }

    const challenge = verification.generateChallenge();
    verification.storeChallenge(interaction.guild.id, interaction.user.id, challenge);

    return interaction.showModal(verification.buildCaptchaModal(challenge));
  },
};
