'use strict';

const { ChannelType, InteractionContextType, SlashCommandBuilder } = require('discord.js');

const activityRepo = require('../../database/repositories/clanActivity');
const leavesRepo = require('../../database/repositories/leaves');
const inactivity = require('../../services/inactivity');
const leaves = require('../../services/leaves');
const { checkSelfAssignableRole, isAdmin } = require('../../utils/permissions');
const { parseLeaveDate, DAY_MS } = require('../../utils/clanTime');
const { reply } = require('../../ui/components');
const { timestamp } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urlop')
    .setDescription('Zgloszenie nieobecnosci w klanie')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('zglos')
        .setDescription('Zglasza (albo przedluza) Twoj urlop')
        .addStringOption((option) =>
          option
            .setName('do')
            .setDescription('Do kiedy, np. 2026-11-20, 20.11 albo za 7d')
            .setRequired(true)
            .setMaxLength(30),
        )
        .addStringOption((option) =>
          option.setName('powod').setDescription('Powod nieobecnosci').setRequired(true).setMaxLength(300),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('koniec')
        .setDescription('Konczy Twoj urlop (oficer moze zakonczyc urlop innej osoby)')
        .addUserOption((option) =>
          option.setName('uzytkownik').setDescription('Czyj urlop zakonczyc (tylko oficerowie)').setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName('lista').setDescription('Lista trwajacych urlopow (oficerowie)'))
    .addSubcommand((sub) =>
      sub
        .setName('ustawienia')
        .setDescription('Rola urlopowa i kanal powiadomien kadry (admin)')
        .addRoleOption((option) =>
          option.setName('rola').setDescription('Rola nadawana na czas urlopu').setRequired(false),
        )
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal powiadomien dla oficerow (domyslnie kanal logow moderacji)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('wyczysc').setDescription('Usun ustawiona role urlopowa i kanal').setRequired(false),
        ),
    ),

  cooldown: 3,

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (subcommand === 'zglos') {
      const input = interaction.options.getString('do', true);
      const reason = interaction.options.getString('powod', true).trim();
      const now = Date.now();
      const endsAt = parseLeaveDate(input, now);

      if (!endsAt) {
        return reply.error(interaction, `Nie rozumiem daty \`${input}\`. Uzyj np. \`2026-11-20\`, \`20.11\` albo \`za 7d\`.`);
      }
      if (endsAt <= now) return reply.error(interaction, 'Data konca urlopu musi byc w przyszlosci.');
      if (endsAt - now > leaves.MAX_LEAVE_DAYS * DAY_MS) {
        return reply.error(interaction, `Urlop moze trwac maksymalnie ${leaves.MAX_LEAVE_DAYS} dni.`);
      }
      if (!reason) return reply.error(interaction, 'Podaj powod urlopu.');

      const { leave, updated, roleWarning } = await leaves.startLeave(guild, interaction.member, { endsAt, reason });
      return reply.success(
        interaction,
        `${updated ? 'Zaktualizowano urlop' : 'Zgloszono urlop'} do ${timestamp(leave.ends_at, 'D')} ` +
          `(${timestamp(leave.ends_at, 'R')}). Kadra zostala powiadomiona.` +
          (roleWarning ? `\n⚠️ ${roleWarning}` : ''),
        { footer: `Urlop #${leave.id} • zakonczysz go wczesniej przez /urlop koniec` },
      );
    }

    if (subcommand === 'koniec') {
      const target = interaction.options.getUser('uzytkownik') ?? interaction.user;
      const self = target.id === interaction.user.id;
      if (!self && !inactivity.isOfficer(interaction.member)) {
        return reply.error(interaction, 'Tylko oficerowie moga konczyc urlopy innych osob.');
      }

      const leave = leavesRepo.getActive(guild.id, target.id);
      if (!leave) {
        return reply.info(interaction, self ? 'Nie jestes teraz na urlopie.' : `${target} nie jest teraz na urlopie.`);
      }

      await leaves.endLeave(guild, leave, { reason: self ? 'manual' : 'officer', endedBy: interaction.user.id });
      return reply.success(interaction, self ? 'Witaj z powrotem! Twoj urlop zostal zakonczony.' : `Zakonczono urlop ${target}.`);
    }

    if (subcommand === 'lista') {
      if (!inactivity.isOfficer(interaction.member)) {
        return reply.error(interaction, 'Lista urlopow jest dostepna tylko dla oficerow i administracji.');
      }
      return reply.panel(interaction, leaves.buildLeaveList(leavesRepo.listActive(guild.id)));
    }

    // ustawienia
    if (!isAdmin(interaction.member)) {
      return reply.error(interaction, 'Ustawienia urlopow moze zmieniac tylko administracja.');
    }

    const role = interaction.options.getRole('rola');
    const channel = interaction.options.getChannel('kanal');
    const clear = interaction.options.getBoolean('wyczysc') ?? false;

    if (clear) {
      activityRepo.updateSettings(guild.id, { leave_role_id: null, officer_channel_id: null });
      return reply.success(interaction, 'Usunieto role urlopowa i kanal powiadomien (uzywany bedzie kanal logow moderacji).');
    }

    if (role) {
      const check = checkSelfAssignableRole(guild, role);
      if (!check.ok) return reply.error(interaction, check.reason);
    }

    const patch = {};
    if (role) patch.leave_role_id = role.id;
    if (channel) patch.officer_channel_id = channel.id;
    const settings = activityRepo.updateSettings(guild.id, patch);
    const channelId = leaves.officerChannelId(guild.id);

    return reply.info(
      interaction,
      `Rola urlopowa: ${settings.leave_role_id ? `<@&${settings.leave_role_id}>` : 'brak'}\n` +
        `Kanal powiadomien: ${channelId ? `<#${channelId}>` : 'brak (ustaw kanal albo kanal logow moderacji)'}`,
      { title: 'Ustawienia urlopow' },
    );
  },
};
