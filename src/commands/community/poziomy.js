'use strict';

const { ChannelType, InteractionContextType, SlashCommandBuilder } = require('discord.js');

const levelsRepo = require('../../database/repositories/levels');
const levelsService = require('../../services/levels');
const rolePanels = require('../../services/rolePanels');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply } = require('../../ui/components');

const MAX_REWARDS = 25;

async function handleSettings(interaction) {
  const guildId = interaction.guild.id;
  const enabled = interaction.options.getBoolean('wlaczone');
  const mode = interaction.options.getString('ogloszenia');
  const channel = interaction.options.getChannel('kanal');
  const multiplier = interaction.options.getNumber('mnoznik');
  const keepPrevious = interaction.options.getBoolean('zachowaj_poprzednie');

  const patch = {};
  if (enabled !== null) patch.enabled = enabled;
  if (multiplier !== null) patch.multiplier = Math.round(multiplier * 100) / 100;
  if (keepPrevious !== null) patch.keepPrevious = keepPrevious;
  if (channel) {
    patch.announceChannelId = channel.id;
    // Podanie kanalu bez trybu oznacza ogloszenia na tym kanale.
    if (!mode) patch.announceMode = 'channel';
  }
  if (mode) {
    if (mode === 'channel' && !channel && !levelsRepo.getSettings(guildId).announce_channel_id) {
      return reply.error(interaction, 'Tryb "staly kanal" wymaga podania opcji `kanal`.');
    }
    patch.announceMode = mode;
  }

  const changed = Object.keys(patch).length > 0;
  if (changed) levelsRepo.updateSettings(guildId, patch);

  return reply.panel(
    interaction,
    panel({
      color: changed ? COLORS.success : COLORS.info,
      title: changed ? '✅ Zapisano ustawienia poziomow' : '⭐ Ustawienia poziomow',
      fields: levelsService.describeSettings(interaction.guild),
      footer: 'Zmien opcje: /poziomy ustaw wlaczone | ogloszenia | kanal | mnoznik | zachowaj_poprzednie',
    }),
  );
}

async function handleReward(interaction, subcommand) {
  const guild = interaction.guild;

  if (subcommand === 'lista') {
    return reply.panel(
      interaction,
      panel({
        color: COLORS.info,
        title: '🎁 Nagrody za poziomy',
        blocks: [levelsService.describeRewards(guild)],
        footer: levelsRepo.getSettings(guild.id).keep_previous
          ? 'Nagrody sie kumuluja.'
          : 'Po awansie zostaje tylko najwyzsza nagroda.',
      }),
    );
  }

  const level = interaction.options.getInteger('poziom', true);

  if (subcommand === 'usun') {
    const removed = levelsRepo.removeReward(guild.id, level);
    return removed
      ? reply.success(interaction, `Usunieto nagrode za poziom **${level}**.`)
      : reply.error(interaction, `Nie ma nagrody za poziom **${level}**.`);
  }

  // dodaj
  const role = interaction.options.getRole('rola', true);
  const safety = rolePanels.checkRoleSafety(guild, role);
  if (!safety.ok) return reply.error(interaction, safety.reason);

  const existing = levelsRepo.listRewards(guild.id);
  if (existing.length >= MAX_REWARDS && !existing.some((reward) => reward.level === level)) {
    return reply.error(interaction, `Mozna ustawic maksymalnie **${MAX_REWARDS}** nagrod.`);
  }

  levelsRepo.setReward(guild.id, level, role.id);
  return reply.success(
    interaction,
    `Rola ${role} bedzie nadawana po osiagnieciu poziomu **${level}**. ` +
      'Osoby, ktore juz maja ten poziom, dostana ja przy nastepnym awansie.',
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poziomy')
    .setDescription('Ranking poziomow i konfiguracja XP')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('ranking')
        .setDescription('Ranking poziomow serwera')
        .addIntegerOption((option) =>
          option.setName('strona').setDescription('Numer strony').setMinValue(1).setMaxValue(1000).setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ustaw')
        .setDescription('Ustawienia systemu poziomow (admin)')
        .addBooleanOption((option) => option.setName('wlaczone').setDescription('Czy naliczac XP'))
        .addStringOption((option) =>
          option
            .setName('ogloszenia')
            .setDescription('Gdzie oglaszac awanse')
            .addChoices(
              { name: 'Na tym samym kanale', value: 'same' },
              { name: 'Na stalym kanale', value: 'channel' },
              { name: 'Wylaczone', value: 'off' },
            ),
        )
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal ogloszen awansow')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addNumberOption((option) =>
          option
            .setName('mnoznik')
            .setDescription('Mnoznik XP (np. 1.5)')
            .setMinValue(levelsService.MIN_MULTIPLIER)
            .setMaxValue(levelsService.MAX_MULTIPLIER),
        )
        .addBooleanOption((option) =>
          option
            .setName('zachowaj_poprzednie')
            .setDescription('Czy zostawiac poprzednie role nagrod po awansie'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('nagroda')
        .setDescription('Role nadawane za poziomy (admin)')
        .addSubcommand((sub) =>
          sub
            .setName('dodaj')
            .setDescription('Dodaje role nagrody za poziom')
            .addIntegerOption((option) =>
              option.setName('poziom').setDescription('Wymagany poziom').setMinValue(1).setMaxValue(500).setRequired(true),
            )
            .addRoleOption((option) => option.setName('rola').setDescription('Nadawana rola').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa nagrode za poziom')
            .addIntegerOption((option) =>
              option.setName('poziom').setDescription('Poziom nagrody').setMinValue(1).setMaxValue(500).setRequired(true),
            ),
        )
        .addSubcommand((sub) => sub.setName('lista').setDescription('Lista nagrod za poziomy')),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (!group && subcommand === 'ranking') {
      const page = (interaction.options.getInteger('strona') ?? 1) - 1;
      return reply.panel(interaction, levelsService.buildLeaderboard(interaction.guild, page), { ephemeral: false });
    }

    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Ta komenda wymaga uprawnien administratora (Zarzadzanie serwerem).');
    }

    if (group === 'nagroda') return handleReward(interaction, subcommand);
    return handleSettings(interaction);
  },
};
