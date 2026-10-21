'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const { COLORS, panel, reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anti-nuke')
    .setDescription('Zarzadzanie whitelista anti-nuke — uzytkownicy zwolnieni z wykrywania')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('whitelist-dodaj')
        .setDescription('Dodaje uzytkownika do whitelisty (zaufany admin)')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Kogo dodac').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('whitelist-usun')
        .setDescription('Usuwa uzytkownika z whitelisty')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Kogo usunac').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('whitelist-lista').setDescription('Pokazuje aktualna whiteliste')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const settings = guilds.get(interaction.guild.id);
    const whitelist = [...(settings.anti_nuke_whitelist ?? [])];

    if (subcommand === 'whitelist-lista') {
      if (whitelist.length === 0) {
        return reply.info(
          interaction,
          'Whitelist jest pusta. Wlasciciel serwera i bot sa zawsze zwolnieni z anti-nuke.',
        );
      }
      return reply.panel(
        interaction,
        panel({
          color: COLORS.info,
          title: '🛡️ Whitelist anti-nuke',
          description:
            'Uzytkownicy zwolnieni z wykrywania nukowania:\n' + whitelist.map((id) => `• <@${id}>`).join('\n'),
          footer: 'Wlasciciel serwera i bot sa zwolnieni zawsze.',
        }),
      );
    }

    const target = interaction.options.getUser('uzytkownik', true);

    if (subcommand === 'whitelist-dodaj') {
      if (whitelist.includes(target.id)) {
        return reply.error(interaction, `${target} juz jest na whiteliscie.`);
      }
      whitelist.push(target.id);
      guilds.update(interaction.guild.id, { anti_nuke_whitelist: whitelist });
      return reply.success(interaction, `Dodano ${target} do whitelisty anti-nuke.`);
    }

    if (subcommand === 'whitelist-usun') {
      const index = whitelist.indexOf(target.id);
      if (index === -1) {
        return reply.error(interaction, `${target} nie jest na whiteliscie.`);
      }
      whitelist.splice(index, 1);
      guilds.update(interaction.guild.id, { anti_nuke_whitelist: whitelist });
      return reply.success(interaction, `Usunieto ${target} z whitelisty anti-nuke.`);
    }
  },
};
