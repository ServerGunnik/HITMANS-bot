'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const roles = require('../../database/repositories/roles');
const modlog = require('../../utils/modlog');
const { canManageRole, memberCanAssignRole } = require('../../utils/permissions');
const { COLORS, panel, reply } = require('../../ui/components');
const { plural } = require('../../utils/format');

/** Zmiana stopnia w hierarchii klanu (awans / degradacja). */
async function changeLevel(interaction, direction) {
  const target = interaction.options.getUser('uzytkownik', true);
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) return reply.error(interaction, 'Ten uzytkownik nie jest czlonkiem serwera.');

  const hierarchy = roles.list(interaction.guild.id);
  if (hierarchy.length === 0) {
    return reply.error(
      interaction,
      'Hierarchia rol nie jest skonfigurowana. Uzyj `/setup` albo `/rola hierarchia ustaw`.',
    );
  }

  const current = roles.highestLevelFor(interaction.guild.id, [...member.roles.cache.keys()]);
  const currentLevel = current?.level ?? 0;
  const nextLevel = direction === 'up' ? currentLevel + 1 : currentLevel - 1;

  if (direction === 'up' && nextLevel > hierarchy.at(-1).level) {
    return reply.error(interaction, `${member} ma juz najwyzszy stopien w hierarchii.`);
  }
  if (direction === 'down' && currentLevel === 0) {
    return reply.error(interaction, `${member} nie ma zadnego stopnia w hierarchii klanu.`);
  }

  const nextEntry = nextLevel > 0 ? roles.getByLevel(interaction.guild.id, nextLevel) : null;
  if (nextLevel > 0 && !nextEntry) {
    return reply.error(interaction, `Brak roli przypisanej do poziomu **${nextLevel}** w hierarchii.`);
  }

  const nextRole = nextEntry ? interaction.guild.roles.cache.get(nextEntry.role_id) : null;
  if (nextEntry && !nextRole) {
    return reply.error(interaction, 'Rola przypisana do tego poziomu juz nie istnieje — popraw hierarchie.');
  }

  if (nextRole) {
    const botCheck = canManageRole(interaction.guild, nextRole);
    if (!botCheck.ok) return reply.error(interaction, botCheck.reason);
  }

  await interaction.deferReply();

  const currentRole = current ? interaction.guild.roles.cache.get(current.role_id) : null;
  if (currentRole) {
    await member.roles.remove(currentRole, `Zmiana stopnia przez ${interaction.user.tag}`).catch(() => {});
  }
  if (nextRole) {
    await member.roles.add(nextRole, `Zmiana stopnia przez ${interaction.user.tag}`).catch(() => {});
  }

  await modlog.logAction(interaction.guild, {
    action: direction === 'up' ? 'promote' : 'demote',
    user: target,
    moderator: interaction.user,
    reason: `${currentRole?.name ?? 'brak'} → ${nextRole?.name ?? 'brak'}`,
  });

  return reply.success(
    interaction,
    direction === 'up'
      ? `${member} awansowal(a): ${currentRole ?? '*brak stopnia*'} → **${nextRole.name}**`
      : `${member} zostal(a) zdegradowany(a): ${currentRole?.name ?? 'brak'} → ${nextRole ? `**${nextRole.name}**` : '*brak stopnia*'}`,
    { ephemeral: false },
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rola')
    .setDescription('Zarzadzanie rolami czlonkow klanu')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('nadaj')
        .setDescription('Nadaje role uzytkownikowi')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Komu nadac role').setRequired(true))
        .addRoleOption((option) => option.setName('rola').setDescription('Ktora role nadac').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('odbierz')
        .setDescription('Odbiera role uzytkownikowi')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Komu odebrac role').setRequired(true))
        .addRoleOption((option) => option.setName('rola').setDescription('Ktora role odebrac').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('awans')
        .setDescription('Awansuje czlonka o jeden stopien w hierarchii klanu')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo awansowac').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('degraduj')
        .setDescription('Obniza stopien czlonka w hierarchii klanu')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Kogo zdegradowac').setRequired(true)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('hierarchia')
        .setDescription('Konfiguracja stopni klanowych')
        .addSubcommand((sub) => sub.setName('pokaz').setDescription('Pokazuje skonfigurowana hierarchie'))
        .addSubcommand((sub) =>
          sub
            .setName('ustaw')
            .setDescription('Przypisuje role do poziomu hierarchii')
            .addRoleOption((option) => option.setName('rola').setDescription('Rola klanowa').setRequired(true))
            .addIntegerOption((option) =>
              option
                .setName('poziom')
                .setDescription('Poziom: 1 = najnizszy stopien')
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa role z hierarchii')
            .addRoleOption((option) => option.setName('rola').setDescription('Rola do usuniecia').setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName('wyczysc').setDescription('Czysci cala hierarchie')),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ─── Hierarchia ─────────────────────────────────────────────────────
    if (group === 'hierarchia') {
      if (subcommand === 'pokaz') {
        const hierarchy = roles.list(guildId);

        const value = hierarchy.length
          ? hierarchy
              .slice()
              .reverse()
              .map((entry) => {
                const role = interaction.guild.roles.cache.get(entry.role_id);
                const count = role ? role.members.size : 0;
                return (
                  `\`Poziom ${entry.level}\` ${role ?? `~~${entry.name}~~ *(rola usunieta)*`} — ` +
                  `**${count}** ${plural(count, 'osoba', 'osoby', 'osob')}`
                );
              })
              .join('\n')
          : '*Hierarchia nie jest skonfigurowana.*';

        return reply.panel(
          interaction,
          panel({
            color: COLORS.clan,
            title: '🏰 Hierarchia klanu',
            description: value,
            footer: 'Awans: /rola awans • Konfiguracja: /rola hierarchia ustaw',
          }),
        );
      }

      if (subcommand === 'ustaw') {
        const role = interaction.options.getRole('rola', true);
        const level = interaction.options.getInteger('poziom', true);

        const check = canManageRole(interaction.guild, role);
        if (!check.ok) return reply.error(interaction, check.reason);

        roles.set(guildId, { roleId: role.id, level, name: role.name });
        return reply.success(interaction, `Rola ${role} zostala przypisana do poziomu **${level}**.`);
      }

      if (subcommand === 'usun') {
        const role = interaction.options.getRole('rola', true);
        const removed = roles.remove(guildId, role.id);
        return removed
          ? reply.success(interaction, `Rola ${role} zostala usunieta z hierarchii.`)
          : reply.error(interaction, `Rola ${role} nie nalezy do hierarchii.`);
      }

      const cleared = roles.clear(guildId);
      return reply.success(interaction, `Wyczyszczono hierarchie (usunieto **${cleared}** wpisow).`);
    }

    if (subcommand === 'awans') return changeLevel(interaction, 'up');
    if (subcommand === 'degraduj') return changeLevel(interaction, 'down');

    // ─── Nadawanie / odbieranie rol ─────────────────────────────────────
    const target = interaction.options.getUser('uzytkownik', true);
    const role = interaction.options.getRole('rola', true);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (!member) return reply.error(interaction, 'Ten uzytkownik nie jest czlonkiem serwera.');

    const botCheck = canManageRole(interaction.guild, role);
    if (!botCheck.ok) return reply.error(interaction, botCheck.reason);

    const executorCheck = memberCanAssignRole(interaction.member, role);
    if (!executorCheck.ok) return reply.error(interaction, executorCheck.reason);

    if (subcommand === 'nadaj') {
      if (member.roles.cache.has(role.id)) {
        return reply.error(interaction, `${member} ma juz role ${role}.`);
      }

      await interaction.deferReply();
      await member.roles.add(role, `Nadane przez ${interaction.user.tag}`);
      await modlog.logAction(interaction.guild, {
        action: 'role_add',
        user: target,
        moderator: interaction.user,
        reason: `Nadano role ${role.name}`,
      });

      return reply.success(interaction, `Nadano role ${role} uzytkownikowi ${member}.`, { ephemeral: false });
    }

    // odbierz
    if (!member.roles.cache.has(role.id)) {
      return reply.error(interaction, `${member} nie ma roli ${role}.`);
    }

    await interaction.deferReply();
    await member.roles.remove(role, `Odebrane przez ${interaction.user.tag}`);
    await modlog.logAction(interaction.guild, {
      action: 'role_remove',
      user: target,
      moderator: interaction.user,
      reason: `Odebrano role ${role.name}`,
    });

    return reply.success(interaction, `Odebrano role ${role} uzytkownikowi ${member}.`, { ephemeral: false });
  },
};
