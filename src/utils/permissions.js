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

/**
 * Oficer klanu: administrator, osoba z uprawnieniem Moderowanie czlonkami
 * lub Zarzadzanie wydarzeniami, albo posiadacz najwyzszego stopnia hierarchii
 * (gdy hierarchia ma co najmniej 2 stopnie). Jedna definicja dla wszystkich funkcji.
 */
function isOfficer(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  if (
    member.permissions?.has?.(PermissionFlagsBits.ModerateMembers) ||
    member.permissions?.has?.(PermissionFlagsBits.ManageEvents)
  ) {
    return true;
  }

  // Leniwie — utils nie powinny ladowac bazy przy samym imporcie.
  const hierarchy = require('../database/repositories/roles').list(member.guild.id);
  if (hierarchy.length < 2) return false;
  const top = hierarchy.reduce((best, entry) => (entry.level > best.level ? entry : best), hierarchy[0]);
  return member.roles?.cache?.has(top.role_id) ?? false;
}

/** Uprawnienia, ktorych nie wolno nadawac samoobslugowo (panele rol, rola urlopowa). */
const DANGEROUS_PERMISSIONS = [
  ['Administrator', PermissionFlagsBits.Administrator],
  ['Zarzadzanie serwerem', PermissionFlagsBits.ManageGuild],
  ['Zarzadzanie rolami', PermissionFlagsBits.ManageRoles],
  ['Banowanie', PermissionFlagsBits.BanMembers],
  ['Wyrzucanie', PermissionFlagsBits.KickMembers],
  ['Zarzadzanie kanalami', PermissionFlagsBits.ManageChannels],
  ['Wzmianka @everyone', PermissionFlagsBits.MentionEveryone],
];

/** Nazwy niebezpiecznych uprawnien, ktore ma rola. */
function dangerousPermissionsOf(role) {
  const permissions = role.permissions;
  if (!permissions?.has) return [];
  return DANGEROUS_PERMISSIONS.filter(([, flag]) => permissions.has(flag, false)).map(([name]) => name);
}

/**
 * Czy role mozna bezpiecznie rozdawac samoobslugowo: bot musi nia zarzadzac,
 * nie moze byc zarzadzana przez integracje ani dawac niebezpiecznych uprawnien.
 */
function checkSelfAssignableRole(guild, role) {
  if (!role) return { ok: false, reason: 'Ta rola juz nie istnieje.' };
  if (role.managed) {
    return { ok: false, reason: `Rola ${role} jest zarzadzana przez integracje i nie moze byc rozdawana.` };
  }

  const dangerous = dangerousPermissionsOf(role);
  if (dangerous.length > 0) {
    return {
      ok: false,
      reason: `Rola ${role} ma niebezpieczne uprawnienia (${dangerous.join(', ')}) — nie moze byc rozdawana automatycznie.`,
    };
  }

  return canManageRole(guild, role);
}

module.exports = {
  isOwner,
  isAdmin,
  isOfficer,
  canModerate,
  canManageRole,
  memberCanAssignRole,
  DANGEROUS_PERMISSIONS,
  dangerousPermissionsOf,
  checkSelfAssignableRole,
};
