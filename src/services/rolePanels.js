'use strict';

const rolePanelsRepo = require('../database/repositories/rolePanels');
const { COLORS, V2_FLAGS, button, panel, row } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const {
  DANGEROUS_PERMISSIONS,
  canManageRole,
  checkSelfAssignableRole: checkRoleSafety,
  dangerousPermissionsOf,
} = require('../utils/permissions');
const { truncate } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'rolepanel';
/** 4 wiersze po 5 przyciskow — miesci sie w limicie 40 komponentow Components V2. */
const MAX_ROLES = 20;
const BUTTONS_PER_ROW = 5;

const MODE_LABELS = {
  multi: 'wielokrotny wybor',
  single: 'jedna rola z panelu',
};

/** Akceptuje emoji unicode albo wlasne emoji serwera (<:nazwa:id>). */
function isValidEmoji(value) {
  if (!value) return true;
  const trimmed = String(value).trim();
  if (/^<a?:\w{2,32}:\d{17,21}>$/.test(trimmed)) return true;
  return trimmed.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) && !/\s/.test(trimmed);
}

/** Kontener publicznego panelu z przyciskami rol. */
function buildPanel(guild, rolePanel) {
  const entries = rolePanel.entries.slice(0, MAX_ROLES);
  const buttons = entries.map((entry) =>
    button({
      id: customId(NAMESPACE, 'toggle', rolePanel.id, entry.role_id),
      label: truncate(entry.label, 80),
      emoji: entry.emoji || undefined,
      style: 'secondary',
      disabled: !guild.roles.cache.has(entry.role_id),
    }),
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) rows.push(row(buttons.slice(i, i + BUTTONS_PER_ROW)));

  return panel({
    color: COLORS.primary,
    title: `🎭 ${truncate(rolePanel.title, 200)}`,
    description: rolePanel.description ? truncate(rolePanel.description, 1500) : undefined,
    blocks: entries.length === 0 ? ['*Ten panel nie ma jeszcze zadnych rol.*'] : undefined,
    rows,
    footer:
      rolePanel.mode === 'single'
        ? 'Mozesz miec tylko jedna role z tego panelu. Kliknij ponownie, aby ja zdjac.'
        : 'Kliknij przycisk, aby dodac lub zdjac role.',
  });
}

/** Podsumowanie panelu dla administracji. */
function describePanel(guild, rolePanel) {
  const roles = rolePanel.entries
    .map((entry) => {
      const role = guild.roles.cache.get(entry.role_id);
      return `${entry.emoji ? `${entry.emoji} ` : ''}**${truncate(entry.label, 80)}** → ${role ? `${role}` : '⚠️ rola usunieta'}`;
    })
    .join('\n');

  const published = rolePanel.message_id
    ? `opublikowany na <#${rolePanel.channel_id}>`
    : 'nieopublikowany';

  return `**#${rolePanel.id} ${truncate(rolePanel.title, 100)}** — ${MODE_LABELS[rolePanel.mode]}, ${published}\n${roles || '*brak rol*'}`;
}

/** Odswieza opublikowana wiadomosc panelu (po zmianie rol lub trybu). */
async function refreshMessage(guild, rolePanel) {
  if (!rolePanel?.message_id) return false;
  try {
    const channel = guild.channels.cache.get(rolePanel.channel_id) ?? (await guild.channels.fetch(rolePanel.channel_id).catch(() => null));
    const message = await channel?.messages?.fetch(rolePanel.message_id).catch(() => null);
    if (!message) return false;
    await message.edit({ components: [buildPanel(guild, rolePanel)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.debug(`Nie udalo sie odswiezyc panelu rol #${rolePanel.id}:`, error.message);
    return false;
  }
}

/**
 * Przelacza role czlonka z panelu. W trybie "single" zdejmuje pozostale role panelu.
 * Zwraca { ok, action: 'added'|'removed', role, removed: [] } albo { ok: false, reason }.
 */
async function toggleRole(member, rolePanel, roleId) {
  const entry = rolePanel.entries.find((item) => item.role_id === roleId);
  if (!entry) return { ok: false, reason: 'Tej roli nie ma juz w panelu.' };

  const role = member.guild.roles.cache.get(roleId);
  const safety = checkRoleSafety(member.guild, role);
  if (!safety.ok) return safety;

  const reason = `Panel rol #${rolePanel.id}`;

  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(role, reason);
    return { ok: true, action: 'removed', role, removed: [] };
  }

  const removed = [];
  if (rolePanel.mode === 'single') {
    for (const other of rolePanel.entries) {
      if (other.role_id === roleId || !member.roles.cache.has(other.role_id)) continue;
      const otherRole = member.guild.roles.cache.get(other.role_id);
      if (!otherRole || !canManageRole(member.guild, otherRole).ok) continue;
      await member.roles.remove(otherRole, reason).then(() => removed.push(otherRole)).catch(() => {});
    }
  }

  await member.roles.add(role, reason);
  return { ok: true, action: 'added', role, removed };
}

module.exports = {
  NAMESPACE,
  MAX_ROLES,
  DANGEROUS_PERMISSIONS,
  MODE_LABELS,
  dangerousPermissionsOf,
  checkRoleSafety,
  isValidEmoji,
  buildPanel,
  describePanel,
  refreshMessage,
  toggleRole,
};
