'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const pollsRepo = require('../../database/repositories/polls');
const pollsService = require('../../services/polls');
const { V2_FLAGS, reply } = require('../../ui/components');
const { parseDuration, truncate } = require('../../utils/format');

const MIN_OPTIONS = 2;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ankieta')
    .setDescription('Tworzy ankiete z glosowaniem')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addStringOption((option) =>
      option
        .setName('pytanie')
        .setDescription('Tresc pytania (widoczna nad opcjami)')
        .setMaxLength(300)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('opcje')
        .setDescription('Opcje oddzielone znakiem "|" (2-10), np. Tak|Nie|Nie wiem')
        .setMaxLength(1500)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('czas')
        .setDescription('Automatyczne zamkniecie po tym czasie (np. 30m, 2h, 1d). Pusty = bez limitu.')
        .setMaxLength(20)
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('wielokrotny')
        .setDescription('Czy mozna wybrac kilka opcji (domyslnie: nie)')
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('anonimowa')
        .setDescription('Wyniki ukryte do zamkniecia (domyslnie: tak)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const question = interaction.options.getString('pytanie', true).trim();
    const rawOptions = interaction.options.getString('opcje', true);
    const czas = interaction.options.getString('czas');
    const multi = interaction.options.getBoolean('wielokrotny') ?? false;
    const anonymous = interaction.options.getBoolean('anonimowa') ?? true;

    const options = rawOptions
      .split('|')
      .map((option) => truncate(option.trim(), 100))
      .filter((option) => option.length > 0);

    if (options.length < MIN_OPTIONS) {
      return reply.error(interaction, `Podaj co najmniej **${MIN_OPTIONS}** opcje oddzielone znakiem \`|\`.`);
    }
    if (options.length > pollsService.MAX_OPTIONS) {
      return reply.error(interaction, `Maksymalnie **${pollsService.MAX_OPTIONS}** opcji.`);
    }
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      return reply.error(interaction, 'Opcje musza byc unikalne.');
    }

    let endsAt = null;
    if (czas) {
      const durationMs = parseDuration(czas);
      if (!durationMs) {
        return reply.error(interaction, 'Nie rozumiem podanego czasu. Uzyj formatu jak `30m`, `2h`, `1d`.');
      }
      if (durationMs < 60 * 1000) {
        return reply.error(interaction, 'Minimalny czas ankiety to 1 minuta.');
      }
      endsAt = Date.now() + durationMs;
    }

    const channel = interaction.channel;
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
      return reply.error(interaction, 'Nie mam uprawnien do pisania na tym kanale.');
    }

    const poll = pollsRepo.create({
      guildId: interaction.guild.id,
      channelId: channel.id,
      authorId: interaction.user.id,
      question,
      options,
      multi,
      anonymous,
      endsAt,
    });

    const message = await channel.send({
      components: [pollsService.buildPanel(poll)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
    pollsRepo.setMessage(poll.id, message.id);

    return reply.success(interaction, `Ankieta opublikowana: ${message.url}`);
  },
};
