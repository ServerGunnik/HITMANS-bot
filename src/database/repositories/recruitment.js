'use strict';

const { getDb } = require('../index');

/** Discord pozwala na maksymalnie 5 pol w jednym modalu. */
const MAX_QUESTIONS = 5;

/**
 * Formularz rekrutacyjny ma dwa niezalezne zestawy pytan:
 *  - `applicant` — widzi je kandydat skladajacy zgloszenie,
 *  - `reviewer`  — ankieta oceny wypelniana przez rekrutera przy rozpatrywaniu.
 * Kazdy zestaw ma wlasna numeracje pozycji i wlasny limit 5 pytan.
 */
const AUDIENCES = ['applicant', 'reviewer'];
const DEFAULT_AUDIENCE = 'applicant';

function normalizeAudience(audience) {
  return AUDIENCES.includes(audience) ? audience : DEFAULT_AUDIENCE;
}

// ─── Pytania ────────────────────────────────────────────────────────────────

function listQuestions(guildId, audience = DEFAULT_AUDIENCE) {
  return getDb()
    .prepare(
      `SELECT * FROM recruitment_questions
       WHERE guild_id = ? AND audience = ?
       ORDER BY position ASC, id ASC`,
    )
    .all(guildId, normalizeAudience(audience))
    .map((row) => ({ ...row, required: Boolean(row.required) }));
}

function getQuestion(guildId, questionId) {
  const row = getDb()
    .prepare('SELECT * FROM recruitment_questions WHERE guild_id = ? AND id = ?')
    .get(guildId, questionId);
  return row ? { ...row, required: Boolean(row.required) } : null;
}

function countQuestions(guildId, audience = DEFAULT_AUDIENCE) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM recruitment_questions WHERE guild_id = ? AND audience = ?')
    .get(guildId, normalizeAudience(audience)).count;
}

