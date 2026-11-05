'use strict';

const activityRepo = require('../database/repositories/clanActivity');
const guilds = require('../database/repositories/guilds');
const leavesRepo = require('../database/repositories/leaves');
const inactivity = require('./inactivity');
const modlog = require('../utils/modlog');
const logger = require('../utils/logger');
const { reportSlot, DAY_MS } = require('../utils/clanTime');
const { COLORS, V2_FLAGS, panel } = require('../ui/components');
const { formatNumber, humanDuration, plural, timestamp } = require('../utils/format');

/**
 * Zbiera dane raportu z bazy dla przedzialu [since, until).
 * `inactive` (liczba nieaktywnych) liczymy osobno, bo wymaga listy czlonkow z Discorda.
 */
function collectReportData(guildId, { since, until, inactive = null, inactiveDays = null } = {}) {
  const sinceDay = activityRepo.dayOf(since);
  const untilDay = activityRepo.dayOf(until);
  const settings = guilds.get(guildId);

  return {
    guildId,
    since,
    until,
    joins: activityRepo.countMemberEvents(guildId, 'join', since, until),
    leaves: activityRepo.countMemberEvents(guildId, 'leave', since, until),
    applications: activityRepo.applicationStats(guildId, since, until),
    totals: activityRepo.totalsByDays(guildId, sinceDay, untilDay),
    topMessages: activityRepo.topByDays(guildId, 'messages', sinceDay, untilDay, 5),
    topVoice: activityRepo.topByDays(guildId, 'voice_seconds', sinceDay, untilDay, 5),
    moderation: activityRepo.moderationStats(guildId, since, until),
    economy: settings.economy_enabled
      ? {
          ...activityRepo.economyStats(guildId, since, until),
          currencyName: settings.currency_name,
          currencyEmoji: settings.currency_emoji,
        }
      : null,
    inactive,
    inactiveDays,
    onLeave: leavesRepo.listActive(guildId).length,
  };
}

