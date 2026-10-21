'use strict';

const { MessageFlags } = require('discord.js');

const voiceRepo = require('../../database/repositories/voice');
const voiceService = require('../../services/voice');
const { isAdmin } = require('../../utils/permissions');
const { reply } = require('../../ui/components');

function canManage(member, record) {
  return member.id === record.owner_id || isAdmin(member);
}

/** Wlasciciel kanalu przekazuje wlasnosc / wyrzuca uzytkownika przez select z userami. */
module.exports = {
  namespace: voiceService.NAMESPACE,

  async execute(interaction, { action }) {
    // action: transferPick albo kickPick — wybor osoby z UserSelectMenu.
    const targetId = interaction.values?.[0];
    if (!targetId) return;

    // Panel byl wyslany ephemeralnie w interakcji przycisku — teraz interaction.channel to tamten kanal.
    // Musimy znalezc kanal wlasnie tego usera na guildzie. Bierzemy zajmowany kanal glosowy autora.
    const authorVoice = interaction.member?.voice?.channel;
    const record = authorVoice ? voiceRepo.get(authorVoice.id) : null;

    if (!authorVoice || !record) {
      return reply.error(interaction, 'Musisz byc podlaczony do swojego kanalu glosowego, zeby uzyc tej akcji.');
    }
    if (!canManage(interaction.member, record)) {
      return reply.error(interaction, 'Tylko wlasciciel lub administrator moze uzyc tej akcji.');
    }

    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) return reply.error(interaction, 'Nie znalazlem tej osoby na serwerze.');

    if (action === 'transferPick') {
      if (target.id === record.owner_id) return reply.error(interaction, 'Ta osoba juz jest wlascicielem kanalu.');
      if (target.user.bot) return reply.error(interaction, 'Nie moge przekazac wlasnosci botowi.');
      if (!authorVoice.members.has(target.id)) {
        return reply.error(interaction, 'Ta osoba musi znajdowac sie w kanale glosowym, zeby dostac wlasnosc.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await voiceService.transferOwnership(authorVoice, target);
      return reply.success(interaction, `👑 Przekazano wlasnosc kanalu do ${target}.`);
    }

    if (action === 'kickPick') {
      if (target.id === record.owner_id) return reply.error(interaction, 'Wlasciciel nie moze wyrzucic samego siebie — uzyj "Zamknij kanal".');
      if (!authorVoice.members.has(target.id)) {
        return reply.error(interaction, 'Ta osoba nie jest w tym kanale glosowym.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await target.voice.disconnect(`Wyrzucony przez wlasciciela kanalu (${interaction.user.tag})`);
      } catch (error) {
        return reply.error(interaction, `Nie moglem wyrzucic: ${error.message}`);
      }
      return reply.success(interaction, `🚫 Wyrzucono ${target} z kanalu.`);
    }
  },
};
