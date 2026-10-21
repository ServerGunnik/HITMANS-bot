'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const security = require('../services/security');
const { COLORS } = require('../ui/components');
const { truncate } = require('../utils/format');

/** Logi rol serwera: tworzenie, usuwanie i edycja (nazwa, kolor, uprawnienia). */
module.exports = [
  {
    name: Events.GuildRoleCreate,
    async execute(role) {
      const executor = await serverLogs.findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);

      await serverLogs.send(role.guild, 'roles', {
        title: 'Rola utworzona',
        color: COLORS.success,
        fields: [{ name: 'Rola', value: `${role} \`${role.name}\`` }, ...serverLogs.executorField(executor)],
        footer: `ID: ${role.id}`,
      });
    },
  },
  {
    name: Events.GuildRoleDelete,
    async execute(role) {
      const executor = await serverLogs.findExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

      if (executor) {
        await security.recordNukeAction(role.guild, executor, 'role_delete').catch(() => {});
      }

      await serverLogs.send(role.guild, 'roles', {
        title: 'Rola usunieta',
        color: COLORS.danger,
        fields: [
          { name: 'Rola', value: `\`${role.name}\`` },
          { name: 'Mialo ja', value: `${role.members.size} osob`, inline: true },
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${role.id}`,
      });
    },
  },
  {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
      const changes = [];
      if (oldRole.name !== newRole.name) changes.push(`Nazwa: \`${oldRole.name}\` → \`${newRole.name}\``);
      if (oldRole.hexColor !== newRole.hexColor) changes.push(`Kolor: ${oldRole.hexColor} → ${newRole.hexColor}`);
      if (oldRole.hoist !== newRole.hoist) changes.push(`Wyswietlanie osobno: ${oldRole.hoist ? 'tak' : 'nie'} → ${newRole.hoist ? 'tak' : 'nie'}`);
      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Oznaczalna: ${oldRole.mentionable ? 'tak' : 'nie'} → ${newRole.mentionable ? 'tak' : 'nie'}`);
      }

      const oldPermissions = oldRole.permissions.toArray();
      const newPermissions = newRole.permissions.toArray();
      const grantedPermissions = newPermissions.filter((permission) => !oldPermissions.includes(permission));
      const revokedPermissions = oldPermissions.filter((permission) => !newPermissions.includes(permission));

      if (grantedPermissions.length) changes.push(`➕ Uprawnienia: ${grantedPermissions.join(', ')}`);
      if (revokedPermissions.length) changes.push(`➖ Uprawnienia: ${revokedPermissions.join(', ')}`);

      if (changes.length === 0) return;

      const executor = await serverLogs.findExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

      await serverLogs.send(newRole.guild, 'roles', {
        title: 'Rola zmieniona',
        color: COLORS.info,
        fields: [
          { name: 'Rola', value: `${newRole} \`${newRole.name}\`` },
          { name: 'Zmiany', value: truncate(changes.map((change) => `• ${change}`).join('\n'), 1200) },
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${newRole.id}`,
      });
    },
  },
];
