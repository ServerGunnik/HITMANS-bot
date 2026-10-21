'use strict';

const {
	ActionRowBuilder,
	InteractionContextType,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} = require('discord.js');

const modsService = require('../../services/mods');
const { COLORS, panel, reply } = require('../../ui/components');
const { build: customId } = require('../../utils/customId');
const { truncate } = require('../../utils/format');

/** Buduje select menu z lista modow — pierwszy krok flow-a `/mod`. */
function buildModSelect(mods) {
	const options = mods.slice(0, 25).map((mod) => {
		const option = new StringSelectMenuOptionBuilder()
			.setLabel(truncate(mod.name, 100))
			.setValue(mod.id);
		if (mod.emoji) option.setEmoji(mod.emoji);
		if (mod.description) option.setDescription(truncate(mod.description, 100));
		return option;
	});

	return new StringSelectMenuBuilder()
		.setCustomId(customId(modsService.NAMESPACE, 'pick'))
		.setPlaceholder('Wybierz moda...')
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(options);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('mod')
		.setDescription('Pobierz jara dowolnego z naszych modow na wybrana wersje Minecrafta.')
		.setContexts(InteractionContextType.Guild),

	async execute(interaction) {
		const mods = modsService.listMods();

		if (mods.length === 0) {
			return reply.info(interaction, 'Na razie nie ma jeszcze zadnych modow w bibliotece.');
		}

		const container = panel({
			color: COLORS.info,
			title: '📦 Nasze mody',
			description: `Dostepne mody: **${mods.length}**. Wybierz z listy ponizej, potem wersje Minecrafta.`,
			rows: [new ActionRowBuilder().addComponents(buildModSelect(mods))],
			footer: 'Krok 1/2 — wybor moda.',
		});

		return reply.panel(interaction, container);
	},
};
