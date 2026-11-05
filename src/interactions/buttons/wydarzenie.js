'use strict';

const { MessageFlags } = require('discord.js');

const eventsRepo = require('../../database/repositories/events');
const eventsService = require('../../services/events');
const { COLORS, panel, reply, V2_FLAGS } = require('../../ui/components');

module.exports = {
  namespace: eventsService.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action !== 'rsvp') return reply.error(interaction, 'Nieznana akcja wydarzenia.');

    const event = eventsRepo.getForGuild(interaction.guild.id, Number(args[0]));
    const status = args[1];
    if (!event) return reply.error(interaction, 'Nie znalazlem tego wydarzenia w bazie.');
    if (!eventsService.RSVP_META[status]) return reply.error(interaction, 'Nieznana opcja zapisu.');
    if (event.status === 'cancelled') return reply.error(interaction, 'To wydarzenie zostalo odwolane.');
    if (event.status !== 'scheduled' || event.starts_at <= Date.now()) {
      return reply.error(interaction, 'Zapisy na to wydarzenie sa juz zamkniete.');
    }

    const outcome = eventsRepo.setRsvp(event.id, interaction.user.id, status);
    const meta = eventsService.RSVP_META[status];

    await interaction.deferUpdate();
    await interaction.message.edit({
      components: [eventsService.buildCard(event)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });

    const text = outcome === 'removed'
      ? `↩️ Wypisano Cie z wydarzenia **${event.title}**.`
      : `${meta.emoji} Zapisano: **${meta.label}** — ${event.title}.`;

    return interaction.followUp({
      components: [panel({ color: outcome === 'removed' ? COLORS.warning : COLORS.success, description: text })],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
