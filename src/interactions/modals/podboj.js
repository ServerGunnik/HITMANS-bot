'use strict';

const { MessageFlags } = require('discord.js');

const conquest = require('../../services/conquest');
const { reply } = require('../../ui/components');

module.exports = {
  namespace: conquest.NAMESPACE,

  async execute(interaction, { action }) {
    if (action !== 'submit') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const form = {
      nick: interaction.fields.getTextInputValue('nick').trim(),
      ourCountry: interaction.fields.getTextInputValue('ourCountry').trim(),
      character: interaction.fields.getTextInputValue('character').trim(),
      target: interaction.fields.getTextInputValue('target').trim(),
      offer: interaction.fields.getTextInputValue('offer').trim(),
    };

    const result = await conquest.createTicket(interaction, form);
    if (!result.ok) return reply.error(interaction, result.reason);

    return reply.success(interaction, `Ticket utworzony: ${result.channel}. Rozmawiajcie tam ze staffem.`);
  },
};
