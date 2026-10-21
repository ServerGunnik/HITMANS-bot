'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before, beforeEach } = require('node:test');

const database = require('../src/database');
const guilds = require('../src/database/repositories/guilds');
const recruitment = require('../src/database/repositories/recruitment');
const recruitmentService = require('../src/services/recruitment');
const questionsPanel = require('../src/services/questionsPanel');

const GUILD = 'guild-reviews';
const CANDIDATE = 'user-candidate';
const OFFICER = 'user-officer';
const OFFICER_2 = 'user-officer-2';

const guildMock = { id: GUILD, name: 'Klan Testowy', roles: { cache: new Map() } };

function createApplication() {
  return recruitment.createApplication({
    guildId: GUILD,
    userId: CANDIDATE,
    userTag: 'kandydat#1',
    answers: [{ question: 'Nick', answer: 'Raider' }],
  });
}

/** Symuluje uzgodniony termin rekrutacji glosowej — omija bramke etapu 2. */
function agreeSchedule(applicationId, reviewerId = OFFICER) {
  return recruitment.updateSchedule(applicationId, {
    state: 'agreed',
    time: 'sobota 20:00',
    awaiting: null,
    reviewerId,
    agreedAt: Date.now(),
  });
}

function audit(container) {
  const json = container.toJSON();
  let components = 0;
  let characters = 0;

  const walk = (node) => {
    components += 1;
    if (node.content) characters += node.content.length;
    if (node.accessory) walk(node.accessory);
    for (const child of node.components ?? []) walk(child);
  };

  walk(json);
  return { json, components, characters };
}

before(() => database.init());

beforeEach(() => {
  recruitment.clearQuestions(GUILD, 'applicant');
  recruitment.clearQuestions(GUILD, 'reviewer');
  guilds.update(GUILD, { recruitment_review_required: false, member_role_id: 'role-member' });
});

