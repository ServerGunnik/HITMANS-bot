'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const giveawaysRepo = require('../../database/repositories/giveaways');
const giveawaysService = require('../../services/giveaways');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply, V2_FLAGS } = require('../../ui/components');

function canManage(member, giveaway) {
  return (
    member.id === giveaway.author_id ||
    isAdmin(member) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages)
  );
}

async function refreshOriginal(interaction, giveaway) {
  await interaction.message.edit({
    components: [giveawaysService.buildPanel(giveaway)],
    flags: V2_FLAGS,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  namespace: giveawaysService.NAMESPACE,

  async execute(interaction, { action, args }) {
    const giveawayId = Number(args[0]);
    const giveaway = giveawaysRepo.get(giveawayId);

    if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
      return reply.error(interaction, 'Nie znalazlem tego losowania w bazie.');
    }

    if (action === 'join') {
      if (giveaway.closed) return reply.error(interaction, 'To losowanie zostalo juz zakonczone.');

      if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
        return reply.error(
          interaction,
          `Aby wziac udzial musisz miec role <@&${giveaway.required_role_id}>.`,
        );
      }

      const outcome = giveawaysRepo.join(giveaway.id, interaction.user.id);
      if (outcome === 'already') {
        return reply.info(interaction, 'Juz jestes na liscie uczestnikow — powodzenia!');
      }

      await interaction.deferUpdate();
      await refreshOriginal(interaction, giveawaysRepo.get(giveaway.id));
      return interaction.followUp({
        components: [panel({ color: COLORS.success, description: '🎉 Dolaczono do losowania. Trzymamy kciuki!' })],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    if (action === 'leave') {
      if (giveaway.closed) return reply.error(interaction, 'To losowanie zostalo juz zakonczone.');

      const outcome = giveawaysRepo.leave(giveaway.id, interaction.user.id);
      if (outcome === 'not_joined') {
        return reply.info(interaction, 'Nie bierzesz udzialu w tym losowaniu.');
      }

      await interaction.deferUpdate();
      await refreshOriginal(interaction, giveawaysRepo.get(giveaway.id));
      return interaction.followUp({
        components: [panel({ color: COLORS.warning, description: '↩️ Wycofano zgloszenie z losowania.' })],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    if (action === 'end') {
      if (giveaway.closed) return reply.error(interaction, 'To losowanie zostalo juz zakonczone.');
      if (!canManage(interaction.member, giveaway)) {
        return reply.error(interaction, 'Tylko autor lub administrator moze zakonczyc losowanie wczesniej.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await giveawaysService.finalizeGiveaway(interaction.client, giveaway.id);
      return reply.success(interaction, 'Losowanie zakonczone i zwyciezcy wybrani.');
    }

    if (action === 'reroll') {
      if (!giveaway.closed) return reply.error(interaction, 'Losowanie jeszcze trwa — reroll jest dostepny po zakonczeniu.');
      if (!canManage(interaction.member, giveaway)) {
        return reply.error(interaction, 'Tylko autor lub administrator moze losowac ponownie.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = await interaction.client.channels
        .fetch(giveaway.channel_id)
        .catch(() => null);
      await giveawaysService.rerollGiveaway(interaction.client, giveaway.id, { announceChannel: channel });
      return reply.success(interaction, 'Wylosowano ponownie.');
    }
  },
};
