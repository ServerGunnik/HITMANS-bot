'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const notes = require('../../database/repositories/officerNotes');
const inactivity = require('../../services/inactivity');
const notesService = require('../../services/officerNotes');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notatka')
    .setDescription('Notatki oficerow o czlonkach (widoczne tylko dla kadry)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('dodaj')
        .setDescription('Dodaje notatke o czlonku')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo dotyczy notatka').setRequired(true))
        .addStringOption((option) =>
          option.setName('tresc').setDescription('Tresc notatki').setRequired(true).setMaxLength(notes.MAX_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('lista')
        .setDescription('Pokazuje notatki o czlonku')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Czyje notatki').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa notatke')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID notatki (z listy)').setRequired(true).setMinValue(1),
        ),
    ),

  async execute(interaction) {
    if (!inactivity.isOfficer(interaction.member)) {
      return reply.error(interaction, 'Notatki sa dostepne tylko dla oficerow i administracji.');
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'dodaj') {
      const target = interaction.options.getUser('uzytkownik', true);
      const content = interaction.options.getString('tresc', true).trim();
      if (!content) return reply.error(interaction, 'Notatka nie moze byc pusta.');

      const note = notes.add({ guildId, userId: target.id, authorId: interaction.user.id, content });
      return reply.success(interaction, `Dodano notatke **#${note.id}** o ${target}.`);
    }

    if (subcommand === 'lista') {
      const target = interaction.options.getUser('uzytkownik', true);
      const list = notes.list(guildId, target.id, { limit: 15 });
      return reply.panel(interaction, notesService.buildNotesPanel(target, list, notes.count(guildId, target.id)));
    }

    const id = interaction.options.getInteger('id', true);
    const removed = notes.remove(guildId, id);
    if (!removed) return reply.error(interaction, `Nie znalazlem notatki **#${id}** na tym serwerze.`);
    return reply.success(interaction, `Usunieto notatke **#${id}** o <@${removed.user_id}>.`);
  },
};
