'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const serverLogs = require('../../services/serverLogs');
const { COLORS, panel, reply } = require('../../ui/components');
const { formatNumber, humanDuration, timestamp, truncate } = require('../../utils/format');

const TYPE_LABELS = {
  transfer: '💸 przelew',
  admin_add: '➕ przyznanie',
  admin_remove: '➖ odjecie',
  earn_message: '💬 nagroda za czat',
  earn_voice: '🔊 nagroda glosowa',
  shop_purchase: '🛒 zakup',
  revert: '↩️ cofniecie',
};

/** Jedna linia historii transakcji. */
function renderTransaction(guildId, entry) {
  const parties = [
    entry.from_user_id ? `<@${entry.from_user_id}>` : '*system*',
    entry.to_user_id ? `<@${entry.to_user_id}>` : '*skasowane*',
  ].join(' → ');

  const status = entry.reverted ? ' • ⚠️ **cofnieta**' : '';
  const reason = entry.reason ? `\n-# ${truncate(entry.reason, 120)}` : '';

  return (
    `\`#${entry.id}\` ${TYPE_LABELS[entry.type] ?? entry.type} • ` +
    `${economyService.formatCurrency(guildId, entry.amount, { short: true })}${status}\n` +
    `${parties} • ${timestamp(entry.created_at, 'R')}${reason}`
  );
}

