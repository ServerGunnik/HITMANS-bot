'use strict';

const fs = require('node:fs');

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const { config } = require('../../config');
const backup = require('../../services/backup');
const updater = require('../../services/updater');
const { formatSize } = require('./backup');
const { COLORS, panel, reply } = require('../../ui/components');
const { humanDuration, timestamp, truncate } = require('../../utils/format');

/** Rozmiar pliku bazy razem z plikiem WAL. */
function databaseSize() {
  let total = 0;
  for (const file of [config.databasePath, `${config.databasePath}-wal`]) {
    try {
      total += fs.statSync(file).size;
    } catch {
      // brak pliku WAL jest normalny
    }
  }
  return total;
}

/** Opis zaleglosci wzgledem origin/main na podstawie ostatniego sprawdzenia. */
function describeUpdates(state) {
  if (!state.checkedAt) return 'jeszcze nie sprawdzano — `/aktualizuj sprawdz`';
  if (state.error) return `blad sprawdzania (${timestamp(state.checkedAt, 'R')})`;
  const when = timestamp(state.checkedAt, 'R');
  return state.behind ? `**${state.behind}** commit(ow) do tylu (${when})` : `aktualny (${when})`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Stan techniczny bota: wersja, czas dzialania, pamiec, baza')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const version = await updater.currentVersion();
    const memory = process.memoryUsage();
    const ping = interaction.client.ws?.ping;
    const lastBackup = backup.lastBackupAt();

    return reply.panel(
      interaction,
      panel({
        color: COLORS.primary,
        title: '🖥️ Status bota',
        fields: [
          {
            name: 'Wersja',
            value: version.hash
              ? `\`${version.hash}\` ${truncate(version.subject, 120)}`
              : truncate(version.subject, 120),
            inline: true,
          },
          { name: 'Aktualizacje', value: describeUpdates(updater.state), inline: true },
          { name: 'Czas dzialania', value: humanDuration(process.uptime() * 1000), inline: true },
          { name: 'Ping WebSocket', value: Number.isFinite(ping) && ping >= 0 ? `${ping} ms` : 'brak danych', inline: true },
          { name: 'Pamiec (RSS / heap)', value: `${formatSize(memory.rss)} / ${formatSize(memory.heapUsed)}`, inline: true },
          { name: 'Node.js', value: process.version, inline: true },
          { name: 'Baza danych', value: formatSize(databaseSize()), inline: true },
          { name: 'Ostatnia kopia', value: lastBackup ? timestamp(lastBackup, 'R') : 'brak', inline: true },
          { name: 'Serwery', value: String(interaction.client.guilds?.cache?.size ?? 0), inline: true },
        ],
        footer: config.autoUpdate
          ? `Automatyczna aktualizacja: co ${config.autoUpdateIntervalMinutes} min`
          : 'Automatyczna aktualizacja wylaczona (AUTO_UPDATE)',
      }),
    );
  },
};
