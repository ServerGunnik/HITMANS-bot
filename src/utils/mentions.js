'use strict';

/**
 * Wyciaga identyfikatory uzytkownikow z tekstu z wzmiankami,
 * np. "<@123> <@!456> 789" -> ['123', '456', '789'] (bez duplikatow).
 */
function parseUserIds(text) {
  const ids = [];
  for (const match of String(text ?? '').matchAll(/<@!?(\d{15,21})>|\b(\d{15,21})\b/g)) {
    const id = match[1] ?? match[2];
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Lista wzmianek z limitem — reszta jako "+N". */
function mentionList(ids, limit = 25, empty = '*brak*') {
  if (!ids || ids.length === 0) return empty;
  const shown = ids.slice(0, limit).map((id) => `<@${id}>`).join(', ');
  return ids.length > limit ? `${shown} … +${ids.length - limit}` : shown;
}

module.exports = { parseUserIds, mentionList };