describe('dwa niezalezne zestawy pytan', () => {
  it('rozdziela pytania kandydata i rekrutera', () => {
    recruitment.addQuestion(GUILD, { label: 'Twoj nick' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');

    assert.equal(recruitment.countQuestions(GUILD, 'applicant'), 1);
    assert.equal(recruitment.countQuestions(GUILD, 'reviewer'), 1);
    assert.equal(recruitment.listQuestions(GUILD, 'applicant')[0].label, 'Twoj nick');
    assert.equal(recruitment.listQuestions(GUILD, 'reviewer')[0].label, 'Ocena (1-5)');
  });

  it('numeruje pozycje osobno w kazdym zestawie', () => {
    recruitment.addQuestion(GUILD, { label: 'K1' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'K2' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'R1' }, 'reviewer');

    assert.deepEqual(recruitment.listQuestions(GUILD, 'applicant').map((q) => q.position), [1, 2]);
    assert.deepEqual(recruitment.listQuestions(GUILD, 'reviewer').map((q) => q.position), [1]);
  });

  it('czysci tylko wskazany zestaw', () => {
    recruitment.addQuestion(GUILD, { label: 'K1' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'R1' }, 'reviewer');

    recruitment.clearQuestions(GUILD, 'reviewer');

    assert.equal(recruitment.countQuestions(GUILD, 'applicant'), 1);
    assert.equal(recruitment.countQuestions(GUILD, 'reviewer'), 0);
  });

  it('przenumerowuje po usunieciu tylko w swoim zestawie', () => {
    recruitment.addQuestion(GUILD, { label: 'K1' }, 'applicant');
    const k2 = recruitment.addQuestion(GUILD, { label: 'K2' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'K3' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'R1' }, 'reviewer');
    recruitment.addQuestion(GUILD, { label: 'R2' }, 'reviewer');

    recruitment.removeQuestion(GUILD, k2.id);

    assert.deepEqual(recruitment.listQuestions(GUILD, 'applicant').map((q) => q.position), [1, 2]);
    assert.deepEqual(recruitment.listQuestions(GUILD, 'reviewer').map((q) => q.position), [1, 2]);
  });

  it('przesuwa pytanie w obrebie wlasnego zestawu', () => {
    recruitment.addQuestion(GUILD, { label: 'R1' }, 'reviewer');
    recruitment.addQuestion(GUILD, { label: 'R2' }, 'reviewer');
    const r3 = recruitment.addQuestion(GUILD, { label: 'R3' }, 'reviewer');
    recruitment.addQuestion(GUILD, { label: 'K1' }, 'applicant');

    recruitment.moveQuestion(GUILD, r3.id, 1);

    assert.deepEqual(recruitment.listQuestions(GUILD, 'reviewer').map((q) => q.label), ['R3', 'R1', 'R2']);
    assert.deepEqual(recruitment.listQuestions(GUILD, 'applicant').map((q) => q.label), ['K1']);
  });

  it('wgrywa osobne zestawy domyslne', () => {
    const applicant = recruitment.seedDefaultQuestions(GUILD, 'applicant');
    const reviewer = recruitment.seedDefaultQuestions(GUILD, 'reviewer');

    assert.ok(applicant.length > 0);
    assert.ok(reviewer.length > 0);
    assert.ok(reviewer.some((question) => /ocena/i.test(question.label)), 'ankieta zawiera ocene');
    assert.equal(recruitment.countQuestions(GUILD, 'applicant'), applicant.length, 'zestaw kandydata nietkniety');
  });

  it('formularz kandydata nie zawiera pytan rekrutera', () => {
    recruitment.addQuestion(GUILD, { label: 'Twoj nick' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'Notatki rekrutera' }, 'reviewer');

    const modal = JSON.stringify(recruitmentService.buildApplicationModal(guildMock).toJSON());

    assert.match(modal, /Twoj nick/);
    assert.ok(!modal.includes('Notatki rekrutera'), 'pytanie rekrutera nie trafia do kandydata');
  });
});

describe('ankieta rekrutera', () => {
  it('buduje modal z pytan zestawu rekrutera', () => {
    recruitment.seedDefaultQuestions(GUILD, 'reviewer');
    const application = createApplication();

    const json = recruitmentService.buildReviewModal(guildMock, application).toJSON();

    assert.equal(json.custom_id, `rekrutacja:reviewModal:${application.id}`);
    assert.ok(json.components.length <= recruitment.MAX_QUESTIONS);
    assert.ok(json.components.every((component) => component.type === 18), 'komponenty Label');
  });

  it('nie buduje modala, gdy zestaw rekrutera jest pusty', () => {
    assert.equal(recruitmentService.buildReviewModal(guildMock, createApplication()), null);
  });

  it('wypelnia modal poprzednia ocena tego samego rekrutera', () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)', style: 'short' }, 'reviewer');
    const application = createApplication();

    recruitment.saveReview({
      guildId: GUILD,
      applicationId: application.id,
      reviewerId: OFFICER,
      reviewerTag: 'officer#1',
      answers: [{ question: 'Ocena (1-5)', answer: '4' }],
    });

    const previous = recruitment.getReview(application.id, OFFICER);
    const json = recruitmentService.buildReviewModal(guildMock, application, previous).toJSON();

    assert.equal(json.components[0].component.value, '4');
  });

  it('zapisuje jedna ocene na rekrutera i pozwala ja poprawic', () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)', style: 'short' }, 'reviewer');
    const application = createApplication();

    recruitment.saveReview({
      guildId: GUILD,
      applicationId: application.id,
      reviewerId: OFFICER,
      answers: [{ question: 'Ocena (1-5)', answer: '3' }],
    });
    recruitment.saveReview({
      guildId: GUILD,
      applicationId: application.id,
      reviewerId: OFFICER,
      answers: [{ question: 'Ocena (1-5)', answer: '5' }],
    });

    assert.equal(recruitment.countReviews(application.id), 1, 'poprawka nadpisuje ocene');
    assert.equal(recruitment.getReview(application.id, OFFICER).answers[0].answer, '5');
  });

  it('zbiera oceny wielu rekruterow', () => {
    const application = createApplication();

    recruitment.saveReview({ guildId: GUILD, applicationId: application.id, reviewerId: OFFICER, answers: [] });
    recruitment.saveReview({ guildId: GUILD, applicationId: application.id, reviewerId: OFFICER_2, answers: [] });

    assert.equal(recruitment.countReviews(application.id), 2);
    assert.deepEqual(
      recruitment.listReviews(application.id).map((review) => review.reviewer_id),
      [OFFICER, OFFICER_2],
    );
  });

  it('oceny nie przechodza miedzy zgloszeniami', () => {
    const first = createApplication();
    const second = createApplication();

    recruitment.saveReview({ guildId: GUILD, applicationId: first.id, reviewerId: OFFICER, answers: [] });

    assert.equal(recruitment.countReviews(second.id), 0);
  });
});

