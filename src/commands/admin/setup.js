'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const setupService = require('../../services/setup');
const { build: customId } = require('../../utils/customId');
const { COLORS, button, panel, reply, row } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Tworzy strukture klanu: role, kategorie i kanaly wraz z uprawnieniami')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const me = interaction.guild.members.me;

    const missing = [];
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('Zarzadzanie rolami');
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Zarzadzanie kanalami');

    if (missing.length > 0) {
      return reply.error(
        interaction,
        `Brakuje mi uprawnien: **${missing.join('**, **')}**. Nadaj je botowi i sprobuj ponownie.`,
      );
    }

    const plan = setupService.describePlan(interaction.guild);

    const container = panel({
      color: COLORS.clan,
      title: '🏰 Konfiguracja struktury klanu',
      description:
        'Utworze ponizsza strukture. Istniejace role i kanaly o tych nazwach zostana **uzyte ponownie** ' +
        '(zaktualizuje tylko ich uprawnienia) — nic nie zostanie usuniete.',
      fields: [
        { name: 'Role', value: plan.roles.join('\n') },
        { name: 'Kategorie i kanaly', value: plan.channels.join('\n\n') },
        {
          name: 'Co jeszcze ustawie',
          value:
            '• role startowa (Gosc) nadawana automatycznie nowym osobom\n' +
            '• role czlonka nadawana po akceptacji zgloszenia\n' +
            '• kanaly: zgloszenia, logi moderacji, powitania\n' +
            '• domyslny zestaw pytan (jesli formularz jest pusty) i panel rekrutacji',
        },
      ],
      rows: [
        row(
          button({ id: customId('setup', 'run'), label: 'Utworz strukture', emoji: '✅', style: 'success' }),
          button({ id: customId('setup', 'cancel'), label: 'Anuluj', emoji: '✖️', style: 'secondary' }),
        ),
      ],
      footer: 'Rola bota musi znajdowac sie nad tworzonymi rolami, inaczej nie ustawie ich kolejnosci.',
    });

    return reply.panel(interaction, container);
  },
};
