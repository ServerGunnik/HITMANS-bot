'use strict';

const { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const activityRepo = require('../../database/repositories/clanActivity');
const inactivity = require('../../services/inactivity');
const weeklyReport = require('../../services/weeklyReport');
const { isAdmin } = require('../../utils/permissions');
const { reportSlot } = require('../../utils/clanTime');
const { reply } = require('../../ui/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raport')
    .setDescription('Tygodniowy raport aktywnosci klanu (oficerowie)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('teraz')
        .setDescription('Generuje raport z ostatnich 7 dni')
        .addBooleanOption((option) =>
          option.setName('opublikuj').setDescription('Wyslij na kanal raportow zamiast tylko Tobie').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Ustawia kanal automatycznego raportu (pon. 10:00) — bez kanalu wylacza (admin)')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal raportu tygodniowego')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('dni_nieaktywnosci')
            .setDescription('Po ilu dniach bez aktywnosci liczyc osobe jako nieaktywna (domyslnie 14)')
            .setMinValue(1)
            .setMaxValue(365)
            .setRequired(false),
        ),
    ),

  cooldown: 10,

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (subcommand === 'teraz') {
      if (!inactivity.isOfficer(interaction.member)) {
        return reply.error(interaction, 'Raport jest dostepny tylko dla oficerow i administracji.');
      }

      const publish = interaction.options.getBoolean('opublikuj') ?? false;
      const channelId = activityRepo.getSettings(guild.id).report_channel_id;
      if (publish && !channelId) {
        return reply.error(interaction, 'Najpierw ustaw kanal raportow: `/raport kanal`.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const container = await weeklyReport.generate(guild, { ...weeklyReport.manualRange(), manual: true });

      if (publish) {
        try {
          await weeklyReport.sendToChannel(guild, channelId, container);
        } catch (error) {
          return reply.error(interaction, `Nie udalo sie wyslac raportu: ${error.message}`);
        }
        return reply.success(interaction, `Raport opublikowany na <#${channelId}>.`);
      }
      return reply.panel(interaction, container);
    }

    // kanal
    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Kanal raportu moze ustawic tylko administracja.');
    }

    const channel = interaction.options.getChannel('kanal');
    const days = interaction.options.getInteger('dni_nieaktywnosci');
    const patch = {};
    if (days) patch.inactive_days = days;

    if (!channel) {
      const settings = activityRepo.updateSettings(guild.id, { ...patch, report_channel_id: null });
      return reply.success(
        interaction,
        `Automatyczny raport tygodniowy zostal wylaczony.` +
          (days ? ` Prog nieaktywnosci: **${settings.inactive_days}** dni.` : ''),
      );
    }

    // Biezacy tydzien oznaczamy jako "wyslany", zeby nie dostac raportu od razu po konfiguracji.
    const settings = activityRepo.updateSettings(guild.id, {
      ...patch,
      report_channel_id: channel.id,
      report_last_week: reportSlot().key,
    });
    return reply.success(
      interaction,
      `Raport tygodniowy bedzie publikowany na ${channel} w kazdy poniedzialek o 10:00 (czas polski).\n` +
        `Prog nieaktywnosci: **${settings.inactive_days}** dni.`,
    );
  },
};