describe('karta zgloszenia z ocenami', () => {
  it('pokazuje przycisk oceny tylko gdy zestaw rekrutera ma pytania', () => {
    const application = createApplication();

    const without = JSON.stringify(audit(recruitmentService.buildApplicationCard(application, { guild: guildMock })).json);
    assert.ok(!without.includes('rekrutacja:review'), 'brak przycisku bez pytan');

    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');

    const withQuestions = JSON.stringify(
      audit(recruitmentService.buildApplicationCard(application, { guild: guildMock })).json,
    );
    assert.match(withQuestions, /rekrutacja:review:\d+/);
  });

  it('renderuje oceny rekruterow na karcie', () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');
    const application = createApplication();

    recruitment.saveReview({
      guildId: GUILD,
      applicationId: application.id,
      reviewerId: OFFICER,
      answers: [{ question: 'Ocena (1-5)', answer: 'solidne 4' }],
    });

    const text = JSON.stringify(audit(recruitmentService.buildApplicationCard(application, { guild: guildMock })).json);

    assert.match(text, /Oceny rekruterow/);
    assert.match(text, /solidne 4/);
    assert.match(text, new RegExp(OFFICER));
  });

  it('miesci sie w limitach Components V2 przy maksymalnej tresci', () => {
    recruitment.seedDefaultQuestions(GUILD, 'reviewer');

    const application = recruitment.createApplication({
      guildId: GUILD,
      userId: CANDIDATE,
      userTag: 'kandydat#1',
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `Pytanie ${index} `.repeat(20),
        answer: 'Bardzo dluga odpowiedz. '.repeat(200),
      })),
    });

    for (const reviewer of [OFFICER, OFFICER_2, 'user-officer-3']) {
      recruitment.saveReview({
        guildId: GUILD,
        applicationId: application.id,
        reviewerId: reviewer,
        answers: [
          { question: 'Ocena kandydata (1-5)', answer: '5'.repeat(200) },
          { question: 'Notatki rekrutera', answer: 'Notatka. '.repeat(100) },
        ],
      });
    }

    const { components, characters } = audit(
      recruitmentService.buildApplicationCard(application, { guild: guildMock }),
    );

    assert.ok(components <= 40, `${components} komponentow`);
    assert.ok(characters <= 4000, `${characters} znakow`);
  });
});

