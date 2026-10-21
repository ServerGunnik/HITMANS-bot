'use strict';

const {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const recruitment = require('../../database/repositories/recruitment');
const recruitmentService = require('../../services/recruitment');
const { buildProfile } = require('../../commands/general/profil');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply } = require('../../ui/components');
const { build: customId } = require('../../utils/customId');

/** Czy uzytkownik moze rozpatrywac zgloszenia. */
function canReview(member) {
  return isAdmin(member) || member.permissions.has(PermissionFlagsBits.ManageRoles);
}

function buildRejectModal(applicationId) {
  return new ModalBuilder()
    .setCustomId(customId(recruitmentService.NAMESPACE, 'rejectModal', applicationId))
    .setTitle(`Odrzucenie zgloszenia #${applicationId}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Powod odrzucenia')
        .setDescription('Trafi do kandydata w wiadomosci prywatnej.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('reason')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(800)
            .setPlaceholder('np. Zbyt malo doswiadczenia — zapraszamy ponownie za miesiac.'),
        ),
    );
}

function buildScheduleModal(applicationId, initialTime = '') {
  const input = new TextInputBuilder()
    .setCustomId('time')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(200)
    .setPlaceholder('np. sobota 27.09.2026 o 19:00');

  // Discord odrzuca setValue('') przy setMinLength(2) — ustawiamy tylko realna wartosc.
  if (initialTime && initialTime.length >= 2) input.setValue(initialTime);

  return new ModalBuilder()
    .setCustomId(customId(recruitmentService.NAMESPACE, 'scheduleModal', applicationId))
    .setTitle(`Termin rekrutacji #${applicationId}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Termin')
        .setDescription('Wolny tekst — np. "piatek 26.09 o 20:00" albo "jutro wieczorem".')
        .setTextInputComponent(input),
    );
}

/** Przyciski panelu rekrutacji oraz karty zgloszenia. */
module.exports = {
  namespace: recruitmentService.NAMESPACE,

  async execute(interaction, { action, args }) {
    const { guild } = interaction;

    // ─── Kandydat: otwarcie formularza ──────────────────────────────────
    if (action === 'start') {
      const check = recruitmentService.canApply(interaction.member);
      if (!check.ok) return reply.error(interaction, check.reason);

      const modal = recruitmentService.buildApplicationModal(guild);
      if (!modal) return reply.error(interaction, 'Formularz nie ma jeszcze zadnych pytan.');
      return interaction.showModal(modal);
    }

    // ─── DM-owe akcje terminowania (dostepne dla kandydata lub rekrutera bez uprawnien admina) ──
    if (action === 'schedYes' || action === 'schedNo') {
      const applicationId = Number(args[0]);
      const application = recruitment.getApplication(applicationId);
      if (!application) return reply.error(interaction, 'Nie znalazlem tego zgloszenia w bazie danych.');
      if (application.schedule_state !== 'pending') {
        return reply.error(interaction, 'Ta propozycja terminu jest juz nieaktualna.');
      }

      const expectedResponder =
        application.schedule_awaiting === 'applicant' ? application.user_id : application.schedule_reviewer_id;

      if (interaction.user.id !== expectedResponder) {
        return reply.error(interaction, 'Nie mozesz odpowiedziec na te propozycje — czekamy na osobe wyzej.');
      }

      const responderGuild = interaction.client.guilds.cache.get(application.guild_id);
      if (!responderGuild) {
        return reply.error(interaction, 'Nie widze juz tego serwera — moze bot zostal z niego usuniety.');
      }

      if (action === 'schedYes') {
        await interaction.deferUpdate();
        const result = await recruitmentService.acceptSchedule({
          guild: responderGuild,
          application,
        });
        if (!result.ok) return reply.error(interaction, result.reason);
        return; // DM z potwierdzeniem jest wyslany przez service
      }

      // schedNo -> pokaz modal, ta sama funkcja co dla rekrutera przy pierwszej propozycji
      return interaction.showModal(buildScheduleModal(applicationId, application.schedule_time));
    }

    // ─── Administracja: decyzje ─────────────────────────────────────────
    if (!canReview(interaction.member)) {
      return reply.error(interaction, 'Tylko osoby z uprawnieniem **Zarzadzanie rolami** moga rozpatrywac zgloszenia.');
    }

    const applicationId = Number(args[0]);
    const application = recruitment.getApplication(applicationId);

    if (!application || application.guild_id !== guild.id) {
      return reply.error(interaction, 'Nie znalazlem tego zgloszenia w bazie danych.');
    }

    // Rekruter otwiera modal do zaproponowania terminu rekrutacji glosowej.
    if (action === 'schedule') {
      if (application.status !== 'pending' && application.status !== 'accepted') {
        return reply.error(interaction, 'To zgloszenie zostalo juz odrzucone.');
      }
      if (application.schedule_state === 'agreed') {
        return reply.error(interaction, 'Termin rekrutacji glosowej jest juz uzgodniony.');
      }
      if (
        application.schedule_reviewer_id &&
        application.schedule_reviewer_id !== interaction.user.id
      ) {
        return reply.error(
          interaction,
          `Ten dialog terminowania prowadzi juz <@${application.schedule_reviewer_id}>.`,
        );
      }
      return interaction.showModal(buildScheduleModal(applicationId, application.schedule_time));
    }

    if (action === 'profile') {
      const member = await guild.members.fetch(application.user_id).catch(() => null);
      if (!member) {
        return reply.error(interaction, 'Kandydat nie jest juz czlonkiem tego serwera.');
      }
      return reply.panel(interaction, buildProfile(member, { viewer: interaction.user }));
    }

    if (application.status !== 'pending') {
      const meta = recruitmentService.STATUS_META[application.status];
      return reply.error(
        interaction,
        `To zgloszenie zostalo juz rozpatrzone (${meta.emoji} ${meta.label}) przez <@${application.reviewer_id}>.`,
      );
    }

    if (action === 'reject') {
      return interaction.showModal(buildRejectModal(applicationId));
    }

    // Ankieta oceny — pytania widoczne dla rekrutera, nie dla kandydata.
    if (action === 'review') {
      const previous = recruitment.getReview(applicationId, interaction.user.id);
      const modal = recruitmentService.buildReviewModal(guild, application, previous);

      if (!modal) {
        return reply.error(
          interaction,
          'Nie skonfigurowano jeszcze pytan dla rekruterow — dodaj je komenda `/pytania panel typ:rekruter`.',
        );
      }

      return interaction.showModal(modal);
    }

    // accept
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await recruitmentService.acceptApplication({
      guild,
      application,
      reviewer: interaction.user,
    });

    if (!result.ok) return reply.error(interaction, result.reason);

    const container = panel({
      color: COLORS.success,
      title: '✅ Zgloszenie zaakceptowane',
      description: `Zgloszenie **#${application.id}** uzytkownika <@${application.user_id}> zostalo przyjete.`,
      fields: result.warnings.length
        ? [{ name: '⚠️ Uwagi', value: result.warnings.map((warning) => `• ${warning}`).join('\n') }]
        : [],
      footer: 'Rola czlonka zostala nadana, powitanie wyslane.',
    });

    return reply.panel(interaction, container);
  },

  buildRejectModal,
  buildScheduleModal,
};
