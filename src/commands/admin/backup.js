'use strict';

const {
  AttachmentBuilder,
  FileBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const backup = require('../../services/backup');
const { config } = require('../../config');
const { COLORS, V2_FLAGS, panel, reply, separator } = require('../../ui/components');
const { timestamp } = require('../../utils/format');
const { isOwner } = require('../../utils/permissions');

/** Rozmiar pliku w czytelnej formie. */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

module.exports = {
  formatSize,

  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Kopie zapasowe bazy danych bota')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('teraz').setDescription('Tworzy kopie bazy teraz (wlasciciel bota dostaje plik)'),
    )
    .addSubcommand((sub) => sub.setName('lista').setDescription('Lista zapisanych kopii bazy')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'lista') {
      const backups = backup.list();
      const lines = backups
        .slice(0, 15)
        .map((entry) => `\`${entry.name}\` • ${formatSize(entry.size)} • ${timestamp(new Date(entry.createdAt), 'R')}`);

      return reply.panel(
        interaction,
        panel({
          color: COLORS.info,
          title: '💾 Kopie zapasowe bazy',
          description: backups.length
            ? `Zapisanych kopii: **${backups.length}**` + (backups.length > 15 ? ' (pokazano 15 najnowszych)' : '')
            : 'Brak kopii — utworz pierwsza komenda `/backup teraz`.',
          blocks: lines.length ? [lines.join('\n')] : [],
          footer: `Kopia automatyczna raz na dobe • przechowywane ${config.backupRetentionDays} dni`,
        }),
      );
    }

    // teraz
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let created;
    try {
      created = await backup.create();
    } catch (error) {
      return reply.error(interaction, `Nie udalo sie utworzyc kopii: ${error.message}`);
    }

    // Kopia zawiera dane wszystkich serwerow bota, wiec plik dostaje tylko wlasciciel (OWNER_IDS).
    const canDownload = isOwner(interaction.user.id);
    const fits = created.size <= backup.ATTACHMENT_LIMIT;

    const container = panel({
      color: COLORS.success,
      title: '💾 Utworzono kopie bazy',
      fields: [
        { name: 'Plik', value: `\`${created.name}\``, inline: true },
        { name: 'Rozmiar', value: formatSize(created.size), inline: true },
        { name: 'Usuniete stare kopie', value: String(created.removed), inline: true },
      ],
      footer: !canDownload
        ? 'Plik kopii moze pobrac tylko wlasciciel bota (OWNER_IDS) — kopia zawiera dane wszystkich serwerow.'
        : !fits
          ? 'Plik jest wiekszy niz 8 MB — pobierz go bezposrednio z serwera (katalog kopii).'
          : undefined,
    });

    if (!canDownload || !fits) return reply.panel(interaction, container);

    container.addSeparatorComponents(separator());
    container.addFileComponents(new FileBuilder().setURL(`attachment://${created.name}`));

    return interaction.editReply({
      components: [container],
      files: [new AttachmentBuilder(created.path, { name: created.name })],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
  },
};
