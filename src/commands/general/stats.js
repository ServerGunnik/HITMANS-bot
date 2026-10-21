'use strict';

const { ChannelType, InteractionContextType, SlashCommandBuilder } = require('discord.js');

const activity = require('../../database/repositories/activity');
const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const moderation = require('../../database/repositories/moderation');
const recruitment = require('../../database/repositories/recruitment');
const roles = require('../../database/repositories/roles');
const economyService = require('../../services/economy');
const { config } = require('../../config');
const { COLORS, panel, reply } = require('../../ui/components');
const { formatNumber, plural, sparkline, timestamp } = require('../../utils/format');

/** Liczy kanaly wg typu. */
function countChannels(guild) {
  const counts = { text: 0, voice: 0, category: 0, forum: 0, other: 0 };

  for (const channel of guild.channels.cache.values()) {
    switch (channel.type) {
      case ChannelType.GuildText:
      case ChannelType.GuildAnnouncement:
        counts.text += 1;
        break;
      case ChannelType.GuildVoice:
      case ChannelType.GuildStageVoice:
        counts.voice += 1;
        break;
      case ChannelType.GuildCategory:
        counts.category += 1;
        break;
      case ChannelType.GuildForum:
      case ChannelType.GuildMedia:
        counts.forum += 1;
        break;
      default:
        counts.other += 1;
    }
  }
  return counts;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Statystyki serwera i aktywnosc czlonkow')
    .setContexts(InteractionContextType.Guild),

  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const { guild } = interaction;

    // Pelna lista czlonkow tylko dla mniejszych serwerow - inaczej korzystamy z cache.
    let members = guild.members.cache;
    let approximate = false;
    if (guild.memberCount <= 2000) {
      members = await guild.members.fetch().catch(() => guild.members.cache);
    } else {
      approximate = members.size < guild.memberCount;
    }

    const bots = members.filter((member) => member.user.bot).size;
    const humans = guild.memberCount - bots;

    const online = config.enablePresenceIntent
      ? members.filter((member) => member.presence && member.presence.status !== 'offline').size
      : null;

    const channels = countChannels(guild);
    const applications = recruitment.countByStatus(guild.id);
    const hierarchy = roles.list(guild.id);
    const history = activity.dailyHistory(guild.id, 7);
    const messagesTotal = activity.totalMessages(guild.id);
    const top = activity.topMembers(guild.id, 5);

    const hierarchyValue = hierarchy.length
      ? hierarchy
          .slice()
          .reverse()
          .map((entry) => {
            const role = guild.roles.cache.get(entry.role_id);
            const count = role ? role.members.size : 0;
            return `\`${entry.level}.\` ${role ?? entry.name} — **${count}** ${plural(count, 'osoba', 'osoby', 'osob')}`;
          })
          .join('\n')
      : 'Brak skonfigurowanej hierarchii — uzyj `/setup` lub `/rola hierarchia ustaw`.';

    const topValue = top.length
      ? top.map((entry, index) => `\`${index + 1}.\` <@${entry.user_id}> — **${entry.messages}**`).join('\n')
      : 'Brak zapisanej aktywnosci.';

    const settings = guilds.get(guild.id);
    const economyFields = [];

    if (settings.economy_enabled) {
      const richest = economy.leaderboard(guild.id, { limit: 1 })[0];
      economyFields.push({
        name: `${settings.currency_emoji} Ekonomia`,
        value:
          `W obiegu: **${formatNumber(economy.totalCirculation(guild.id))}** ${settings.currency_name}\n` +
          `Kont: **${formatNumber(economy.countAccounts(guild.id))}**` +
          (richest ? ` • Najbogatszy: <@${richest.user_id}> (**${formatNumber(richest.balance)}**)` : ''),
      });
    }

    const container = panel({
      color: COLORS.info,
      title: `📊 Statystyki — ${guild.name}`,
      thumbnail: guild.iconURL() ? { url: guild.iconURL({ size: 256 }) } : undefined,
      description: `Serwer utworzony ${timestamp(guild.createdAt, 'D')} (${timestamp(guild.createdAt, 'R')}).`,
      fields: [
        {
          name: '👥 Czlonkowie',
          value:
            `Lacznie: **${guild.memberCount}**\n` +
            `Ludzie: **${humans}** • Boty: **${bots}**${approximate ? ' *(szacunkowo)*' : ''}` +
            (online !== null ? `\nOnline: **${online}**` : ''),
        },
        {
          name: '💬 Aktywnosc',
          value:
            `Zapisane wiadomosci: **${messagesTotal}**\n` +
            `Aktywni (24h): **${activity.activeMembers(guild.id, 1)}** • ` +
            `(7 dni): **${activity.activeMembers(guild.id, 7)}** • ` +
            `(30 dni): **${activity.activeMembers(guild.id, 30)}**\n` +
            `Ostatnie 7 dni: \`${sparkline(history.map((day) => day.messages))}\` ` +
            `(${history.reduce((sum, day) => sum + day.messages, 0)} wiadomosci)`,
        },
        {
          name: '📨 Rekrutacja',
          value:
            `Oczekujace: **${applications.pending}** • ` +
            `Zaakceptowane: **${applications.accepted}** • ` +
            `Odrzucone: **${applications.rejected}**`,
        },
        { name: '🏰 Hierarchia klanu', value: hierarchyValue },
        ...economyFields,
        { name: '🏆 Najaktywniejsi', value: topValue },
        {
          name: '📁 Struktura',
          value:
            `Kanaly tekstowe: **${channels.text}** • glosowe: **${channels.voice}** • ` +
            `kategorie: **${channels.category}** • fora: **${channels.forum}**\n` +
            `Role: **${guild.roles.cache.size - 1}** • Ulepszenia serwera: **${guild.premiumSubscriptionCount ?? 0}**`,
        },
        {
          name: '🛡️ Moderacja',
          value: `Aktywne ostrzezenia: **${moderation.countAllWarnings(guild.id)}** • Sprawy: **${moderation.nextCaseNumber(guild.id) - 1}**`,
        },
      ],
      footer: `ID serwera: ${guild.id}`,
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