function addQuestion(guildId, question, audience = DEFAULT_AUDIENCE) {
  const target = normalizeAudience(question.audience ?? audience);

  const position =
    getDb()
      .prepare(
        'SELECT COALESCE(MAX(position), 0) AS max FROM recruitment_questions WHERE guild_id = ? AND audience = ?',
      )
      .get(guildId, target).max + 1;

  const info = getDb()
    .prepare(
      `INSERT INTO recruitment_questions
         (guild_id, audience, position, label, description, placeholder, style, required, min_length, max_length, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guildId,
      target,
      position,
      question.label,
      question.description ?? null,
      question.placeholder ?? null,
      question.style ?? 'paragraph',
      question.required === false ? 0 : 1,
      question.minLength ?? null,
      question.maxLength ?? null,
      Date.now(),
    );

  return getQuestion(guildId, Number(info.lastInsertRowid));
}

function updateQuestion(guildId, questionId, patch) {
  const allowed = {
    label: 'label',
    description: 'description',
    placeholder: 'placeholder',
    style: 'style',
    required: 'required',
    minLength: 'min_length',
    maxLength: 'max_length',
  };

  const entries = Object.entries(patch).filter(([key]) => key in allowed && patch[key] !== undefined);
  if (entries.length === 0) return getQuestion(guildId, questionId);

  const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
  const values = entries.map(([key, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));

  getDb()
    .prepare(`UPDATE recruitment_questions SET ${assignments} WHERE guild_id = ? AND id = ?`)
    .run(...values, guildId, questionId);

  return getQuestion(guildId, questionId);
}

/** Usuwa pytanie i wypelnia luke w numeracji pozycji. */
function removeQuestion(guildId, questionId) {
  const db = getDb();
  const removed = db.transaction(() => {
    const question = getQuestion(guildId, questionId);
    if (!question) return null;
    db.prepare('DELETE FROM recruitment_questions WHERE guild_id = ? AND id = ?').run(guildId, questionId);
    db.prepare(
      `UPDATE recruitment_questions SET position = position - 1
       WHERE guild_id = ? AND audience = ? AND position > ?`,
    ).run(guildId, question.audience, question.position);
    return question;
  })();
  return removed;
}

/** Przenosi pytanie na wskazana pozycje (1 = pierwsze). */
function moveQuestion(guildId, questionId, newPosition) {
  const db = getDb();
  return db.transaction(() => {
    const moved = getQuestion(guildId, questionId);
    if (!moved) return null;

    const questions = listQuestions(guildId, moved.audience);
    const index = questions.findIndex((q) => q.id === questionId);
    if (index === -1) return null;

    const targetPosition = Math.min(Math.max(newPosition, 1), questions.length);
    const [entry] = questions.splice(index, 1);
    questions.splice(targetPosition - 1, 0, entry);

    const stmt = db.prepare('UPDATE recruitment_questions SET position = ? WHERE guild_id = ? AND id = ?');
    questions.forEach((question, i) => stmt.run(i + 1, guildId, question.id));
    return listQuestions(guildId, moved.audience);
  })();
}

function clearQuestions(guildId, audience = DEFAULT_AUDIENCE) {
  return getDb()
    .prepare('DELETE FROM recruitment_questions WHERE guild_id = ? AND audience = ?')
    .run(guildId, normalizeAudience(audience)).changes;
}

/** Wgrywa domyslny zestaw pytan (uzywane przez /setup i /pytania domyslne). */
function seedDefaultQuestions(guildId, audience = DEFAULT_AUDIENCE) {
  const applicantDefaults = [
    {
      label: 'Twoj nick w grze',
      description: 'Dokladnie tak, jak wyswietla sie w grze.',
      placeholder: 'np. NightRaider',
      style: 'short',
      maxLength: 64,
    },
    {
      label: 'Wiek',
      placeholder: 'np. 21',
      style: 'short',
      maxLength: 3,
    },
    {
      label: 'Doswiadczenie w grze',
      description: 'Jak dlugo grasz i co udalo Ci sie osiagnac?',
      placeholder: 'Opisz krotko swoje doswiadczenie...',
      style: 'paragraph',
      maxLength: 1000,
    },
    {
      label: 'Dlaczego chcesz dolaczyc?',
      description: 'Powiedz nam, czego szukasz w klanie.',
      placeholder: 'Szukam ekipy do...',
      style: 'paragraph',
      maxLength: 1000,
    },
    {
      label: 'Dostepnosc / godziny gry',
      description: 'Kiedy zwykle grasz?',
      placeholder: 'np. wieczory w tygodniu, weekendy caly dzien',
      style: 'short',
      required: false,
      maxLength: 200,
    },
  ];

  const reviewerDefaults = [
    {
      label: 'Ocena kandydata (1-5)',
      description: 'Ogolne wrazenie po rozmowie i zgloszeniu.',
      placeholder: 'np. 4',
      style: 'short',
      maxLength: 10,
    },
    {
      label: 'Czy pasuje do klanu?',
      description: 'Krotko: tak / nie / do przemyslenia + dlaczego.',
      placeholder: 'np. tak — ogarniety, gra w naszych godzinach',
      style: 'short',
      maxLength: 200,
    },
    {
      label: 'Skad go znamy / kto poleca?',
      placeholder: 'np. polecony przez @Nick, gral z nami na eventach',
      style: 'short',
      required: false,
      maxLength: 200,
    },
    {
      label: 'Notatki rekrutera',
      description: 'Uwagi widoczne tylko dla administracji.',
      placeholder: 'Co warto wiedziec przed decyzja...',
      style: 'paragraph',
      required: false,
      maxLength: 1000,
    },
  ];

  const target = normalizeAudience(audience);
  const defaults = target === 'reviewer' ? reviewerDefaults : applicantDefaults;

  const db = getDb();
  return db.transaction(() => {
    clearQuestions(guildId, target);
    return defaults.map((question) => addQuestion(guildId, question, target));
  })();
}

// ─── Zgloszenia ─────────────────────────────────────────────────────────────

function hydrateApplication(row) {
  if (!row) return null;
  let answers = [];
  try {
    answers = JSON.parse(row.answers);
  } catch {
    answers = [];
  }
  return { ...row, answers };
}

function createApplication({ guildId, userId, userTag, answers }) {
  const info = getDb()
    .prepare(
      `INSERT INTO applications (guild_id, user_id, user_tag, status, answers, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(guildId, userId, userTag ?? null, JSON.stringify(answers), Date.now());

  return getApplication(Number(info.lastInsertRowid));
}

function getApplication(id) {
  return hydrateApplication(getDb().prepare('SELECT * FROM applications WHERE id = ?').get(id));
}

function getPendingApplication(guildId, userId) {
  return hydrateApplication(
    getDb()
      .prepare(
        `SELECT * FROM applications
         WHERE guild_id = ? AND user_id = ? AND status = 'pending'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(guildId, userId),
  );
}

function getLatestApplication(guildId, userId) {
  return hydrateApplication(
    getDb()
      .prepare('SELECT * FROM applications WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1')
      .get(guildId, userId),
  );
}

function attachMessage(id, channelId, messageId) {
  getDb()
    .prepare('UPDATE applications SET channel_id = ?, message_id = ? WHERE id = ?')
    .run(channelId, messageId, id);
}

function decideApplication(id, { status, reviewerId, reason }) {
  getDb()
    .prepare('UPDATE applications SET status = ?, reviewer_id = ?, reason = ?, decided_at = ? WHERE id = ?')
    .run(status, reviewerId, reason ?? null, Date.now(), id);
  return getApplication(id);
}

function updateSchedule(id, patch) {
  const allowed = {
    state: 'schedule_state',
    time: 'schedule_time',
    awaiting: 'schedule_awaiting',
    reviewerId: 'schedule_reviewer_id',
    agreedAt: 'schedule_agreed_at',
  };
  const entries = Object.entries(patch).filter(([key]) => key in allowed);
  if (entries.length === 0) return getApplication(id);

  const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
  const values = entries.map(([, value]) => value ?? null);

  getDb().prepare(`UPDATE applications SET ${assignments} WHERE id = ?`).run(...values, id);
  return getApplication(id);
}

function countByStatus(guildId) {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS count FROM applications WHERE guild_id = ? GROUP BY status')
    .all(guildId);

  const counts = { pending: 0, accepted: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

// ─── Oceny rekruterow ───────────────────────────────────────────────────────

function hydrateReview(row) {
  if (!row) return null;
  let answers = [];
  try {
    answers = JSON.parse(row.answers);
  } catch {
    answers = [];
  }
  return { ...row, answers };
}

/**
 * Zapisuje ocene kandydata. Kazdy rekruter ma jedna ocene na zgloszenie —
 * ponowne wypelnienie ankiety nadpisuje poprzednia odpowiedz.
 */
function saveReview({ guildId, applicationId, reviewerId, reviewerTag, answers }) {
  const now = Date.now();

  getDb()
    .prepare(
      `INSERT INTO application_reviews
         (guild_id, application_id, reviewer_id, reviewer_tag, answers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(application_id, reviewer_id)
       DO UPDATE SET answers = excluded.answers, reviewer_tag = excluded.reviewer_tag, updated_at = excluded.updated_at`,
    )
    .run(guildId, applicationId, reviewerId, reviewerTag ?? null, JSON.stringify(answers), now, now);

  return getReview(applicationId, reviewerId);
}

function getReview(applicationId, reviewerId) {
  return hydrateReview(
    getDb()
      .prepare('SELECT * FROM application_reviews WHERE application_id = ? AND reviewer_id = ?')
      .get(applicationId, reviewerId),
  );
}

function listReviews(applicationId) {
  return getDb()
    .prepare('SELECT * FROM application_reviews WHERE application_id = ? ORDER BY id ASC')
    .all(applicationId)
    .map(hydrateReview);
}

function countReviews(applicationId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM application_reviews WHERE application_id = ?')
    .get(applicationId).count;
}

module.exports = {
  MAX_QUESTIONS,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  normalizeAudience,
  listQuestions,
  getQuestion,
  countQuestions,
  addQuestion,
  updateQuestion,
  removeQuestion,
  moveQuestion,
  clearQuestions,
  seedDefaultQuestions,
  createApplication,
  getApplication,
  getPendingApplication,
  getLatestApplication,
  attachMessage,
  decideApplication,
  updateSchedule,
  countByStatus,
  saveReview,
  getReview,
  listReviews,
  countReviews,
};
