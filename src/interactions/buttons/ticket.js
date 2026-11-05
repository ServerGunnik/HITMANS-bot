'use strict';

const ticketsRepo = require('../../database/repositories/supportTickets');
const tickets = require('../../services/supportTickets');
const { reply } = require('../../ui/components');

/** Przyciski ticketow pomocy: wybor kategorii, Przejmij, Zamknij. */
module.exports = {
  namespace: tickets.NAMESPACE,

  async execute(interaction, { action, args }) {
    if (action === 'open') {
      const category = args[0];
      if (!tickets.CATEGORIES[category]) return reply.error(interaction, 'Nieznana kategoria ticketu.');

      const settings = ticketsRepo.getSettings(interaction.guild.id);
      if (!settings.category_id || !settings.staff_role_id) {
        return reply.error(interaction, 'Tickety nie sa jeszcze skonfigurowane. Admin: `/ticket-panel ustaw`.');
      }

      // Szybka kontrola limitu, zanim uzytkownik wypelni formularz.
      const existing = ticketsRepo.findOpen(interaction.guild.id, interaction.user.id, category);
      if (existing?.channel_id && interaction.guild.channels.cache.has(existing.channel_id)) {
        return reply.error(interaction, `Masz juz otwarty ticket w tej kategorii: <#${existing.channel_id}>.`);
      }

      return interaction.showModal(tickets.buildOpenModal(category));
    }

    const ticket = ticketsRepo.get(Number(args[0]));
    if (!ticket || ticket.guild_id !== interaction.guild.id) {
      return reply.error(interaction, 'Nie znalazlem tego ticketu.');
    }
    if (ticket.status !== 'open') return reply.error(interaction, 'Ten ticket jest juz zamkniety.');

    const settings = ticketsRepo.getSettings(interaction.guild.id);
    const staff = tickets.isStaff(interaction.member, settings);

    if (action === 'claim') {
      if (!staff) return reply.error(interaction, 'Ticket moze przejac tylko obsluga.');
      if (ticket.claimed_by) return reply.info(interaction, `Ten ticket obsluguje juz <@${ticket.claimed_by}>.`);
      await tickets.claimTicket(interaction, ticket);
      return;
    }

    if (action === 'close') {
      if (!staff && interaction.user.id !== ticket.user_id) {
        return reply.error(interaction, 'Ticket moze zamknac tylko zglaszajacy lub obsluga.');
      }
      return interaction.showModal(tickets.buildCloseModal(ticket.id));
    }
  },
};