function rankLines(rows, format) {
  if (!rows.length) return 'Brak danych z tego tygodnia.';
  const medals = ['🥇', '🥈', '🥉'];
  return rows.map((row, index) => `${medals[index] ?? `\`${index + 1}.\``} <@${row.user_id}> — ${format(row.total)}`).join('\n');
}

/** Czysta funkcja: buduje panel raportu z zebranych danych. */
function buildReportPanel(data, { guildName = 'serwer', manual = false } = {}) {
  const balance = data.joins - data.leaves;
  const fields = [
    {
      name: '👥 Czlonkowie',
      value:
        `Dolaczylo: **${data.joins}** • Odeszlo: **${data.leaves}** • ` +
        `Bilans: **${balance > 0 ? '+' : ''}${balance}**`,
    },
    {
      name: '📨 Rekrutacja',
      value:
        `Nowe zgloszenia: **${data.applications.submitted}** • ` +
        `Zaakceptowane: **${data.applications.accepted}** • Odrzucone: **${data.applications.rejected}**`,
    },
    {
      name: '💬 Aktywnosc',
      value:
        `Wiadomosci: **${formatNumber(data.totals.messages)}** • ` +
        `Na glosowych: **${humanDuration(data.totals.voiceSeconds * 1000)}** • ` +
        `Aktywne osoby: **${data.totals.activeUsers}**`,
    },
    { name: '🏆 Najwiecej wiadomosci', value: rankLines(data.topMessages, (total) => `**${formatNumber(total)}**`) },
    { name: '🎙️ Najdluzej na glosowych', value: rankLines(data.topVoice, (total) => `**${humanDuration(total * 1000)}**`) },
    {
      name: '🛡️ Moderacja',
      value: data.moderation.total
        ? `**${data.moderation.total}** ${plural(data.moderation.total, 'akcja', 'akcje', 'akcji')}: ` +
          data.moderation.byAction
            .slice(0, 6)
            .map((row) => `${modlog.ACTION_META[row.action]?.label ?? row.action} ${row.count}`)
            .join(', ')
        : 'Spokojny tydzien — brak akcji moderacyjnych.',
    },
  ];

  if (data.economy) {
    const { currencyEmoji, currencyName } = data.economy;
    fields.push({
      name: `${currencyEmoji} Ekonomia`,
      value:
        `Zarobione: **${formatNumber(data.economy.earned)}** ${currencyName} • ` +
        `Przelewy: **${data.economy.transfers}** (${formatNumber(data.economy.transferVolume)}) • ` +
        `Zakupy w sklepie: **${data.economy.purchases}**` +
        (data.economy.topEarner
          ? `\nNajwiecej zarobil(a): <@${data.economy.topEarner.user_id}> (**${formatNumber(data.economy.topEarner.total)}**)`
          : ''),
    });
  }

  if (data.inactive !== null && data.inactive !== undefined) {
    fields.push({
      name: '💤 Nieaktywni',
      value:
        `**${data.inactive}** ${plural(data.inactive, 'osoba', 'osoby', 'osob')} bez aktywnosci od ${data.inactiveDays} dni` +
        ` • Na urlopie: **${data.onLeave}**`,
    });
  } else {
    fields.push({ name: '🏖️ Urlopy', value: `Na urlopie: **${data.onLeave}**` });
  }

  return panel({
    color: COLORS.clan,
    title: `📅 Raport tygodniowy — ${guildName}`,
    description: `Okres: ${timestamp(data.since, 'f')} – ${timestamp(data.until, 'f')}`,
    fields,
    footer: manual ? 'Raport wygenerowany na zadanie (/raport teraz).' : 'Raport generowany automatycznie w kazdy poniedzialek o 10:00.',
  });
}

/** Zbiera komplet danych (z nieaktywnymi) i buduje panel raportu dla serwera. */
async function generate(guild, { since, until, manual = false } = {}) {
  const days = activityRepo.getSettings(guild.id).inactive_days || inactivity.DEFAULT_DAYS;
  let inactive = null;
  try {
    const result = await inactivity.collectInactive(guild, { days, now: until });
    if (result.configured) inactive = result.inactive.length;
  } catch (error) {
    logger.debug(`Raport: nie udalo sie policzyc nieaktywnych (${guild.id}):`, error.message);
  }

  const data = collectReportData(guild.id, { since, until, inactive, inactiveDays: days });
  return buildReportPanel(data, { guildName: guild.name, manual });
}

/** Przedzial dla raportu na zadanie: ostatnie 7 dni. */
function manualRange(now = Date.now()) {
  return { since: now - 7 * DAY_MS, until: now };
}

async function sendToChannel(guild, channelId, container) {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch?.(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) throw new Error('Kanal raportu nie istnieje albo nie jest tekstowy.');
  return channel.send({ components: [container], flags: V2_FLAGS, allowedMentions: { parse: [] } });
}

/**
 * Scheduler: wysyla raport, gdy minal termin (pon. 10:00) i ten tydzien nie byl jeszcze raportowany.
 * Tydzien jest rezerwowany w bazie PRZED wysylka — restart nie spowoduje podwojnego raportu.
 */
async function processDue(client, now = Date.now()) {
  const slot = reportSlot(now);

  for (const row of activityRepo.listReportGuilds()) {
    if (row.report_last_week === slot.key) continue;
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    if (!activityRepo.claimReportWeek(guild.id, slot.key)) continue;

    try {
      const container = await generate(guild, { since: slot.since, until: slot.at });
      await sendToChannel(guild, row.report_channel_id, container);
      logger.info(`Wyslano raport tygodniowy ${slot.key} (${guild.id}).`);
    } catch (error) {
      logger.warn(`Nie udalo sie wyslac raportu tygodniowego (${guild.id}):`, error.message);
    }
  }
}

module.exports = { collectReportData, buildReportPanel, generate, manualRange, sendToChannel, processDue };
