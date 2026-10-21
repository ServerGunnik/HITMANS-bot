'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const moderation = require('../../database/repositories/moderation');
const modlog = require('../../utils/modlog');
const { COLORS, panel, reply } = require('../../ui/components');
const { plural, timestamp, truncate } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ostrzezenia')
    .setDescription('Rejestr ostrzezen uzytkownikow')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('lista')
        .setDescription('Pokazuje ostrzezenia uzytkownika')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Czyje ostrzezenia').setRequired(true))
        .addBooleanOption((option) =>
          option.setName('historia').setDescription('Pokaz takze usuniete ostrzezenia').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa pojedyncze ostrzezenie')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID ostrzezenia (z listy)').setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('wyczysc')
        .setDescription('Usuwa wszystkie aktywne ostrzezenia uzytkownika')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Czyje ostrzezenia').setRequired(true)),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'lista') {
      const target = interaction.options.getUser('uzytkownik', true);
      const includeRemoved = interaction.options.getBoolean('historia') ?? false;
      const warnings = moderation.listWarnings(guildId, target.id, { includeRemoved });

      if (warnings.length === 0) {
        return reply.info(interaction, `**${target.tag}** nie ma zadnych ostrzezen.`);
      }

      const blocks = warnings.slice(0, 15).map((warning) => {
        const state = warning.active ? '🟠' : '⚪';
        const removed = warning.active
          ? ''
          : `\n> *Usuniete przez <@${warning.removed_by}> ${timestamp(warning.removed_at, 'R')}*`;
        return (
          `${state} **#${warning.id}** • ${timestamp(warning.created_at, 'f')}\n` +
          `> Moderator: <@${warning.moderator_id}>\n` +
          `> Powod: ${truncate(warning.reason, 300)}${removed}`
        );
      });

      const active = warnings.filter((warning) => warning.active).length;
      const container = panel({
        color: active > 0 ? COLORS.warning : COLORS.success,
        title: `⚠️ Ostrzezenia — ${target.username}`,
        description: `${target} ma **${active}** ${plural(active, 'aktywne ostrzezenie', 'aktywne ostrzezenia', 'aktywnych ostrzezen')}.`,
        thumbnail: { url: target.displayAvatarURL({ size: 256 }) },
        blocks,
        footer:
          warnings.length > 15
            ? `Pokazano 15 z ${warnings.length} wpisow • ID uzytkownika: ${target.id}`
            : `ID uzytkownika: ${target.id}`,
      });

      return reply.panel(interaction, container);
    }

    if (subcommand === 'usun') {
      const id = interaction.options.getInteger('id', true);
      const warning = moderation.removeWarning(guildId, id, interaction.user.id);

      if (!warning) {
        return reply.error(interaction, `Nie znalazlem aktywnego ostrzezenia o ID **#${id}** na tym serwerze.`);
      }

      const user = await interaction.client.users.fetch(warning.user_id).catch(() => null);
      if (user) {
        await modlog.logAction(interaction.guild, {
          action: 'unwarn',
          user,
          moderator: interaction.user,
          reason: `Usunieto ostrzezenie #${id} (${truncate(warning.reason, 200)})`,
        });
      }

      return reply.success(
        interaction,
        `Ostrzezenie **#${id}** dla <@${warning.user_id}> zostalo usuniete.`,
        { ephemeral: false },
      );
    }

    // wyczysc
    const target = interaction.options.getUser('uzytkownik', true);
    const count = moderation.clearWarnings(guildId, target.id, interaction.user.id);

    if (count === 0) {
      return reply.info(interaction, `**${target.tag}** nie ma aktywnych ostrzezen.`);
    }

    await modlog.logAction(interaction.guild, {
      action: 'unwarn',
      user: target,
      moderator: interaction.user,
      reason: `Wyczyszczono wszystkie ostrzezenia (${count})`,
    });

    return reply.success(
      interaction,
      `Usunieto **${count}** ${plural(count, 'ostrzezenie', 'ostrzezenia', 'ostrzezen')} uzytkownika **${target.tag}**.`,
      { ephemeral: false },
    );
  },
};
