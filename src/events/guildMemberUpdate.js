'use strict';

const { AuditLogEvent, Events } = require('discord.js');

const serverLogs = require('../services/serverLogs');
const { COLORS } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');

/** Log zmian profilu czlonka: role, pseudonim, wyciszenie. */
module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const guild = newMember.guild;
    if (serverLogs.isIgnored(guild, { userId: newMember.id })) return;

    // ─── Role ───────────────────────────────────────────────────────────
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));

    if (added.size > 0 || removed.size > 0) {
      const executor = await serverLogs.findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);

      await serverLogs.send(guild, 'roles', {
        title: 'Zmiana rol czlonka',
        color: added.size > 0 ? COLORS.success : COLORS.warning,
        fields: [
          { name: 'Czlonek', value: serverLogs.describeUser(newMember.user) },
          ...(added.size > 0 ? [{ name: '➕ Nadane', value: truncate(added.map(String).join(' '), 900) }] : []),
          ...(removed.size > 0 ? [{ name: '➖ Odebrane', value: truncate(removed.map(String).join(' '), 900) }] : []),
          ...serverLogs.executorField(executor),
        ],
        footer: `ID: ${newMember.id}`,
      });
    }

    // ─── Pseudonim ──────────────────────────────────────────────────────
    if (oldMember.nickname !== newMember.nickname) {
      await serverLogs.send(guild, 'members', {
        title: 'Zmiana pseudonimu',
        color: COLORS.info,
        fields: [
          { name: 'Czlonek', value: serverLogs.describeUser(newMember.user) },
          { name: 'Przed', value: oldMember.nickname ?? '*brak*', inline: true },
          { name: 'Po', value: newMember.nickname ?? '*brak*', inline: true },
        ],
        footer: `ID: ${newMember.id}`,
      });
    }

    // ─── Wyciszenie (timeout) ───────────────────────────────────────────
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;

    if (oldTimeout !== newTimeout && !serverLogs.consumeBotAction(guild.id, newMember.id, 'timeout')) {
      const active = newTimeout && newTimeout > Date.now();

      await serverLogs.send(guild, 'members', {
        title: active ? 'Czlonek wyciszony' : 'Wyciszenie zdjete',
        color: active ? COLORS.warning : COLORS.success,
        fields: [
          { name: 'Czlonek', value: serverLogs.describeUser(newMember.user) },
          ...(active ? [{ name: 'Do', value: timestamp(newTimeout, 'f'), inline: true }] : []),
        ],
        footer: `ID: ${newMember.id}`,
      });
    }
  },
};
