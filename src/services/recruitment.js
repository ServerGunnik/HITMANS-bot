'use strict';

const {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const guilds = require('../database/repositories/guilds');
const recruitment = require('../database/repositories/recruitment');
const logger = require('../utils/logger');
const modlog = require('../utils/modlog');
const { build: customId } = require('../utils/customId');
const { COLORS, V2_FLAGS, button, panel, row } = require('../ui/components');
const { humanDuration, timestamp, truncate } = require('../utils/format');

const NAMESPACE = 'rekrutacja';

const STATUS_META = {
  pending: { label: 'Oczekuje na decyzje', emoji: '🕓', color: COLORS.warning },
  accepted: { label: 'Zaakceptowane', emoji: '✅', color: COLORS.success },
  rejected: { label: 'Odrzucone', emoji: '⛔', color: COLORS.danger },
};

/** Publiczny panel rekrutacji z przyciskiem otwierajacym formularz. */
function buildRecruitmentPanel(guild, { title, description } = {}) {
  return panel({
    color: COLORS.clan,
    title: title || `🏰 Rekrutacja — ${guild.name}`,
    description:
      description ||
      'Chcesz dolaczyc do naszego klanu? Kliknij przycisk ponizej i wypelnij krotki formularz.\n\n' +
        '### 📋 Etapy rekrutacji\n' +
        '**1.** 📝 Formularz rekrutacyjny\n' +
        '**2.** 🎙️ **Rekrutacja glosowa** — rekruter umowi z Toba termin rozmowy\n' +
        '**3.** ✅ Decyzja koncowa\n\n' +
        '*Odpowiedz dostaniesz w wiadomosci prywatnej — upewnij sie, ze masz je wlaczone.*',
    rows: [
      row(
        button({
          id: customId(NAMESPACE, 'start'),
          label: 'Wypelnij formularz',
          emoji: '📝',
          style: 'success',
        }),
      ),
    ],
    footer: 'Formularz mozesz otworzyc takze komenda /rekrutacja',
  });
}

/**
 * Buduje modal z listy pytan.
 * Uzywany dla obu zestawow: formularza kandydata i ankiety rekrutera.
 */
function buildQuestionModal(questions, { modalCustomId, title, values = new Map() }) {
  if (questions.length === 0) return null;

  const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(truncate(title, 45));

  for (const question of questions) {
    const input = new TextInputBuilder()
      .setCustomId(`q_${question.id}`)
      .setStyle(question.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(Boolean(question.required));

    if (question.placeholder) input.setPlaceholder(truncate(question.placeholder, 100));
    if (question.min_length) input.setMinLength(question.min_length);
    if (question.max_length) input.setMaxLength(question.max_length);

    // Edycja wlasnej oceny startuje z poprzednio wpisanymi odpowiedziami.
    const previous = values.get(question.id);
    if (previous) input.setValue(truncate(previous, question.max_length ?? 4000));

    const label = new LabelBuilder()
      .setLabel(truncate(question.label, 45))
      .setTextInputComponent(input);
    if (question.description) label.setDescription(truncate(question.description, 100));

    modal.addLabelComponents(label);
  }

  return modal;
}

/** Formularz wypelniany przez kandydata (`/rekrutacja`). */
function buildApplicationModal(guild) {
  return buildQuestionModal(recruitment.listQuestions(guild.id, 'applicant').slice(0, recruitment.MAX_QUESTIONS), {
    modalCustomId: customId(NAMESPACE, 'apply'),
    title: `Rekrutacja — ${guild.name}`,
  });
}

/**
 * Ankieta oceny wypelniana przez rekrutera przy rozpatrywaniu zgloszenia.
 * Pola sa wypelniane wczesniejsza ocena tego rekrutera, jesli juz ja wystawil.
 */
function buildReviewModal(guild, application, previousReview = null) {
  const questions = recruitment.listQuestions(guild.id, 'reviewer').slice(0, recruitment.MAX_QUESTIONS);
  if (questions.length === 0) return null;

  // Poprzednie odpowiedzi dopasowujemy po tresci pytania — pytanie moglo
  // zostac w miedzyczasie usuniete i dodane ponownie z innym ID.
  const previousByLabel = new Map((previousReview?.answers ?? []).map((entry) => [entry.question, entry.answer]));
  const values = new Map(
    questions
      .filter((question) => previousByLabel.has(question.label))
      .map((question) => [question.id, previousByLabel.get(question.label)]),
  );

  return buildQuestionModal(questions, {
    modalCustomId: customId(NAMESPACE, 'reviewModal', application.id),
    title: `Ocena zgloszenia #${application.id}`,
    values,
  });
}

/** Odczytuje odpowiedzi z przeslanego modala wg listy pytan. */
function readAnswers(interaction, questions) {
  return questions.map((question) => {
    let answer = '';
    try {
      answer = interaction.fields.getTextInputValue(`q_${question.id}`);
    } catch {
      answer = '';
    }
    return { question: question.label, answer: answer.trim() };
  });
}

/**
 * Sprawdza, czy uzytkownik moze zlozyc zgloszenie.
 * Zwraca { ok: true } lub { ok: false, reason }.
 */
function canApply(member) {
  const settings = guilds.get(member.guild.id);

  if (!settings.recruitment_enabled) {
    return { ok: false, reason: 'Rekrutacja na tym serwerze jest obecnie **zamknieta**.' };
  }
  if (recruitment.countQuestions(member.guild.id, 'applicant') === 0) {
    return {
      ok: false,
      reason: 'Administracja nie skonfigurowala jeszcze pytan rekrutacyjnych (`/pytania panel`).',
    };
  }
  if (!settings.applications_channel_id) {
    return {
      ok: false,
      reason: 'Administracja nie ustawila kanalu zgloszen (`/konfiguracja kanal typ:zgloszenia`).',
    };
  }
  if (settings.member_role_id && member.roles.cache.has(settings.member_role_id)) {
    return { ok: false, reason: 'Jestes juz czlonkiem klanu — nie musisz skladac zgloszenia.' };
  }

  const pending = recruitment.getPendingApplication(member.guild.id, member.id);
  if (pending) {
    return {
      ok: false,
      reason: `Masz juz zgloszenie oczekujace na decyzje (#${pending.id}, zlozone ${timestamp(pending.created_at, 'R')}).`,
    };
  }

  const latest = recruitment.getLatestApplication(member.guild.id, member.id);
  const cooldownMs = (settings.recruitment_cooldown_h ?? 24) * 60 * 60 * 1000;
  if (latest?.status === 'rejected' && cooldownMs > 0 && latest.decided_at) {
    const elapsed = Date.now() - latest.decided_at;
    if (elapsed < cooldownMs) {
      return {
        ok: false,
        reason:
          'Twoje poprzednie zgloszenie zostalo odrzucone. ' +
          `Kolejne mozesz zlozyc za **${humanDuration(cooldownMs - elapsed)}**.`,
      };
    }
  }

  return { ok: true, settings };
}

/** Kontener ze zgloszeniem wysylany na kanal administracyjny. */
function buildApplicationCard(application, { user, guild, disabled = false, reviews = null } = {}) {
  const meta = STATUS_META[application.status] ?? STATUS_META.pending;
  const isPending = application.status === 'pending';

  const reviewList = reviews ?? recruitment.listReviews(application.id);
  const hasReviewQuestions = guild ? recruitment.countQuestions(guild.id, 'reviewer') > 0 : false;

  // Wiadomosc Components V2 ma limit 4000 znakow lacznie. Gdy sa juz oceny
  // rekruterow, oddajemy im czesc budzetu kosztem odpowiedzi kandydata.
  // Opis karty (etapy rekrutacji) zjada ~300 znakow w statusie pending.
  const totalBudget = 2300;
  const reviewBudget = reviewList.length > 0 ? Math.floor(totalBudget * 0.4) : 0;
  const answerBudget = Math.max(
    150,
    Math.floor((totalBudget - reviewBudget) / Math.max(application.answers.length, 1)),
  );

  const answerBlocks = application.answers.map(
    (entry, index) =>
      `**${index + 1}. ${truncate(entry.question, 120)}**\n> ` +
      `${truncate(entry.answer || '—', answerBudget).replace(/\n/g, '\n> ')}`,
  );

  // Oceny rekruterow — widoczne tylko na kanale administracyjnym.
  const reviewBlocks = [];
  if (reviewList.length > 0) {
    const perReview = Math.max(120, Math.floor(reviewBudget / reviewList.length));
    const perAnswer = Math.max(60, Math.floor(perReview / Math.max(reviewList[0].answers.length, 1)));

    reviewBlocks.push(`### 🧭 Oceny rekruterow (${reviewList.length})`);

    for (const review of reviewList) {
      const answers = review.answers
        .filter((entry) => entry.answer)
        .map((entry) => `> **${truncate(entry.question, 60)}:** ${truncate(entry.answer, perAnswer)}`)
        .join('\n');

      reviewBlocks.push(
        `<@${review.reviewer_id}> • ${timestamp(review.updated_at, 'R')}\n${answers || '> *bez odpowiedzi*'}`,
      );
    }
  }

  const fields = [
    { name: 'Kandydat', value: `<@${application.user_id}> \`${application.user_tag ?? application.user_id}\`` },
    { name: 'Konto utworzone', value: user ? timestamp(user.createdAt, 'R') : 'brak danych', inline: true },
    { name: 'Zlozone', value: timestamp(application.created_at, 'f'), inline: true },
    { name: 'Status', value: `${meta.emoji} ${meta.label}`, inline: true },
  ];

  if (!isPending && application.reviewer_id) {
    fields.push({ name: 'Decyzja', value: `<@${application.reviewer_id}> • ${timestamp(application.decided_at, 'R')}` });
  }
  if (application.reason) {
    fields.push({ name: 'Powod decyzji', value: truncate(application.reason, 500) });
  }

  // Status negocjacji terminu rekrutacji glosowej (widoczny juz w statusie pending).
  if ((application.status === 'pending' || application.status === 'accepted') && application.schedule_state) {
    if (application.schedule_state === 'agreed') {
      fields.push({
        name: '🗓️ Termin rekrutacji glosowej',
        value: `✅ **${truncate(application.schedule_time, 200)}** — uzgodniony ${timestamp(application.schedule_agreed_at, 'R')}`,
      });
    } else {
      const waitingFor =
        application.schedule_awaiting === 'applicant'
          ? `kandydat <@${application.user_id}>`
          : `rekruter <@${application.schedule_reviewer_id}>`;
      fields.push({
        name: '🗓️ Termin rekrutacji glosowej',
        value: `🕓 Propozycja: **${truncate(application.schedule_time, 200)}**\n> Czeka na odpowiedz: ${waitingFor}`,
      });
    }
  } else if (application.status === 'pending') {
    fields.push({
      name: '🗓️ Termin rekrutacji glosowej',
      value: '⚠️ Nieustalony — rekruter musi zaproponowac termin przed akceptacja.',
    });
  }

  const actionRows = [];
  if (isPending && !disabled) {
    const scheduleAgreed = application.schedule_state === 'agreed';

    // Etap 2: rekrutacja glosowa — przycisk widoczny dopoki termin nie jest uzgodniony.
    if (!scheduleAgreed) {
      actionRows.push(
        row(
          button({
            id: customId(NAMESPACE, 'schedule', application.id),
            label:
              application.schedule_state === 'pending'
                ? 'Zmien propozycje terminu'
                : '🎙️ Umow rekrutacje glosowa',
            emoji: '🗓️',
            style: application.schedule_state === 'pending' ? 'secondary' : 'primary',
          }),
        ),
      );
    }

    actionRows.push(
      row(
        button({
          id: customId(NAMESPACE, 'accept', application.id),
          label: scheduleAgreed ? 'Akceptuj' : 'Akceptuj (po rekrutacji glosowej)',
          emoji: '✅',
          style: 'success',
        }),
        button({
          id: customId(NAMESPACE, 'reject', application.id),
          label: 'Odrzuc',
          emoji: '⛔',
          style: 'danger',
        }),
        button({
          id: customId(NAMESPACE, 'profile', application.id),
          label: 'Profil kandydata',
          emoji: '👤',
          style: 'secondary',
        }),
      ),
    );

    // Ankieta rekrutera pojawia sie tylko wtedy, gdy ma jakies pytania.
    if (hasReviewQuestions) {
      actionRows.push(
        row(
          button({
            id: customId(NAMESPACE, 'review', application.id),
            label: reviewList.length > 0 ? `Wypelnij ocene (${reviewList.length})` : 'Wypelnij ocene',
            emoji: '🧭',
            style: 'primary',
          }),
        ),
      );
    }
  }

  const description = isPending
    ? `Nowe zgloszenie rekrutacyjne na serwer **${guild?.name ?? ''}**.\n\n` +
      '### 📋 Etapy rekrutacji\n' +
      '**1.** Formularz kandydata *(wypelniony)*\n' +
      '**2.** 🎙️ **Rekrutacja glosowa** — rekruter musi uzgodnic termin z kandydatem\n' +
      '**3.** ✅ Akceptacja *(mozliwa dopiero po odbytej rozmowie glosowej)*'
    : `Nowe zgloszenie rekrutacyjne na serwer **${guild?.name ?? ''}**.`;

  return panel({
    color: meta.color,
    title: `📨 Zgloszenie #${application.id}`,
    description,
    thumbnail: user ? { url: user.displayAvatarURL({ size: 256 }), description: 'Awatar kandydata' } : undefined,
    fields,
    blocks: [...answerBlocks, ...reviewBlocks],
    rows: actionRows,
    footer: `ID uzytkownika: ${application.user_id}`,
  });
}

/** Zapisuje zgloszenie i publikuje je na kanale administracyjnym. */
async function submitApplication(interaction) {
  const { guild, member, user } = interaction;
  const settings = guilds.get(guild.id);
  const questions = recruitment.listQuestions(guild.id, 'applicant').slice(0, recruitment.MAX_QUESTIONS);
  const answers = readAnswers(interaction, questions);

  const application = recruitment.createApplication({
    guildId: guild.id,
    userId: user.id,
    userTag: user.tag,
    answers,
  });

  const channel =
    guild.channels.cache.get(settings.applications_channel_id) ??
    (await guild.channels.fetch(settings.applications_channel_id).catch(() => null));

  if (!channel?.isTextBased()) {
    recruitment.decideApplication(application.id, {
      status: 'rejected',
      reviewerId: guild.client.user.id,
      reason: 'Kanal zgloszen jest niedostepny.',
    });
    throw new Error('Kanal zgloszen jest niedostepny lub bot nie ma do niego dostepu.');
  }

  const message = await channel.send({
    components: [buildApplicationCard(application, { user, guild })],
    flags: V2_FLAGS,
    allowedMentions: { parse: [] },
  });

  recruitment.attachMessage(application.id, channel.id, message.id);
  return { application, message, channel };
}

/** Odswieza wiadomosc ze zgloszeniem po podjeciu decyzji. */
async function refreshApplicationMessage(guild, application) {
  if (!application.channel_id || !application.message_id) return;

  const channel =
    guild.channels.cache.get(application.channel_id) ??
    (await guild.channels.fetch(application.channel_id).catch(() => null));
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(application.message_id).catch(() => null);
  if (!message) return;

  const user = await guild.client.users.fetch(application.user_id).catch(() => null);

  await message
    .edit({
      components: [buildApplicationCard(application, { user, guild, disabled: true })],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    })
    .catch((error) => logger.warn('Nie udalo sie zaktualizowac zgloszenia:', error.message));
}

/** Podmienia placeholdery w wiadomosci powitalnej. */
function renderWelcome(template, { member, guild }) {
  return String(template ?? guilds.DEFAULT_WELCOME)
    .replaceAll('{user}', member.toString())
    .replaceAll('{user.name}', member.user.username)
    .replaceAll('{user.id}', member.id)
    .replaceAll('{server}', guild.name)
    .replaceAll('{memberCount}', String(guild.memberCount));
}

/**
 * Akceptuje zgloszenie: nadaje role czlonka, zdejmuje role goscia,
 * wysyla powitanie i powiadamia kandydata.
 */
async function acceptApplication({ guild, application, reviewer }) {
  const settings = guilds.get(guild.id);
  const warnings = [];

  if (!settings.member_role_id) {
    return { ok: false, reason: 'Nie ustawiono roli czlonka — uzyj `/konfiguracja rola typ:czlonek`.' };
  }

  // Wymog etapu 2: rekrutacja glosowa musi byc uzgodniona przed akceptacja.
  if (application.schedule_state !== 'agreed') {
    return {
      ok: false,
      reason:
        'Przed akceptacja **musi odbyc sie rekrutacja glosowa**. ' +
        'Uzyj przycisku **🎙️ Umow rekrutacje glosowa** i uzgodnij termin z kandydatem.',
    };
  }

  // Opcjonalny wymog: rekruter musi najpierw wystawic wlasna ocene kandydata.
  if (settings.recruitment_review_required && recruitment.countQuestions(guild.id, 'reviewer') > 0) {
    if (!recruitment.getReview(application.id, reviewer.id)) {
      return {
        ok: false,
        reason:
          'Przed akceptacja wypelnij ankiete oceny kandydata — przycisk **🧭 Wypelnij ocene** pod zgloszeniem. ' +
          '(Wymog mozna wylaczyc: `/konfiguracja rekrutacja ocena_wymagana:false`)',
      };
    }
  }

  const memberRole = guild.roles.cache.get(settings.member_role_id);
  if (!memberRole) {
    return { ok: false, reason: 'Skonfigurowana rola czlonka juz nie istnieje — ustaw ja ponownie.' };
  }

  const member = await guild.members.fetch(application.user_id).catch(() => null);
  const updated = recruitment.decideApplication(application.id, {
    status: 'accepted',
    reviewerId: reviewer.id,
    reason: null,
  });

  if (member) {
    try {
      await member.roles.add(memberRole, `Zaakceptowane zgloszenie #${application.id} przez ${reviewer.tag}`);
    } catch (error) {
      warnings.push(`Nie udalo sie nadac roli ${memberRole}: ${error.message}`);
    }

    if (settings.guest_role_id && member.roles.cache.has(settings.guest_role_id)) {
      try {
        await member.roles.remove(settings.guest_role_id, `Awans po akceptacji zgloszenia #${application.id}`);
      } catch (error) {
        warnings.push(`Nie udalo sie odebrac roli goscia: ${error.message}`);
      }
    }

    if (settings.welcome_channel_id) {
      const channel =
        guild.channels.cache.get(settings.welcome_channel_id) ??
        (await guild.channels.fetch(settings.welcome_channel_id).catch(() => null));

      if (channel?.isTextBased()) {
        const welcome = panel({
          color: COLORS.success,
          title: '🎉 Nowy czlonek klanu!',
          description: renderWelcome(settings.welcome_message, { member, guild }),
          thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
          fields: [
            { name: 'Ranga', value: `${memberRole}`, inline: true },
            { name: 'Dolaczyl(a) na serwer', value: timestamp(member.joinedAt, 'R'), inline: true },
          ],
          footer: `Czlonkow na serwerze: ${guild.memberCount}`,
        });

        await channel
          .send({
            components: [welcome],
            flags: V2_FLAGS,
            allowedMentions: { users: [member.id] },
          })
          .catch((error) => warnings.push(`Nie udalo sie wyslac powitania: ${error.message}`));
      }
    }

    const dm = panel({
      color: COLORS.success,
      title: '✅ Zgloszenie zaakceptowane',
      description: `Twoje zgloszenie na serwerze **${guild.name}** zostalo zaakceptowane. Witamy w klanie!`,
      fields: [{ name: 'Nadana ranga', value: memberRole.name, inline: true }],
      footer: guild.name,
    });
    await member
      .send({ components: [dm], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch(() => warnings.push('Nie moglem wyslac wiadomosci prywatnej (kandydat ma je wylaczone).'));
  } else {
    warnings.push('Kandydat nie jest juz na serwerze — role nie zostaly nadane.');
  }

  await refreshApplicationMessage(guild, updated);

  const user = member?.user ?? (await guild.client.users.fetch(application.user_id).catch(() => null));
  if (user) {
    await modlog.logEvent(guild, {
      action: 'recruit_accept',
      user,
      moderator: reviewer,
      reason: `Zgloszenie #${application.id}`,
    });
  }

  return { ok: true, warnings, application: updated };
}

/** Odrzuca zgloszenie i powiadamia kandydata. */
async function rejectApplication({ guild, application, reviewer, reason }) {
  const warnings = [];
  const updated = recruitment.decideApplication(application.id, {
    status: 'rejected',
    reviewerId: reviewer.id,
    reason: reason || null,
  });

  const user = await guild.client.users.fetch(application.user_id).catch(() => null);
  if (user) {
    const settings = guilds.get(guild.id);
    const cooldown = settings.recruitment_cooldown_h;
    const dm = panel({
      color: COLORS.danger,
      title: '⛔ Zgloszenie odrzucone',
      description: `Twoje zgloszenie na serwerze **${guild.name}** zostalo odrzucone.`,
      fields: [
        { name: 'Powod', value: truncate(reason || 'Nie podano.', 900) },
        ...(cooldown > 0
          ? [{ name: 'Kolejne zgloszenie', value: `Mozesz sprobowac ponownie za ${cooldown} h.`, inline: true }]
          : []),
      ],
      footer: guild.name,
    });

    await user
      .send({ components: [dm], flags: V2_FLAGS, allowedMentions: { parse: [] } })
      .catch(() => warnings.push('Nie moglem wyslac wiadomosci prywatnej (kandydat ma je wylaczone).'));

    await modlog.logEvent(guild, {
      action: 'recruit_reject',
      user,
      moderator: reviewer,
      reason: reason || `Zgloszenie #${application.id}`,
    });
  }

  await refreshApplicationMessage(guild, updated);
  return { ok: true, warnings, application: updated };
}

// ─── Negocjacja terminu rekrutacji ─────────────────────────────────────────

function scheduleDMButtons(applicationId) {
  return row(
    button({
      id: customId(NAMESPACE, 'schedYes', applicationId),
      label: 'Zaakceptuj termin',
      emoji: '✅',
      style: 'success',
    }),
    button({
      id: customId(NAMESPACE, 'schedNo', applicationId),
      label: 'Odrzuc — zaproponuj inny',
      emoji: '❌',
      style: 'danger',
    }),
  );
}

function buildSchedulePendingDM({ application, guildName, forRole }) {
  const proposerMention =
    forRole === 'applicant'
      ? `<@${application.schedule_reviewer_id}> (rekruter)`
      : `<@${application.user_id}> (kandydat)`;

  return panel({
    color: COLORS.info,
    title: '🗓️ Propozycja terminu rekrutacji',
    description:
      `${proposerMention} zaproponowal(a) termin rekrutacji na serwerze **${guildName}**.\n\n` +
      `**Propozycja:** ${truncate(application.schedule_time, 500)}`,
    rows: [scheduleDMButtons(application.id)],
    footer: 'Kliknij aby zaakceptowac lub zaproponuj wlasny termin.',
  });
}

function buildScheduleAgreedDM({ application, guildName }) {
  return panel({
    color: COLORS.success,
    title: '✅ Termin rekrutacji uzgodniony',
    description:
      `Obydwie strony zaakceptowaly termin rekrutacji na serwerze **${guildName}**.\n\n` +
      `**Termin:** ${truncate(application.schedule_time, 500)}`,
    fields: [
      { name: 'Kandydat', value: `<@${application.user_id}>`, inline: true },
      { name: 'Rekruter', value: `<@${application.schedule_reviewer_id}>`, inline: true },
    ],
    footer: guildName,
  });
}

/** Wysyla DM z panelem i lapie brak DM permissions. */
async function sendScheduleDM(client, userId, container) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Rejestruje propozycje terminu. `proposer` to 'applicant' albo 'reviewer'.
 * Odbiorca DMa to zawsze druga strona.
 */
async function proposeSchedule({ guild, application, time, proposerRole, proposerId }) {
  if (application.status !== 'pending' && application.status !== 'accepted') {
    return { ok: false, reason: 'Termin mozna proponowac tylko dla otwartych zgloszen.' };
  }

  // Pierwsza propozycja od rekrutera „blokuje" ten dialog na niego.
  const reviewerLock =
    application.schedule_reviewer_id
      ? application.schedule_reviewer_id
      : proposerRole === 'reviewer'
        ? proposerId
        : null;

  if (!reviewerLock) {
    return { ok: false, reason: 'Najpierw rekruter musi zaproponowac pierwszy termin.' };
  }

  if (proposerRole === 'reviewer' && reviewerLock !== proposerId) {
    return {
      ok: false,
      reason: `Ten dialog prowadzi juz <@${reviewerLock}> — tylko on moze proponowac kolejne terminy.`,
    };
  }

  const awaiting = proposerRole === 'reviewer' ? 'applicant' : 'reviewer';
  const updated = recruitment.updateSchedule(application.id, {
    state: 'pending',
    time,
    awaiting,
    reviewerId: reviewerLock,
    agreedAt: null,
  });

  const targetId = awaiting === 'applicant' ? updated.user_id : reviewerLock;
  const dm = buildSchedulePendingDM({
    application: updated,
    guildName: guild.name,
    forRole: awaiting,
  });

  const dmResult = await sendScheduleDM(guild.client, targetId, dm);
  await refreshApplicationMessage(guild, updated);

  return { ok: true, application: updated, dmDelivered: dmResult.ok, dmError: dmResult.reason };
}

/** Uzgodnienie terminu: obydwie strony dostaja DM z potwierdzeniem. */
async function acceptSchedule({ guild, application }) {
  if (
    (application.status !== 'pending' && application.status !== 'accepted') ||
    application.schedule_state !== 'pending'
  ) {
    return { ok: false, reason: 'Brak aktywnej propozycji terminu do zaakceptowania.' };
  }

  const updated = recruitment.updateSchedule(application.id, {
    state: 'agreed',
    awaiting: null,
    agreedAt: Date.now(),
  });

  const dm = buildScheduleAgreedDM({ application: updated, guildName: guild.name });
  await sendScheduleDM(guild.client, updated.user_id, dm);
  if (updated.schedule_reviewer_id) {
    await sendScheduleDM(guild.client, updated.schedule_reviewer_id, dm);
  }

  await refreshApplicationMessage(guild, updated);
  return { ok: true, application: updated };
}

module.exports = {
  NAMESPACE,
  STATUS_META,
  buildRecruitmentPanel,
  buildQuestionModal,
  buildApplicationModal,
  buildReviewModal,
  readAnswers,
  buildApplicationCard,
  canApply,
  submitApplication,
  refreshApplicationMessage,
  acceptApplication,
  rejectApplication,
  proposeSchedule,
  acceptSchedule,
  renderWelcome,
};
