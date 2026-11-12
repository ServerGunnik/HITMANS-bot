'use strict';

const { PermissionFlagsBits } = require('discord.js');

const { config } = require('../../config');
const capes = require('../../services/capes');
const { V2_FLAGS, reply } = require('../../ui/components');

/**
 * Decyzja administracji o wlasnej pelerynie gracza (Musicmod):
 *   - `cape:approve:<uuid>` — obrazek staje sie widoczny dla innych graczy,
 *   - `cape:reject:<uuid>`  — odrzucenie albo cofniecie wczesniejszej akceptacji.
 */
module.exports = {
  namespace: capes.NAMESPACE,

  async execute(interaction, { action, args }) {
    const allowed =
      config.ownerIds.includes(interaction.user.id) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!allowed) {
      return reply.error(interaction, 'Peleryny moze oceniac tylko administracja (uprawnienie "Zarzadzanie serwerem").');
    }
    if (action !== 'approve' && action !== 'reject') return reply.error(interaction, 'Nieznana akcja.');

    const uuid = args[0];
    const entry = capes.review(uuid, action === 'approve', `<@${interaction.user.id}>`);
    if (!entry) return reply.error(interaction, 'Nie znalazlem tego zgloszenia (gracz mogl wyslac nowe).');

    // Po odrzuceniu obrazek jest usuwany, wiec karta zostaje bez miniatury.
    const files = action === 'approve' ? capes.cardFiles(entry.custom.hash) : [];
    return interaction.update({
      components: [capes.buildCard(uuid, entry, { withPreview: files.length > 0 })],
      files,
      attachments: [],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
  },
};
