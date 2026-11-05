'use strict';

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const updater = require('../../services/updater');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');
const { isOwner } = require('../../utils/permissions');

/** Lista commitow jako tekst (do 10 pozycji). */
function renderCommits(commits) {
  return commits.map((commit) => `\`${commit.hash}\` ${truncate(commit.subject, 120)}`).join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aktualizuj')
    .setDescription('Aktualizacja bota z repozytorium git (PM2)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName('sprawdz').setDescription(`Sprawdza, czy na ${updater.UPSTREAM} sa nowe commity`),
    )
    .addSubcommand((sub) =>
      sub.setName('teraz').setDescription('Pobiera aktualizacje i restartuje bota (tylko wlasciciel bota)'),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'teraz' && !isOwner(interaction.user.id)) {
      return reply.error(interaction, 'Aktualizacje moze uruchomic tylko wlasciciel bota (`OWNER_IDS` w pliku .env).');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === 'sprawdz') {
      const result = await updater.check();
      if (result.error) return reply.error(interaction, `Nie udalo sie sprawdzic aktualizacji: ${result.error}`);

      const version = await updater.currentVersion();
      return reply.panel(
        interaction,
        panel({
          color: result.behind ? COLORS.warning : COLORS.success,
          title: result.behind ? `🔄 Dostepna aktualizacja (${result.behind})` : '✅ Bot jest aktualny',
          description: `Aktualna wersja: \`${version.hash ?? '?'}\` ${truncate(version.subject, 120)}`,
          blocks: result.behind ? [renderCommits(result.commits)] : [],
          footer: result.behind
            ? result.behind > result.commits.length
              ? `Pokazano ${result.commits.length} najnowszych • aktualizacja: /aktualizuj teraz`
              : 'Aktualizacja: /aktualizuj teraz'
            : `Porownano z ${updater.UPSTREAM}`,
        }),
      );
    }

    // teraz
    const result = await updater.update();
    if (!result.ok) return reply.error(interaction, `Aktualizacja przerwana: ${result.reason}`);
    if (!result.updated) return reply.success(interaction, 'Bot jest juz aktualny — nic do zrobienia.');

    await reply.panel(
      interaction,
      panel({
        color: COLORS.success,
        title: '🔄 Zaktualizowano bota',
        description:
          `\`${result.from}\` → \`${result.to}\`` +
          (result.installed ? '\nZaleznosci zaktualizowane (`npm ci --omit=dev`).' : ''),
        blocks: [renderCommits(result.commits)],
        footer: 'Restart za ok. 2 s — PM2 uruchomi bota ponownie.',
      }),
    );
    updater.scheduleRestart();
    return null;
  },
};
