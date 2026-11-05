'use strict';

const { MessageFlags } = require('discord.js');

const ticketsRepo = require('../../database/repositories/supportTickets');
const tickets = require('../../services/supportTickets');
const { reply } = require('../../ui/components');

/** Formularze ticketow pomocy: opis nowego zgloszenia i powod zamkniecia. */
module.exports = {
  namespace: tickets.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action === 'submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const description = interaction.fields.getTextInputValue('opis').trim();
      const result = await tickets.createTicket(interaction, args[0], description);
      if (!result.ok) return reply.error(interaction, result.reason);
      return reply.success(interaction, `Ticket utworzony: ${result.channel}. Obsluga odpowie tam najszybciej, jak to mozliwe.`);
    }

    if (action === 'close') {
      const ticket = ticketsRepo.get(Number(args[0]));
      if (!ticket || ticket.guild_id !== interaction.guild.id) {
        return reply.error(interaction, 'Nie znalazlem tego ticketu.');
      }
      const settings = ticketsRepo.getSettings(interaction.guild.id);
      if (!tickets.isStaff(interaction.member, settings) && interaction.user.id !== ticket.user_id) {
        return reply.error(interaction, 'Ticket moze zamknac tylko zglaszajacy lub obsluga.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = interaction.fields.getTextInputValue('powod')?.trim() || null;
      const result = await tickets.closeTicket(interaction, ticket, reason);
      if (!result.ok) return reply.error(interaction, result.reason);

      const notes = [
        result.logged ? 'transkrypcja zapisana na kanale logow' : 'brak kanalu logow — transkrypcja nie zostala zapisana',
        result.dmSent ? 'kopia wyslana zglaszajacemu w DM' : 'nie udalo sie wyslac DM do zglaszajacego',
      ];
      return reply.success(interaction, `Ticket #${ticket.id} zamkniety (${notes.join(', ')}).`);
    }
  },
};
