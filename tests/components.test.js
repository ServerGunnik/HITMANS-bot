'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');

const database = require('../src/database');
const recruitment = require('../src/database/repositories/recruitment');
const recruitmentService = require('../src/services/recruitment');
const questionsPanel = require('../src/services/questionsPanel');
const { panel, row, button } = require('../src/ui/components');

const GUILD = 'guild-ui';
const guildMock = { id: GUILD, name: 'Klan Testowy', roles: { cache: new Map() } };

/** Limity Discorda dla wiadomosci Components V2. */
const MAX_COMPONENTS = 40;
const MAX_CHARACTERS = 4000;

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

/** Znajduje przycisk po custom_id w dowolnym miejscu drzewa komponentow. */
function findButton(node, customId) {
  if (node.type === 2 && node.custom_id === customId) return node;
  if (node.accessory) {
    const found = findButton(node.accessory, customId);
    if (found) return found;
  }
  for (const child of node.components ?? []) {
    const found = findButton(child, customId);
    if (found) return found;
  }
  return null;
}

before(() => {
  database.init();
  recruitment.seedDefaultQuestions(GUILD);
});

describe('builder kontenerow', () => {
  it('buduje kontener Components V2 zamiast klasycznego embeda', () => {
    const { json } = audit(
      panel({
        title: 'Tytul',
        description: 'Opis',
        fields: [{ name: 'Pole', value: 'wartosc', inline: true }],
        rows: [row(button({ id: 'x', label: 'Klik' }))],
        footer: 'stopka',
      }),
    );

    assert.equal(json.type, 17, 'typ 17 = Container');
    const types = json.components.map((component) => component.type);
    assert.ok(types.includes(10), 'zawiera TextDisplay (10)');
    assert.ok(types.includes(14), 'zawiera Separator (14)');
    assert.ok(types.includes(1), 'zawiera ActionRow (1)');
    assert.ok(!('embeds' in json) && !('content' in json));
  });

  it('pomija puste pola', () => {
    const { json } = audit(panel({ title: 'T', fields: [{ name: 'Puste', value: '' }, { name: 'Ok', value: '1' }] }));
    const text = JSON.stringify(json);
    assert.ok(!text.includes('Puste'));
    assert.ok(text.includes('Ok'));
  });

  it('tworzy Section z przyciskiem jako akcesorium', () => {
    const { json } = audit(
      panel({ sections: [{ content: 'tresc', button: button({ id: 'b', label: 'Akcja' }) }] }),
    );
    const section = json.components.find((component) => component.type === 9);
    assert.ok(section, 'Section (9) obecny');
    assert.equal(section.accessory.type, 2, 'akcesorium to przycisk');
  });
});

describe('panele rekrutacji', () => {
  it('panel publiczny miesci sie w limitach', () => {
    const { json, components, characters } = audit(recruitmentService.buildRecruitmentPanel(guildMock));
    assert.equal(json.type, 17);
    assert.ok(components <= MAX_COMPONENTS);
    assert.ok(characters <= MAX_CHARACTERS);
  });

  it('karta zgloszenia z maksymalnie dlugimi odpowiedziami miesci sie w limicie 4000 znakow', () => {
    const application = recruitment.createApplication({
      guildId: GUILD,
      userId: 'kandydat',
      userTag: 'kandydat#1',
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `Pytanie numer ${index} `.repeat(20),
        answer: 'Bardzo dluga odpowiedz. '.repeat(200),
      })),
    });

    const { components, characters } = audit(
      recruitmentService.buildApplicationCard(application, { guild: guildMock }),
    );

    assert.ok(components <= MAX_COMPONENTS, `${components} komponentow`);
    assert.ok(characters <= MAX_CHARACTERS, `${characters} znakow`);
  });

  it('karta oczekujacego zgloszenia ma przyciski decyzji, a rozpatrzonego juz nie', () => {
    const application = recruitment.createApplication({
      guildId: GUILD,
      userId: 'kandydat-2',
      userTag: 'kandydat2#1',
      answers: [{ question: 'Nick', answer: 'Raider' }],
    });

    const pending = audit(recruitmentService.buildApplicationCard(application, { guild: guildMock })).json;
    const buttons = JSON.stringify(pending).match(/"custom_id":"rekrutacja:[a-z]+:\d+"/g) ?? [];
    assert.equal(buttons.length, 3, 'Akceptuj / Odrzuc / Profil');

    const decided = recruitment.decideApplication(application.id, { status: 'accepted', reviewerId: 'admin' });
    const closed = audit(recruitmentService.buildApplicationCard(decided, { guild: guildMock })).json;
    assert.ok(!JSON.stringify(closed).includes('rekrutacja:accept'), 'brak przyciskow po decyzji');
  });

  it('podmienia placeholdery w wiadomosci powitalnej', () => {
    const rendered = recruitmentService.renderWelcome('Hej {user}, witaj na {server}! Jest nas {memberCount}.', {
      member: { toString: () => '<@1>', user: { username: 'Gracz' }, id: '1' },
      guild: { name: 'Klan Testowy', memberCount: 42 },
    });

    assert.equal(rendered, 'Hej <@1>, witaj na Klan Testowy! Jest nas 42.');
  });
});

describe('modale', () => {
  it('formularz rekrutacyjny uzywa komponentow Label i nie przekracza 5 pol', () => {
    const json = recruitmentService.buildApplicationModal(guildMock).toJSON();

    assert.ok(json.components.length <= 5, 'limit 5 pol w modalu');
    assert.equal(json.components.length, recruitment.listQuestions(GUILD).length);
    assert.ok(json.components.every((component) => component.type === 18), 'wszystkie pola to Label (18)');
    assert.ok(json.components.every((component) => component.label.length <= 45), 'etykiety do 45 znakow');
    assert.equal(json.custom_id, 'rekrutacja:apply');
  });

  it('modal edycji pytania jest wypelniony istniejacymi danymi', () => {
    const [question] = recruitment.listQuestions(GUILD);
    const json = questionsPanel.buildQuestionModal(question).toJSON();

    assert.equal(json.custom_id, `pytania:save:applicant:${question.id}`);
    const labelField = json.components.find((component) => component.component.custom_id === 'label');
    assert.equal(labelField.component.value, question.label);
  });

  it('modal nowego pytania nie ma identyfikatora pytania', () => {
    assert.equal(questionsPanel.buildQuestionModal().toJSON().custom_id, 'pytania:save:applicant');
  });
});

describe('panel pytan', () => {
  it('blokuje dodawanie po osiagnieciu limitu pytan', () => {
    const json = questionsPanel.build(guildMock).toJSON();

    assert.equal(recruitment.countQuestions(GUILD), recruitment.MAX_QUESTIONS);
    assert.equal(findButton(json, 'pytania:add:applicant').disabled, true, 'przycisk dodawania wylaczony');
    assert.notEqual(findButton(json, 'pytania:remove:applicant').disabled, true, 'usuwanie nadal dostepne');
  });

  it('wersja nieinteraktywna nie zawiera przyciskow', () => {
    const json = questionsPanel.build(guildMock, { interactive: false }).toJSON();
    assert.ok(!JSON.stringify(json).includes('pytania:add'), 'brak przyciskow w wersji tylko do odczytu');
  });
});