describe('wymog rekrutacji glosowej przed akceptacja', () => {
  it('blokuje akceptacje, gdy termin nie jest uzgodniony', async () => {
    const application = createApplication();

    const result = await recruitmentService.acceptApplication({
      guild: guildMock,
      application,
      reviewer: { id: OFFICER, tag: 'officer#1' },
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /rekrutacja glosowa/i);
    assert.equal(recruitment.getApplication(application.id).status, 'pending', 'zgloszenie nadal otwarte');
  });

  it('przepuszcza akceptacje po uzgodnieniu terminu', async () => {
    const application = createApplication();
    const withSchedule = agreeSchedule(application.id);

    const result = await recruitmentService.acceptApplication({
      guild: guildMock,
      application: withSchedule,
      reviewer: { id: OFFICER, tag: 'officer#1' },
    });

    // Rola czlonka nie istnieje w atrapie serwera — wazne, ze przeszlo dalej niz bramka etapu 2.
    assert.ok(!/rekrutacja glosowa/i.test(result.reason ?? ''), 'bramka etapu 2 przepuscila');
  });
});

describe('wymog oceny przed akceptacja', () => {
  it('blokuje akceptacje, gdy rekruter nie wypelnil ankiety', async () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');
    guilds.update(GUILD, { recruitment_review_required: true });

    const application = createApplication();
    const withSchedule = agreeSchedule(application.id);

    const result = await recruitmentService.acceptApplication({
      guild: guildMock,
      application: withSchedule,
      reviewer: { id: OFFICER, tag: 'officer#1' },
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /ankiete oceny/i);
    assert.equal(recruitment.getApplication(application.id).status, 'pending', 'zgloszenie nadal otwarte');
  });

  it('przepuszcza akceptacje po wypelnieniu ankiety', async () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');
    guilds.update(GUILD, { recruitment_review_required: true });

    const application = createApplication();
    recruitment.saveReview({
      guildId: GUILD,
      applicationId: application.id,
      reviewerId: OFFICER,
      answers: [{ question: 'Ocena (1-5)', answer: '5' }],
    });
    const withSchedule = agreeSchedule(application.id);

    const result = await recruitmentService.acceptApplication({
      guild: guildMock,
      application: withSchedule,
      reviewer: { id: OFFICER, tag: 'officer#1' },
    });

    // Rola czlonka nie istnieje w atrapie serwera — wazne, ze przeszlo dalej niz bramka oceny.
    assert.ok(!/ankiete oceny/i.test(result.reason ?? ''), 'bramka oceny przepuscila');
  });

  it('nie blokuje, gdy wymog jest wylaczony', async () => {
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');
    guilds.update(GUILD, { recruitment_review_required: false });

    const application = createApplication();
    const withSchedule = agreeSchedule(application.id);

    const result = await recruitmentService.acceptApplication({
      guild: guildMock,
      application: withSchedule,
      reviewer: { id: OFFICER, tag: 'officer#1' },
    });

    assert.ok(!/ankiete oceny/i.test(result.reason ?? ''));
  });
});

describe('panel pytan', () => {
  it('ma osobne widoki dla obu zestawow i przycisk przelaczania', () => {
    recruitment.addQuestion(GUILD, { label: 'Twoj nick' }, 'applicant');
    recruitment.addQuestion(GUILD, { label: 'Ocena (1-5)' }, 'reviewer');

    const applicantPanel = JSON.stringify(questionsPanel.build(guildMock, { audience: 'applicant' }).toJSON());
    assert.match(applicantPanel, /Pytania dla kandydata/);
    assert.match(applicantPanel, /Twoj nick/);
    assert.match(applicantPanel, /pytania:switch:reviewer/, 'przycisk przelaczenia na ankiete rekrutera');

    const reviewerPanel = JSON.stringify(questionsPanel.build(guildMock, { audience: 'reviewer' }).toJSON());
    assert.match(reviewerPanel, /Pytania dla rekrutera/);
    assert.match(reviewerPanel, /Ocena \(1-5\)/);
    assert.match(reviewerPanel, /pytania:switch:applicant/);
    assert.match(reviewerPanel, /tylko administracja/i, 'panel tlumaczy, kto widzi pytania');
  });

  it('customId przyciskow niesie zestaw', () => {
    const json = JSON.stringify(questionsPanel.build(guildMock, { audience: 'reviewer' }).toJSON());

    for (const action of ['add', 'edit', 'remove', 'preview', 'defaults']) {
      assert.match(json, new RegExp(`pytania:${action}:reviewer`), action);
    }
  });
});
