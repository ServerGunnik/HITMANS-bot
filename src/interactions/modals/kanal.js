'use strict';

const voiceRepo = require('../../database/repositories/voice');
const voiceService = require('../../services/voice');
const { isAdmin } = require('../../utils/permissions');
const { reply } = require('../../ui/components');

function canManage(member, record) {
  return member.id === record.owner_id || isAdmin(member);
}

module.exports = {
  namespace: voiceService.NAMESPACE,

  async execute(interaction, { action }) {
    const channel = interaction.channel;
    const record = voiceRepo.get(channel?.id);
    if (!record) return reply.error(interaction, 'Nie znajduje kanalu w bazie.');
    if (!canManage(interaction.member, record)) {
      return reply.error(interaction, 'Tylko wlasciciel lub administrator moze uzyc tej akcji.');
    }

    if (action === 'renameModal') {
      const name = interaction.fields.getTextInputValue('name').trim().slice(0, 100);
      if (!name) return reply.error(interaction, 'Nazwa nie moze byc pusta.');
      try {
        await channel.setName(name, `Zmiana nazwy przez ${interaction.user.tag}`);
      } catch (error) {
        return reply.error(interaction, `Nie moglem zmienic nazwy: ${error.message}`);
      }
      return reply.success(interaction, `✏️ Nazwa kanalu zmieniona na **${name}**.`);
    }

    if (action === 'limitModal') {
      const raw = interaction.fields.getTextInputValue('limit').trim();
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        return reply.error(interaction, 'Podaj liczbe calkowita z zakresu 0-99.');
      }
      try {
        await channel.setUserLimit(limit, `Zmiana limitu przez ${interaction.user.tag}`);
      } catch (error) {
        return reply.error(interaction, `Nie moglem zmienic limitu: ${error.message}`);
      }
      return reply.success(
        interaction,
        limit === 0 ? '👥 Limit osob wylaczony.' : `👥 Limit osob ustawiony na **${limit}**.`,
      );
    }
  },
};
