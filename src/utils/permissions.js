'use strict';

const { PermissionFlagsBits } = require('discord.js');

const { config } = require('../config');

function isOwner(userId) {
  return config.ownerIds.includes(userId);
}

/** Czy uzytkownik moze uzyc komendy administracyjnej. */
function isAdmin(member) {
  if (!member) return false;
  return (
    isOwner(member.id) ||
    member.id === member.guild?.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/**
 * Sprawdza hierarchie przed akcja moderacyjna.
 * Zwraca { ok: true } albo { ok: false, reason: '...' }.
 */
function canModerate(executor, target, { actionName = 'wykonac tej akcji' } = {}) {
  if (!target) return { ok: false, reason: 'Nie znalazlem tego uzytkownika na serwerze.' };
  if (executor.id === target.id) return { ok: false, reason: 'Nie mozesz uzyc tej komendy na sobie.' };

  const guild = executor.guild;
  if (target.id === guild.ownerId) {
    return { ok: false, reason: 'Nie mozesz moderowac wlasciciela serwera.' };
  }
  if (target.id === guild.members.me?.id) {
    return { ok: false, reason: 'Nie moge wykonac tej akcji na sobie.' };
  }

  if (executor.id !== guild.ownerId && !isOwner(executor.id)) {
    if (target.roles.highest.position >= executor.roles.highest.position) {
      return {
        ok: false,
        reason: `Nie mozesz ${actionName} osobie z rola rowna lub wyzsza od Twojej.`,
      };
    }
  }

  const me = guild.members.me;
  if (me && target.roles.highest.position >= me.roles.highest.position) {
    return {
      ok: false,
      reason: 'Moja rola jest nizej w hierarchii niz rola tej osoby — przesun role bota wyzej.',
    };
  }

  return { ok: true };
}

/** Czy bot moze nadac/odebrac wskazana role. */
function canManageRole(guild, role) {
  const me = guild.members.me;
  if (!me) return { ok: false, reason: 'Nie moge odczytac wlasnych uprawnien na tym serwerze.' };
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, reason: 'Brakuje mi uprawnienia **Zarzadzanie rolami**.' };
  }
  if (role.managed) {
    return { ok: false, reason: `Rola ${role} jest zarzadzana przez integracje i nie moge jej nadawac.` };
  }
  if (role.id === guild.roles.everyone.id) {
    return { ok: false, reason: 'Nie moge nadac roli @everyone.' };
  }
  if (role.position >= me.roles.highest.position) {
    return {
      ok: false,
      reason: `Rola ${role} jest wyzej w hierarchii niz moja rola — przesun role bota ponad nia.`,
    };
  }
  return { ok: true };
}

/** Czy uzytkownik moze operowac na danej roli (poza wlascicielem/adminem). */
function memberCanAssignRole(member, role) {
  if (member.id === member.guild.ownerId || isOwner(member.id)) return { ok: true };
  if (role.position >= member.roles.highest.position) {
    return { ok: false, reason: `Rola ${role} jest rowna lub wyzsza od Twojej najwyzszej roli.` };
  }
  return { ok: true };
}

module.exports = { isOwner, isAdmin, canModerate, canManageRole, memberCanAssignRole };
