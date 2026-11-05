'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const remindersRepo = require('../../database/repositories/reminders');
const remindersService = require('../../services/reminders');
const { COLORS, panel, reply } = require('../../ui/components');
const { timestamp, truncate } = require('../../utils/format');
const { parseTime, TIME_HELP } = require('../../utils/time');

const MIN_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;

/** Wylicza termin przypomnienia z opcji za/kiedy. Zwraca { at } albo { error }. */
function resolveRemindAt({ za, kiedy }, now = Date.now()) {
  if (!za && !kiedy) return { error: `Podaj \`za\` (np. \`2h\`) albo \`kiedy\` (np. \`jutro 20:00\`).` };
  if (za && kiedy) return { error: 'Podaj tylko jedna z opcji: `za` albo `kiedy`.' };

  const at = za ? parseTime(/^\s*za\b/i.test(za) ? za : `za ${za}`, { now }) : parseTime(kiedy, { now });
  if (!at) return { error: `Nie rozumiem podanego czasu. ${TIME_HELP}` };
  if (at - now < MIN_DELAY_MS) return { error: 'Przypomnienie musi byc co najmniej minute w przyszlosci.' };
  if (at - now > MAX_DELAY_MS) return { error: 'Przypomnienie mozna ustawic maksymalnie rok do przodu.' };
  return { at };
}

const przypomnij = {
  data: new SlashCommandBuilder()
    .setName('przypomnij')
    .setDescription('Ustawia przypomnienie (DM, a gdy zablokowane — na tym kanale)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('tresc').setDescription('O czym przypomniec').setMaxLength(1000).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('za').setDescription('Za ile, np. 30m, 2h, 1d12h').setMaxLength(30).setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('kiedy')
        .setDescription('Konkretny termin (czas PL), np. jutro 20:00, 2026-11-20 18:00')
        .setMaxLength(40)
        .setRequired(false),
    ),

  cooldown: 3,

  async execute(interaction) {
    const content = interaction.options.getString('tresc', true).trim();
    const resolved = resolveRemindAt({
      za: interaction.options.getString('za'),
      kiedy: interaction.options.getString('kiedy'),
    });
    if (resolved.error) return reply.error(interaction, resolved.error);

    if (remindersRepo.countForUser(interaction.guild.id, interaction.user.id) >= remindersService.MAX_PER_USER) {
      return reply.error(
        interaction,
        `Masz juz **${remindersService.MAX_PER_USER}** aktywnych przypomnien. Usun ktores przez \`/przypomnienia usun\`.`,
      );
    }

    const reminder = remindersRepo.create({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      userId: interaction.user.id,
      content,
      remindAt: resolved.at,
    });

    return reply.success(
      interaction,
      `Przypomne Ci ${timestamp(reminder.remind_at, 'R')} (${timestamp(reminder.remind_at, 'f')}).\n> ${truncate(content, 200)}`,
      { footer: `Przypomnienie #${reminder.id} · wysle je w DM, a gdy beda zablokowane — na tym kanale.` },
    );
  },
};

const przypomnienia = {
  data: new SlashCommandBuilder()
    .setName('przypomnienia')
    .setDescription('Twoje aktywne przypomnienia')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('lista').setDescription('Pokazuje Twoje przypomnienia'))
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa przypomnienie')
        .addIntegerOption((option) => option.setName('id').setDescription('Numer przypomnienia (#id)').setMinValue(1).setRequired(true)),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { guild, user } = interaction;

    if (subcommand === 'usun') {
      const id = interaction.options.getInteger('id', true);
      if (!remindersRepo.removeForUser(guild.id, user.id, id)) {
        return reply.error(interaction, `Nie masz przypomnienia **#${id}**.`);
      }
      return reply.success(interaction, `Usunieto przypomnienie **#${id}**.`);
    }

    const list = remindersRepo.listForUser(guild.id, user.id);
    const lines = list.map(
      (reminder) =>
        `\`#${reminder.id}\` ${timestamp(reminder.remind_at, 'f')} (${timestamp(reminder.remind_at, 'R')}) — ${truncate(reminder.content, 80)}`,
    );

    return reply.panel(
      interaction,
      panel({
        color: COLORS.info,
        title: '⏰ Twoje przypomnienia',
        description: lines.length ? lines.join('\n') : '*Nie masz aktywnych przypomnien.*',
        footer: `${list.length}/${remindersService.MAX_PER_USER} · nowe: /przypomnij`,
      }),
    );
  },
};

module.exports = [przypomnij, przypomnienia];
module.exports.resolveRemindAt = resolveRemindAt;
