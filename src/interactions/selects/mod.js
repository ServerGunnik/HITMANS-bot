'use strict';

const {
	ActionRowBuilder,
	AttachmentBuilder,
	MessageFlags,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} = require('discord.js');

const modsService = require('../../services/mods');
const { COLORS, panel, reply } = require('../../ui/components');
const { build: customId } = require('../../utils/customId');
const { truncate } = require('../../utils/format');
const logger = require('../../utils/logger');

/**
 * Handler wyboru w komendzie `/mod`. Dwa etapy:
 *   - `mod:pick`          → user wybral moda, pokazujemy panel wersji
 *   - `mod:version:<mod>` → user wybral wersje, wysylamy jara
 */

function buildVersionSelect(mod, versions) {
	const options = versions.slice(0, 25).map((entry) => {
		const label = entry.available ? `MC ${entry.mc}` : `MC ${entry.mc}  (wkrotce)`;
		const option = new StringSelectMenuOptionBuilder()
			.setLabel(truncate(label, 100))
			.setValue(entry.mc);
		if (entry.available && entry.size) {
			option.setDescription(`Rozmiar jara: ${formatSize(entry.size)}`);
		} else if (!entry.available) {
			option.setDescription('Ta wersja nie jest jeszcze zbudowana.');
		}
		return option;
	});

	return new StringSelectMenuBuilder()
		.setCustomId(customId(modsService.NAMESPACE, 'version', mod.id))
		.setPlaceholder('Wybierz wersje Minecrafta...')
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(options);
}

async function handlePick(interaction) {
	const modId = interaction.values?.[0];
	const mod = modId ? modsService.readMod(modId) : null;
	if (!mod) return reply.error(interaction, 'Nie znalazlem tego moda w bibliotece.');

	const versions = modsService.listVersions(modId);
	const availableCount = versions.filter((v) => v.available).length;

	const container = panel({
		color: COLORS.info,
		title: `${mod.emoji} ${mod.name}`,
		description: [
			mod.description,
			mod.loader ? `**Loader:** ${mod.loader}` : null,
			mod.author ? `**Autor:** ${mod.author}` : null,
			mod.latestVersion ? `**Ostatni build:** ${mod.latestVersion}` : null,
			mod.repo ? `**Repo:** <${mod.repo}>` : null,
		]
			.filter(Boolean)
			.join('\n'),
		rows: [new ActionRowBuilder().addComponents(buildVersionSelect(mod, versions))],
		footer: `Krok 2/2 — dostepne wersje: ${availableCount}/${versions.length}.`,
	});

	// Update tej samej wiadomosci (ephemeral), zeby user nie mial spamu.
	await interaction.update({
		components: [container],
		flags: MessageFlags.IsComponentsV2,
		allowedMentions: { parse: [] },
	});
}

async function handleVersion(interaction, modId) {
	const mod = modId ? modsService.readMod(modId) : null;
	if (!mod) return reply.error(interaction, 'Nie znalazlem tego moda w bibliotece.');

	const mc = interaction.values?.[0];
	if (!mc) return reply.error(interaction, 'Nie odczytalem wybranej wersji.');

	const versionRow = modsService.listVersions(modId).find((entry) => entry.mc === mc);
	if (!versionRow) return reply.error(interaction, 'Ta wersja nie jest wspierana.');

	if (!versionRow.available) {
		return reply.warning(
			interaction,
			`${mod.name} na Minecraft ${mc} jeszcze nie jest zbudowany. Wybierz inna dostepna wersje.`,
		);
	}

	const filename = `${mod.id}-${mc}.jar`;
	const attachment = new AttachmentBuilder(versionRow.jarPath).setName(filename);

	// Attachment + Container V2 razem: TextDisplay musi referencjonowac attachment
	// przez `attachment://<filename>` w opisie, w przeciwnym razie jest doklejony
	// osobno. Prostszy sposob: wyslij attachment osobnym followUp-em po update-cie.

	try {
		await interaction.update({
			components: [
				panel({
					color: COLORS.success,
					title: `✅ ${mod.emoji} ${mod.name} — MC ${mc}`,
					description: `Plik: **${filename}** (${formatSize(versionRow.size)})\nWrzuc go do folderu \`mods/\` twojej instancji Minecrafta.`,
					footer: 'Pamietaj usunac stare wersje tego moda z folderu mods.',
				}),
			],
			flags: MessageFlags.IsComponentsV2,
			allowedMentions: { parse: [] },
		});

		await interaction.followUp({
			files: [attachment],
			flags: MessageFlags.Ephemeral,
			allowedMentions: { parse: [] },
		});
	} catch (error) {
		logger.error(`Nie udalo sie wyslac jara ${filename}:`, error);
		return reply.error(interaction, 'Cos poszlo nie tak przy wysylaniu jara. Sprobuj ponownie.');
	}
}

function formatSize(bytes) {
	if (!bytes || bytes < 0) return '?';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

module.exports = {
	namespace: modsService.NAMESPACE,

	async execute(interaction, { action, args }) {
		if (action === 'pick') return handlePick(interaction);
		if (action === 'version') return handleVersion(interaction, args[0]);
		return reply.error(interaction, 'Nieznana akcja.');
	},
};
