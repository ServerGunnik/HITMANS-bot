'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const birthdaysRepo = require('../../database/repositories/birthdays');
const birthdays = require('../../services/birthdays');
const { isAdmin, canManageRole } = require('../../utils/permissions');
const { reply } = require('../../ui/components');

const MONTH_CHOICES = birthdays.MONTHS.map((name, index) => ({ name, value: index + 1 }));
const UPCOMING_DAYS = 30;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urodziny')
    .setDescription('Urodziny czlonkow klanu')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('ustaw')
        .setDescription('Zapisuje date Twoich urodzin')
        .addIntegerOption((option) =>
          option.setName('dzien').setDescription('Dzien miesiaca').setMinValue(1).setMaxValue(31).setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('miesiac').setDescription('Miesiac').addChoices(...MONTH_CHOICES).setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('rok').setDescription('Rok urodzenia (opcjonalnie — pokazemy wiek)').setMinValue(1900).setMaxValue(2100),
        ),
    )
    .addSubcommand((sub) => sub.setName('usun').setDescription('Usuwa Twoja date urodzin'))
    .addSubcommand((sub) => sub.setName('lista').setDescription(`Urodziny w ciagu najblizszych ${UPCOMING_DAYS} dni`))
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Kanal na zyczenia i rola na dzien urodzin (admin)')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Gdzie wysylac zyczenia (codziennie ok. 9:00)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rola').setDescription('Rola nadawana solenizantom na jeden dzien (puste = bez roli)'),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'ustaw') {
      const day = interaction.options.getInteger('dzien');
      const month = interaction.options.getInteger('miesiac');
      const year = interaction.options.getInteger('rok');
      const today = birthdays.warsawParts();

      const check = birthdays.validate(day, month, year, today.year);
      if (!check.ok) return reply.error(interaction, check.reason);

      const entry = birthdaysRepo.set(guildId, interaction.user.id, { day, month, year });
      const inDays = birthdays.daysUntil(entry, today);
      const note = entry.month === 2 && entry.day === 29 ? '\nW latach nieprzestepnych swietujemy 28 lutego.' : '';
      return reply.success(
        interaction,
        `Zapisano urodziny: **${birthdays.formatDay(entry)}${year ? `.${year}` : ''}**. ` +
          (inDays === 0 ? 'To dzisiaj — wszystkiego najlepszego! 🎂' : `Do najblizszych zostalo ${inDays} dni.`) +
          note,
      );
    }

    if (sub === 'usun') {
      const removed = birthdaysRepo.remove(guildId, interaction.user.id);
      return removed
        ? reply.success(interaction, 'Usunieto Twoja date urodzin.')
        : reply.info(interaction, 'Nie masz zapisanej daty urodzin.');
    }

    if (sub === 'lista') {
      const list = birthdays.upcoming(birthdaysRepo.listByGuild(guildId), birthdays.warsawParts(), UPCOMING_DAYS);
      return reply.panel(interaction, birthdays.buildList(interaction.guild.name, list, UPCOMING_DAYS));
    }

    if (sub === 'kanal') {
      if (!isAdmin(interaction.member)) {
        return reply.error(interaction, 'Ta opcja jest dostepna tylko dla administracji.');
      }

      const channel = interaction.options.getChannel('kanal');
      const role = interaction.options.getRole('rola');

      const permissions = channel.permissionsFor?.(interaction.guild.members.me);
      if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages))) {
        return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
      }
      if (role) {
        const check = canManageRole(interaction.guild, role);
        if (!check.ok) return reply.error(interaction, check.reason);
      }

      birthdaysRepo.updateSettings(guildId, { channel_id: channel.id, role_id: role?.id ?? null });
      return reply.success(
        interaction,
        `Zyczenia beda wysylane na ${channel} codziennie ok. ${birthdays.POST_HOUR}:00 (czas polski).` +
          (role ? `\nSolenizanci dostana role ${role} na caly dzien.` : ''),
      );
    }

    return reply.error(interaction, 'Nieznana podkomenda.');
  },
};
