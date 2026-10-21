'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const activity = require('../../database/repositories/activity');
const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const moderation = require('../../database/repositories/moderation');
const recruitment = require('../../database/repositories/recruitment');
const roles = require('../../database/repositories/roles');
const economyService = require('../../services/economy');
const recruitmentService = require('../../services/recruitment');
const { COLORS, panel, reply } = require('../../ui/components');
const { plural, timestamp, truncate } = require('../../utils/format');

/** Buduje kontener z profilem czlonka klanu — uzywany takze przez panel zgloszen. */
function buildProfile(member, { viewer } = {}) {
  const { guild } = member;
  const settings = guilds.get(guild.id);

  const rank = roles.highestLevelFor(guild.id, [...member.roles.cache.keys()]);
  const warningCount = moderation.countWarnings(guild.id, member.id);
  const stats = activity.getMember(guild.id, member.id);
  const application = recruitment.getLatestApplication(guild.id, member.id);
  const cases = moderation.listCases(guild.id, { userId: member.id, limit: 3 });

  const economyField = [];
  if (settings.economy_enabled) {
    const rank = economy.rankOf(guild.id, member.id);
    economyField.push({
      name: 'Konto klanowe',
      value:
        `${economyService.formatCurrency(guild.id, rank?.account.balance ?? 0)}` +
        (rank ? ` • pozycja **${rank.position}** z ${rank.total}` : ''),
    });
  }

  const memberRoles = member.roles.cache
    .filter((role) => role.id !== guild.roles.everyone.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.toString());

  const status = settings.member_role_id && member.roles.cache.has(settings.member_role_id)
    ? '✅ Czlonek klanu'
    : settings.guest_role_id && member.roles.cache.has(settings.guest_role_id)
      ? '🕓 Gosc / rekrut'
      : '👤 Uzytkownik serwera';

  const applicationValue = application
    ? `#${application.id} — ${recruitmentService.STATUS_META[application.status].emoji} ` +
      `${recruitmentService.STATUS_META[application.status].label} (${timestamp(application.created_at, 'R')})`
    : 'Brak zgloszen rekrutacyjnych.';

  const casesValue = cases.length
    ? cases
        .map((item) => `\`#${item.case_number}\` ${item.action} — ${truncate(item.reason ?? 'brak powodu', 80)}`)
        .join('\n')
    : 'Brak wpisow w rejestrze.';

  return panel({
    color: warningCount > 0 ? COLORS.warning : COLORS.clan,
    title: `👤 Profil — ${member.user.username}`,
    description: `${member} • \`${member.user.tag}\``,
    thumbnail: { url: member.displayAvatarURL({ size: 256 }), description: `Awatar ${member.user.username}` },
    fields: [
      { name: 'Status', value: status, inline: true },
      { name: 'Ranga klanowa', value: rank ? `${guild.roles.cache.get(rank.role_id) ?? rank.name} (poziom ${rank.level})` : 'brak', inline: true },
      { name: 'Dolaczyl(a) na serwer', value: timestamp(member.joinedAt, 'D'), inline: true },
      { name: 'Konto utworzone', value: timestamp(member.user.createdAt, 'D'), inline: true },
      {
        name: 'Aktywnosc',
        value: stats
          ? `Wiadomosci: **${stats.messages}** • Ostatnia: ${timestamp(stats.last_message_at, 'R')}`
          : 'Brak zapisanej aktywnosci.',
      },
      {
        name: 'Ostrzezenia',
        value: `**${warningCount}** ${plural(warningCount, 'aktywne ostrzezenie', 'aktywne ostrzezenia', 'aktywnych ostrzezen')}`,
        inline: true,
      },
      ...economyField,
      { name: 'Zgloszenie rekrutacyjne', value: applicationValue },
      { name: 'Ostatnie sprawy moderacyjne', value: casesValue },
      { name: `Role (${memberRoles.length})`, value: truncate(memberRoles.join(' ') || 'brak', 900) },
    ],
    footer: `ID: ${member.id}${viewer ? ` • na zadanie ${viewer.tag}` : ''}`,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Profil czlonka klanu')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('uzytkownik').setDescription('Czyj profil wyswietlic (domyslnie Twoj)').setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    const target = interaction.options.getUser('uzytkownik') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (!member) {
      return reply.error(interaction, 'Ten uzytkownik nie jest czlonkiem tego serwera.');
    }

    return reply.panel(interaction, buildProfile(member), { ephemeral: target.id !== interaction.user.id });
  },

  buildProfile,
};
