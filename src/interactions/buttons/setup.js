'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const setupService = require('../../services/setup');
const logger = require('../../utils/logger');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

/** Potwierdzenie / anulowanie komendy /setup. */
module.exports = {
  namespace: 'setup',

  async execute(interaction, { action }) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return reply.error(interaction, 'Ta akcja wymaga uprawnienia **Administrator**.');
    }

    if (action === 'cancel') {
      return interaction.update({
        components: [
          panel({
            color: COLORS.neutral,
            title: '✖️ Anulowano',
            description: 'Struktura klanu nie zostala zmieniona.',
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    await interaction.update({
      components: [
        panel({
          color: COLORS.info,
          title: '⏳ Tworze strukture klanu...',
          description: 'To moze potrwac kilkanascie sekund. Nie zamykaj tego okna.',
        }),
      ],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      const summary = await setupService.run(interaction.guild);

      return interaction.editReply({
        components: [
          panel({
            color: COLORS.success,
            title: '✅ Struktura klanu gotowa',
            blocks: [truncate(summary.map((line) => `• ${line}`).join('\n'), 3500)],
            footer: 'Podglad ustawien: /konfiguracja pokaz • Edycja pytan: /pytania panel',
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      logger.error('Blad podczas /setup:', error);

      return interaction.editReply({
        components: [
          panel({
            color: COLORS.danger,
            title: '❌ Konfiguracja przerwana',
            description: `Wystapil blad: ${truncate(error.message, 500)}`,
            footer: 'Czesc elementow mogla zostac utworzona — uruchom /setup ponownie po naprawieniu problemu.',
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};
