'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const conquestRepo = require('../../database/repositories/conquest');
const conquest = require('../../services/conquest');
const guilds = require('../../database/repositories/guilds');
const { isAdmin } = require('../../utils/permissions');
const { reply } = require('../../ui/components');

function canClose(member, ticket) {
  if (member.id === ticket.user_id) return true;
  if (isAdmin(member)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const settings = guilds.get(member.guild.id);
  return settings.conquest_staff_role_id ? member.roles.cache.has(settings.conquest_staff_role_id) : false;
}

module.exports = {
  namespace: conquest.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action === 'start') {
      return interaction.showModal(conquest.buildFormModal());
    }

    if (action === 'close') {
      const ticketId = Number(args[0]);
      const ticket = conquestRepo.get(ticketId);
      if (!ticket || ticket.guild_id !== interaction.guild.id) {
        return reply.error(interaction, 'Nie znalazłem tego ticketu.');
      }
      if (ticket.status === 'closed') {
        return reply.error(interaction, 'Ten ticket jest już zamknięty.');
      }
      if (!canClose(interaction.member, ticket)) {
        return reply.error(interaction, 'Ticket może zamknąć tylko zleceniodawca lub staff.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await conquest.closeTicket(interaction, ticket);
      if (!result.ok) return reply.error(interaction, result.reason);
      // kanał usunięty — followUp niekonieczny
      return;
    }
  },
};
