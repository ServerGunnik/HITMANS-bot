'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const { COLORS, panel, reply } = require('../../ui/components');

const SECTIONS = [
  {
    name: '📝 Rekrutacja',
    lines: [
      '`/rekrutacja` — wypelnij formularz zgloszeniowy',
      '`/rekrutacja-panel` — opublikuj panel rekrutacji na kanale *(admin)*',
      '`/pytania panel` — pytania dla kandydata i ankieta rekrutera *(admin)*',
      '`/pytania ... typ:rekruter` — pytania widoczne tylko dla administracji *(admin)*',
      '`/pytania lista | dodaj | usun | przesun | domyslne` *(admin)*',
    ],
  },
  {
    name: '🛡️ Role i uprawnienia',
    lines: [
      '`/rola nadaj` / `/rola odbierz` — zarzadzanie rolami *(mod)*',
      '`/rola awans` / `/rola degraduj` — ruch w hierarchii klanu *(mod)*',
      '`/rola hierarchia` — podglad i konfiguracja stopni *(admin)*',
      '`/setup` — tworzy role, kategorie i kanaly z uprawnieniami *(admin)*',
    ],
  },
  {
    name: '🔨 Moderacja',
    lines: [
      '`/kick` — wyrzucenie z serwera',
      '`/ban` — zbanowanie (z opcja usuniecia wiadomosci)',
      '`/timeout` — wyciszenie na okreslony czas',
      '`/warn` — ostrzezenie zapisywane w bazie',
      '`/ostrzezenia lista | usun | wyczysc` — rejestr ostrzezen',
      '`/automod` — filtr wulgaryzmow, linkow, zaproszen i spamu *(admin)*',
      '`/logi pokaz | kanal | wszystko | test` — logi zdarzen serwera *(admin)*',
      '`/logi ignoruj dodaj | usun` — wykluczenia z logowania *(admin)*',
    ],
  },
  {
    name: '💰 Ekonomia',
    lines: [
      '`/saldo [uzytkownik]` — stan konta klanowego',
      '`/przelej <uzytkownik> <kwota>` — przelew miedzy czlonkami',
      '`/ranking [typ]` — najbogatsi i najaktywniejsi',
      '`/sklep pokaz | kup | moje` — sklep klanowy',
      '`/dodaj-punkty`, `/odejmij-punkty` — reczna korekta sald *(admin)*',
      '`/ekonomia pokaz | ustaw | historia | cofnij` — nadzor nad ekonomia *(admin)*',
    ],
  },
  {
    name: '📊 Ogolne',
    lines: [
      '`/stats` — statystyki serwera i aktywnosc',
      '`/profil` — profil czlonka klanu',
      '`/konfiguracja pokaz` — aktualne ustawienia serwera *(admin)*',
      '`/pomoc` — ta lista',
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pomoc')
    .setDescription('Lista komend bota')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const container = panel({
      color: COLORS.clan,
      title: '📖 Komendy bota',
      description: `Bot do zarzadzania klanem na serwerze **${interaction.guild.name}**.`,
      fields: SECTIONS.map((section) => ({ name: section.name, value: section.lines.join('\n') })),
      footer: 'Komendy oznaczone (admin)/(mod) wymagaja odpowiednich uprawnien.',
    });

    return reply.panel(interaction, container);
  },
};
