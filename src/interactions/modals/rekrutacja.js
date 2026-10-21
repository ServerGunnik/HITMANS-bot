'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const recruitment = require('../../database/repositories/recruitment');
const recruitmentService = require('../../services/recruitment');
const logger = require('../../utils/logger');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply } = require('../../ui/components');
const { timestamp } = require('../../utils/format');

/** Obsluga wyslanego formularza rekrutacyjnego oraz modala odrzucenia. */
module.exports = {
  namespace: recruitmentService.NAMESPACE,

  async execute(interaction, { action, args }) {
    const { guild } = interaction;

    // Modal terminowania — moze byc uzyty i przez rekrutera (z panelu admina) i przez kandydata (z DMa).
    if (action === 'scheduleModal') {
      const applicationId = Number(args[0]);
      const application = recruitment.getApplication(applicationId);
      if (!application) return reply.error(interaction, 'Nie znalazlem tego zgloszenia.');

      const time = interaction.fields.getTextInputValue('time').trim();
      if (!time) return reply.error(interaction, 'Termin nie moze byc pusty.');

      const isReviewer = interaction.user.id !== application.user_id;
      const proposerRole = isReviewer ? 'reviewer' : 'applicant';

      // Weryfikacja uprawnien: kandydat moze proponowac tylko gdy jest oczekiwana odpowiedz od niego (lub rekruter zaproponowal juz cos).
      if (proposerRole === 'applicant') {
        if (application.schedule_state !== 'pending' || application.schedule_awaiting !== 'applicant') {
          return reply.error(interaction, 'Nie mozesz teraz proponowac terminu — czekamy na rekrutera.');
        }
      } else if (application.schedule_reviewer_id && application.schedule_reviewer_id !== interaction.user.id) {
        return reply.error(
          interaction,
          `Ten dialog prowadzi juz <@${application.schedule_reviewer_id}>.`,
        );
      }

      const scheduleGuild = interaction.client.guilds.cache.get(application.guild_id);
      if (!scheduleGuild) {
        return reply.error(interaction, 'Nie widze juz tego serwera.');
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await recruitmentService.proposeSchedule({
        guild: scheduleGuild,
        application,
        time,
        proposerRole,
        proposerId: interaction.user.id,
      });

      if (!result.ok) return reply.error(interaction, result.reason);

      const targetLabel =
        proposerRole === 'reviewer'
          ? `<@${result.application.user_id}> (kandydatowi)`
          : `<@${result.application.schedule_reviewer_id}> (rekruterowi)`;

      return reply.success(
        interaction,
        result.dmDelivered
          ? `Propozycja terminu **${time}** wyslana do ${targetLabel}.`
          : `Zapisano propozycje terminu **${time}**, ale nie moglem wyslac DM (${result.dmError ?? 'blad'}).`,
      );
    }

    if (action === 'apply') {
      // Ponowna walidacja — od otwarcia modala mogly zmienic sie ustawienia.
      const check = recruitmentService.canApply(interaction.member);
      if (!check.ok) return reply.error(interaction, check.reason);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const { application } = await recruitmentService.submitApplication(interaction);

        const container = panel({
          color: COLORS.success,
          title: '📨 Zgloszenie wyslane!',
          description:
            `Dziekujemy! Twoje zgloszenie **#${application.id}** trafilo do administracji serwera **${guild.name}**.\n\n` +
            '### 📋 Co dalej?\n' +
            '**1.** ✅ Formularz wypelniony\n' +
            '**2.** 🎙️ **Rekrutacja glosowa** — rekruter napisze do Ciebie w wiadomosci prywatnej z propozycja terminu rozmowy\n' +
            '**3.** ✅ Akceptacja lub odrzucenie po odbytej rozmowie',
          fields: [
            { name: 'Status', value: '🕓 Oczekuje na termin rekrutacji glosowej', inline: true },
            { name: 'Zlozone', value: timestamp(application.created_at, 'R'), inline: true },
          ],
          footer: 'Odpowiedz otrzymasz w wiadomosci prywatnej — upewnij sie, ze masz je wlaczone.',
        });

        return reply.panel(interaction, container);
      } catch (error) {
        logger.error('Nie udalo sie zapisac zgloszenia:', error);
        return reply.error(
          interaction,
          'Nie udalo sie wyslac zgloszenia — kanal administracyjny jest niedostepny. Powiadom administracje serwera.',
        );
      }
    }

    // rejectModal:<id> oraz reviewModal:<id>
    if (!isAdmin(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return reply.error(interaction, 'Tylko osoby z uprawnieniem **Zarzadzanie rolami** moga rozpatrywac zgloszenia.');
    }

    const applicationId = Number(args[0]);
    const application = recruitment.getApplication(applicationId);

    if (!application || application.guild_id !== guild.id) {
      return reply.error(interaction, 'Nie znalazlem tego zgloszenia w bazie danych.');
    }
    if (application.status !== 'pending') {
      return reply.error(interaction, 'To zgloszenie zostalo juz rozpatrzone.');
    }

    // ─── Ankieta oceny wypelniona przez rekrutera ───────────────────────
    if (action === 'reviewModal') {
      const questions = recruitment
        .listQuestions(guild.id, 'reviewer')
        .slice(0, recruitment.MAX_QUESTIONS);

      const answers = recruitmentService.readAnswers(interaction, questions);
      const existing = recruitment.getReview(application.id, interaction.user.id);

      recruitment.saveReview({
        guildId: guild.id,
        applicationId: application.id,
        reviewerId: interaction.user.id,
        reviewerTag: interaction.user.tag,
        answers,
      });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await recruitmentService.refreshApplicationMessage(guild, application);

      const filled = answers.filter((entry) => entry.answer);

      return reply.panel(
        interaction,
        panel({
          color: COLORS.success,
          title: existing ? '🧭 Ocena zaktualizowana' : '🧭 Ocena zapisana',
          description: `Twoja ocena zgloszenia **#${application.id}** jest widoczna dla administracji pod zgloszeniem.`,
          blocks: filled.length
            ? filled.map((entry) => `**${entry.question}**\n> ${entry.answer.replace(/\n/g, '\n> ')}`)
            : ['*Nie wypelniono zadnego pola.*'],
          footer: 'Ponowne kliniecie przycisku pozwala poprawic ocene.',
        }),
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let reason = '';
    try {
      reason = interaction.fields.getTextInputValue('reason').trim();
    } catch {
      reason = '';
    }

    const result = await recruitmentService.rejectApplication({
      guild,
      application,
      reviewer: interaction.user,
      reason,
    });

    const container = panel({
      color: COLORS.danger,
      title: '⛔ Zgloszenie odrzucone',
      description: `Zgloszenie **#${application.id}** uzytkownika <@${application.user_id}> zostalo odrzucone.`,
      fields: [
        { name: 'Powod', value: reason || 'Nie podano.' },
        ...(result.warnings.length
          ? [{ name: '⚠️ Uwagi', value: result.warnings.map((warning) => `• ${warning}`).join('\n') }]
          : []),
      ],
    });

    return reply.panel(interaction, container);
  },
};