function buildOverview(guild) {
  const settings = guilds.get(guild.id);

  return panel({
    color: settings.economy_enabled ? COLORS.success : COLORS.neutral,
    title: '💰 Ekonomia klanowa',
    description: settings.economy_enabled
      ? `Waluta: ${settings.currency_emoji} **${settings.currency_name}**`
      : 'Ekonomia jest **wylaczona**. Wlacz ja komenda `/ekonomia ustaw wlaczona:true`.',
    fields: [
      {
        name: 'Zarobek za aktywnosc',
        value:
          `Za wiadomosc: **${formatNumber(settings.economy_message_reward)}** ` +
          `(cooldown ${humanDuration((settings.economy_message_cooldown ?? 60) * 1000)})\n` +
          `Za minute na kanale glosowym: **${formatNumber(settings.economy_voice_reward)}** ` +
          `(min. ${settings.economy_voice_min_members} osob na kanale)`,
      },
      {
        name: 'Zasady',
        value:
          `Saldo startowe: **${formatNumber(settings.economy_start_balance)}**\n` +
          `Minimalny przelew: **${formatNumber(settings.economy_transfer_min)}**`,
      },
      {
        name: 'Stan',
        value:
          `Kont: **${formatNumber(economy.countAccounts(guild.id))}**\n` +
          `W obiegu: ${economyService.formatCurrency(guild.id, economy.totalCirculation(guild.id), { short: true })}`,
      },
    ],
    footer: 'Historia: /ekonomia historia • Cofanie: /ekonomia cofnij • Sklep: /sklep',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ekonomia')
    .setDescription('Konfiguracja i nadzor nad ekonomia klanowa')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('pokaz').setDescription('Ustawienia i stan ekonomii'))
    .addSubcommand((sub) =>
      sub
        .setName('ustaw')
        .setDescription('Zmienia ustawienia ekonomii')
        .addBooleanOption((option) => option.setName('wlaczona').setDescription('Wlacz/wylacz ekonomie'))
        .addStringOption((option) =>
          option.setName('nazwa_waluty').setDescription('np. Punkty klanowe').setMaxLength(40),
        )
        .addStringOption((option) => option.setName('emoji_waluty').setDescription('np. 🪙').setMaxLength(16))
        .addIntegerOption((option) =>
          option.setName('nagroda_wiadomosc').setDescription('Punkty za wiadomosc (0 = wylaczone)').setMinValue(0).setMaxValue(1000),
        )
        .addIntegerOption((option) =>
          option
            .setName('cooldown_wiadomosc')
            .setDescription('Co ile sekund mozna zarobic za wiadomosc')
            .setMinValue(0)
            .setMaxValue(86_400),
        )
        .addIntegerOption((option) =>
          option.setName('nagroda_glosowa').setDescription('Punkty za minute na kanale glosowym (0 = wylaczone)').setMinValue(0).setMaxValue(1000),
        )
        .addIntegerOption((option) =>
          option
            .setName('min_osob_glosowy')
            .setDescription('Ile osob musi byc na kanale, by naliczac punkty')
            .setMinValue(1)
            .setMaxValue(50),
        )
        .addIntegerOption((option) =>
          option.setName('saldo_startowe').setDescription('Ile punktow dostaje nowe konto').setMinValue(0).setMaxValue(1_000_000),
        )
        .addIntegerOption((option) =>
          option.setName('min_przelew').setDescription('Minimalna kwota przelewu').setMinValue(1).setMaxValue(1_000_000),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('historia')
        .setDescription('Historia transakcji (cala lub wybranego czlonka)')
        .addUserOption((option) => option.setName('uzytkownik').setDescription('Czyje transakcje pokazac'))
        .addBooleanOption((option) =>
          option.setName('tylko_przelewy').setDescription('Pomin nagrody za aktywnosc (domyslnie: tak)'),
        )
        .addIntegerOption((option) =>
          option.setName('ile').setDescription('Ile wpisow pokazac (1-15)').setMinValue(1).setMaxValue(15),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cofnij')
        .setDescription('Cofa transakcje i zwraca punkty (naduzycia)')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('Numer transakcji z historii').setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Kasuje wszystkie salda i historie na tym serwerze')
        .addBooleanOption((option) =>
          option.setName('potwierdzam').setDescription('Zaznacz, aby potwierdzic — operacja jest nieodwracalna').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'pokaz') {
      return reply.panel(interaction, buildOverview(guild));
    }

    if (subcommand === 'ustaw') {
      // Kazda opcja ma swoj typ — getBoolean() na opcji tekstowej rzuca bledem,
      // dlatego trzymamy typ obok nazwy kolumny.
      const mapping = [
        ['wlaczona', 'economy_enabled', 'boolean'],
        ['nazwa_waluty', 'currency_name', 'string'],
        ['emoji_waluty', 'currency_emoji', 'string'],
        ['nagroda_wiadomosc', 'economy_message_reward', 'integer'],
        ['cooldown_wiadomosc', 'economy_message_cooldown', 'integer'],
        ['nagroda_glosowa', 'economy_voice_reward', 'integer'],
        ['min_osob_glosowy', 'economy_voice_min_members', 'integer'],
        ['saldo_startowe', 'economy_start_balance', 'integer'],
        ['min_przelew', 'economy_transfer_min', 'integer'],
      ];

      const getters = {
        boolean: (name) => interaction.options.getBoolean(name),
        string: (name) => interaction.options.getString(name),
        integer: (name) => interaction.options.getInteger(name),
      };

      const patch = {};
      for (const [option, column, type] of mapping) {
        const value = getters[type](option);
        if (value !== null && value !== undefined) patch[column] = value;
      }

      if (Object.keys(patch).length === 0) {
        return reply.error(interaction, 'Nie podano zadnej opcji do zmiany.');
      }

      guilds.update(guild.id, patch);
      return reply.panel(interaction, buildOverview(guild));
    }

    if (subcommand === 'historia') {
      const user = interaction.options.getUser('uzytkownik');
      const onlyTransfers = interaction.options.getBoolean('tylko_przelewy') ?? true;
      const limit = interaction.options.getInteger('ile') ?? 10;

      const entries = economy.history(guild.id, {
        userId: user?.id ?? null,
        types: onlyTransfers ? ['transfer', 'admin_add', 'admin_remove', 'shop_purchase', 'revert'] : null,
        limit,
      });

      const container = panel({
        color: COLORS.info,
        title: user ? `📒 Historia transakcji — ${user.username}` : '📒 Historia transakcji',
        description: entries.length
          ? `Ostatnie **${entries.length}** operacji${onlyTransfers ? ' (bez nagrod za aktywnosc)' : ''}.`
          : '*Brak transakcji spelniajacych kryteria.*',
        blocks: entries.map((entry) => renderTransaction(guild.id, entry)),
        footer: 'Cofniecie naduzycia: /ekonomia cofnij id:<numer>',
      });

      return reply.panel(interaction, container);
    }

    if (subcommand === 'cofnij') {
      const id = interaction.options.getInteger('id', true);
      const result = economy.revert(guild.id, id, interaction.user.id);

      if (!result.ok) {
        const reasons = {
          not_found: `Nie znalazlem transakcji **#${id}** na tym serwerze.`,
          already_reverted: `Transakcja **#${id}** zostala juz cofnieta.`,
          not_revertible: `Transakcji typu \`${result.transaction?.type}\` nie mozna cofnac. ` +
            'Cofac mozna przelewy oraz reczne zmiany sald.',
          no_funds: 'Odbiorca nie ma juz zadnych punktow — nie ma czego odzyskac.',
        };
        return reply.error(interaction, reasons[result.reason] ?? 'Nie udalo sie cofnac tej transakcji.');
      }

      const original = result.transaction;

      await serverLogs.logEconomy(guild, {
        title: 'Cofnieto transakcje',
        color: COLORS.warning,
        fields: [
          { name: 'Transakcja', value: `#${original.id} • ${TYPE_LABELS[original.type] ?? original.type}` },
          { name: 'Administrator', value: serverLogs.describeUser(interaction.user) },
          { name: 'Odzyskana kwota', value: formatNumber(result.amount), inline: true },
          ...(original.from_user_id ? [{ name: 'Nadawca', value: `<@${original.from_user_id}>`, inline: true }] : []),
          ...(original.to_user_id ? [{ name: 'Odbiorca', value: `<@${original.to_user_id}>`, inline: true }] : []),
          ...(result.partial
            ? [{ name: 'Uwaga', value: `Cofniecie czesciowe: ${formatNumber(result.amount)} z ${formatNumber(original.amount)}` }]
            : []),
        ],
        footer: `Wpis korygujacy #${result.counter.id}`,
      });

      const container = panel({
        color: COLORS.warning,
        title: '↩️ Transakcja cofnieta',
        description: `Transakcja **#${original.id}** (${TYPE_LABELS[original.type] ?? original.type}) zostala cofnieta.`,
        fields: [
          { name: 'Odzyskana kwota', value: economyService.formatCurrency(guild.id, result.amount), inline: true },
          ...(result.partial
            ? [
                {
                  name: '⚠️ Cofniecie czesciowe',
                  value:
                    `Odbiorca zdazyl wydac czesc srodkow — odzyskano ${formatNumber(result.amount)} ` +
                    `z ${formatNumber(original.amount)}.`,
                },
              ]
            : []),
          { name: 'Wpis korygujacy', value: `#${result.counter.id}`, inline: true },
        ],
        footer: `Cofniete przez ${interaction.user.tag}`,
      });

      return reply.panel(interaction, container, { ephemeral: false });
    }

    // reset
    if (!interaction.options.getBoolean('potwierdzam', true)) {
      return reply.error(interaction, 'Operacja anulowana — zaznacz `potwierdzam: true`, aby wyzerowac ekonomie.');
    }

    const removed = economy.resetGuild(guild.id);
    return reply.success(
      interaction,
      `Wyzerowano ekonomie: usunieto **${removed.accounts}** kont i **${removed.transactions}** wpisow historii.`,
    );
  },

  buildOverview,
};
