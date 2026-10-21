'use strict';

const { Events } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const logger = require('../utils/logger');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');

/** Po dodaniu bota na nowy serwer tworzymy wpis w bazie i wysylamy krotka instrukcje. */
module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    guilds.get(guild.id);
    logger.info(`Dodano bota na serwer: ${guild.name} (${guild.id}), czlonkow: ${guild.memberCount}`);

    const container = panel({
      color: COLORS.clan,
      title: '🏰 Dzieki za dodanie bota!',
      description:
        'Jestem botem do zarzadzania klanem: rekrutacja, role, moderacja i statystyki. ' +
        'Kazdy serwer ma wlasna, niezalezna konfiguracje.',
      fields: [
        { name: '1. Szybki start', value: '`/setup` — tworzy role, kategorie i kanaly klanowe wraz z uprawnieniami.' },
        { name: '2. Konfiguracja', value: '`/konfiguracja pokaz` — podglad ustawien, `/konfiguracja kanal` i `/konfiguracja rola` — zmiany.' },
        { name: '3. Rekrutacja', value: '`/pytania panel` — edycja pytan, `/rekrutacja-panel` — publikacja panelu zgloszen.' },
        { name: '4. Pomoc', value: '`/pomoc` — lista wszystkich komend.' },
      ],
      footer: 'Pamietaj, aby rola bota byla wyzej w hierarchii niz role, ktorymi ma zarzadzac.',
    });

    const channel =
      guild.systemChannel ??
      guild.channels.cache.find(
        (item) =>
          item.isTextBased() &&
          item.permissionsFor(guild.members.me)?.has('SendMessages'),
      );

    await channel
      ?.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch(() => {});
  },
};
