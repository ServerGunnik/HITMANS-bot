'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const serverLogs = require('../../services/serverLogs');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

/**
 * Reczne przyznawanie i odbieranie punktow przez administracje.
 * Plik eksportuje dwie komendy (`/dodaj-punkty`, `/odejmij-punkty`),
 * bo dziela cala logike poza znakiem operacji.
 */
function buildCommand({ name, description, verb }) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option.setName('uzytkownik').setDescription(`Komu ${verb} punkty`).setRequired(true))
    .addIntegerOption((option) =>
      option.setName('kwota').setDescription('Liczba punktow').setMinValue(1).setMaxValue(1_000_000).setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('powod').setDescription('Powod (widoczny w historii)').setMaxLength(200).setRequired(false),
    );
}

async function execute(interaction, { mode }) {
  const { guild } = interaction;

  if (!guilds.get(guild.id).economy_enabled) {
    return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze (`/ekonomia ustaw wlaczona:true`).');
  }

  const target = interaction.options.getUser('uzytkownik', true);
  const amount = interaction.options.getInteger('kwota', true);
  const reason = interaction.options.getString('powod');

  if (target.bot) return reply.error(interaction, 'Boty nie maja kont w ekonomii klanowej.');

  const payload = {
    guildId: guild.id,
    userId: target.id,
    amount,
    actorId: interaction.user.id,
    reason: reason ? truncate(reason, 200) : null,
  };

  const result = mode === 'add' ? economy.grant(payload) : economy.take(payload);

  if (!result.ok) {
    return reply.error(interaction, `**${target.tag}** ma puste konto — nie ma czego odjac.`);
  }

  const applied = result.applied ?? amount;

  await serverLogs.logEconomy(guild, {
    title: mode === 'add' ? 'Reczne przyznanie punktow' : 'Reczne odjecie punktow',
    fields: [
      { name: 'Czlonek', value: serverLogs.describeUser(target) },
      { name: 'Administrator', value: serverLogs.describeUser(interaction.user) },
      { name: 'Kwota', value: economyService.formatCurrency(guild.id, applied, { short: true }), inline: true },
      { name: 'Nowe saldo', value: economyService.formatCurrency(guild.id, result.balance, { short: true }), inline: true },
      ...(reason ? [{ name: 'Powod', value: truncate(reason, 300) }] : []),
    ],
    footer: `Transakcja #${result.transaction.id} • cofniecie: /ekonomia cofnij id:${result.transaction.id}`,
  });

  const container = panel({
    color: mode === 'add' ? COLORS.success : COLORS.warning,
    title: mode === 'add' ? '➕ Punkty przyznane' : '➖ Punkty odjete',
    description: `${target} • wykonal(a): ${interaction.user}`,
    fields: [
      { name: 'Kwota', value: economyService.formatCurrency(guild.id, applied), inline: true },
      {
        name: 'Nowe saldo',
        value: economyService.formatCurrency(guild.id, result.balance, { short: true }),
        inline: true,
      },
      ...(result.partial
        ? [{ name: 'Uwaga', value: `Konto mialo mniej punktow — odjeto ${applied} z ${amount}.` }]
        : []),
      ...(reason ? [{ name: 'Powod', value: truncate(reason, 300) }] : []),
    ],
    footer: `Transakcja #${result.transaction.id} • cofniecie: /ekonomia cofnij id:${result.transaction.id}`,
  });

  return reply.panel(interaction, container, { ephemeral: false, allowedMentions: { users: [target.id] } });
}

module.exports = [
  {
    data: buildCommand({
      name: 'dodaj-punkty',
      description: 'Przyznaje punkty klanowe wybranej osobie',
      verb: 'przyznac',
    }),
    execute: (interaction) => execute(interaction, { mode: 'add' }),
  },
  {
    data: buildCommand({
      name: 'odejmij-punkty',
      description: 'Odejmuje punkty klanowe wybranej osobie',
      verb: 'odjac',
    }),
    execute: (interaction) => execute(interaction, { mode: 'remove' }),
  },
];
