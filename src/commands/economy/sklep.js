'use strict';

const {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const shopRepo = require('../../database/repositories/shop');
const economyService = require('../../services/economy');
const shopService = require('../../services/shop');
const { canManageRole, isAdmin } = require('../../utils/permissions');
const { COLORS, V2_FLAGS, panel, reply } = require('../../ui/components');
const { formatNumber, timestamp, truncate } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sklep')
    .setDescription('Sklep klanowy — wydawanie punktow')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('pokaz').setDescription('Wyswietla oferte sklepu'))
    .addSubcommand((sub) =>
      sub
        .setName('kup')
        .setDescription('Kupuje wybrany przedmiot')
        .addIntegerOption((option) =>
          option.setName('przedmiot').setDescription('Co kupujesz').setAutocomplete(true).setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('moje').setDescription('Pokazuje Twoje zakupy'))
    .addSubcommand((sub) =>
      sub
        .setName('dodaj')
        .setDescription('Dodaje przedmiot do sklepu (admin)')
        .addStringOption((option) =>
          option.setName('nazwa').setDescription('Nazwa przedmiotu').setMaxLength(80).setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('cena').setDescription('Cena w punktach').setMinValue(1).setMaxValue(10_000_000).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Rodzaj przedmiotu')
            .addChoices(
              { name: '🎭 Rola na stale', value: 'role' },
              { name: '⏳ Rola czasowa', value: 'temp_role' },
              { name: '🎁 Przedmiot wlasny (realizuje admin)', value: 'custom' },
            )
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('rola').setDescription('Rola nadawana po zakupie (dla typow rolowych)').setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('czas_godzin')
            .setDescription('Na ile godzin rola czasowa')
            .setMinValue(1)
            .setMaxValue(8760)
            .setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('opis').setDescription('Opis przedmiotu').setMaxLength(200).setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('Ile sztuk dostepnych (puste = bez limitu)')
            .setMinValue(1)
            .setMaxValue(100_000)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('edytuj')
        .setDescription('Zmienia przedmiot w sklepie (admin)')
        .addIntegerOption((option) =>
          option.setName('przedmiot').setDescription('Ktory przedmiot').setAutocomplete(true).setRequired(true),
        )
        .addStringOption((option) => option.setName('nazwa').setDescription('Nowa nazwa').setMaxLength(80))
        .addIntegerOption((option) => option.setName('cena').setDescription('Nowa cena').setMinValue(1).setMaxValue(10_000_000))
        .addStringOption((option) => option.setName('opis').setDescription('Nowy opis').setMaxLength(200))
        .addIntegerOption((option) => option.setName('limit').setDescription('Nowy limit sztuk').setMinValue(0).setMaxValue(100_000))
        .addBooleanOption((option) => option.setName('dostepny').setDescription('Czy przedmiot jest w sprzedazy')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('opublikuj')
        .setDescription('Publikuje panel sklepu na kanale (admin)')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Gdzie opublikowac (domyslnie biezacy kanal)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun')
        .setDescription('Usuwa przedmiot ze sklepu (admin)')
        .addIntegerOption((option) =>
          option.setName('przedmiot').setDescription('Ktory przedmiot').setAutocomplete(true).setRequired(true),
        ),
    ),

  async autocomplete(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const onlyEnabled = subcommand === 'kup';
    const focused = String(interaction.options.getFocused() ?? '').toLowerCase();

    const choices = shopRepo
      .listItems(interaction.guild.id, { onlyEnabled })
      .filter((item) => item.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((item) => ({ name: truncate(`${item.name} — ${formatNumber(item.price)}`, 100), value: item.id }));

    return interaction.respond(choices);
  },

  async execute(interaction) {
    const { guild } = interaction;
    const subcommand = interaction.options.getSubcommand();
    const settings = guilds.get(guild.id);

    if (!settings.economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze (`/ekonomia ustaw wlaczona:true`).');
    }

    // ─── Klient sklepu ──────────────────────────────────────────────────
    if (subcommand === 'pokaz') {
      const balance = economy.getBalance(guild.id, interaction.user.id);
      return reply.panel(interaction, shopService.buildShopPanel(guild, { balance, forAdmin: isAdmin(interaction.member) }));
    }

    if (subcommand === 'moje') {
      const purchases = shopRepo.listPurchases(guild.id, interaction.user.id, { limit: 10 });

      const blocks = purchases.length
        ? purchases.map((entry) => {
            const state = entry.expires_at
              ? entry.expired
                ? '⚪ wygaslo'
                : `⏳ wygasa ${timestamp(entry.expires_at, 'R')}`
              : '✅ na stale';
            return `**${entry.item_name}** — ${formatNumber(entry.price)} • ${state}\n-# ${timestamp(entry.created_at, 'f')}`;
          })
        : ['*Nie masz jeszcze zadnych zakupow.*'];

      return reply.panel(
        interaction,
        panel({
          color: COLORS.clan,
          title: '🧾 Twoje zakupy',
          description: `Saldo: ${economyService.formatCurrency(guild.id, economy.getBalance(guild.id, interaction.user.id))}`,
          blocks,
          footer: 'Oferta sklepu: /sklep pokaz',
        }),
      );
    }

    if (subcommand === 'kup') {
      const item = shopRepo.getItem(guild.id, interaction.options.getInteger('przedmiot', true));
      if (!item) return reply.error(interaction, 'Nie znalazlem tego przedmiotu w sklepie.');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await shopService.purchase({ guild, member: interaction.member, item });
      if (!result.ok) return reply.error(interaction, result.reason);

      await shopService.logPurchase(guild, interaction.user, item, result);

      return reply.panel(
        interaction,
        panel({
          color: COLORS.success,
          title: '🛒 Zakup udany',
          description: `Kupiono **${item.name}** za ${economyService.formatCurrency(guild.id, item.price, { short: true })}.`,
          fields: [
            { name: 'Saldo po zakupie', value: economyService.formatCurrency(guild.id, result.balance, { short: true }), inline: true },
            ...(result.role ? [{ name: 'Nadana rola', value: `${result.role}`, inline: true }] : []),
            ...(result.expiresAt ? [{ name: 'Wygasa', value: timestamp(result.expiresAt, 'R'), inline: true }] : []),
            ...(item.type === 'custom'
              ? [{ name: 'Realizacja', value: 'Administracja zrealizuje ten zakup recznie — zakup jest zapisany w historii.' }]
              : []),
          ],
          footer: `Transakcja #${result.transaction.id}`,
        }),
      );
    }

    // ─── Administracja sklepu ───────────────────────────────────────────
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply.error(interaction, 'Zarzadzanie sklepem wymaga uprawnienia **Zarzadzanie serwerem**.');
    }

    if (subcommand === 'dodaj') {
      const type = interaction.options.getString('typ', true);
      const role = interaction.options.getRole('rola');
      const durationHours = interaction.options.getInteger('czas_godzin');

      if ((type === 'role' || type === 'temp_role') && !role) {
        return reply.error(interaction, 'Dla przedmiotu rolowego musisz wskazac role (opcja `rola`).');
      }
      if (type === 'temp_role' && !durationHours) {
        return reply.error(interaction, 'Dla roli czasowej podaj czas w godzinach (opcja `czas_godzin`).');
      }
      if (role) {
        const check = canManageRole(guild, role);
        if (!check.ok) return reply.error(interaction, check.reason);
      }

      const item = shopRepo.addItem(guild.id, {
        name: interaction.options.getString('nazwa', true),
        description: interaction.options.getString('opis'),
        price: interaction.options.getInteger('cena', true),
        type,
        roleId: role?.id ?? null,
        durationHours: type === 'temp_role' ? durationHours : null,
        stock: interaction.options.getInteger('limit'),
      });

      return reply.panel(interaction, [
        shopService.buildShopPanel(guild, { forAdmin: true, notice: `✅ Dodano przedmiot **${item.name}** (ID ${item.id})` }),
      ]);
    }

    if (subcommand === 'edytuj') {
      const itemId = interaction.options.getInteger('przedmiot', true);
      const limit = interaction.options.getInteger('limit');

      const patch = {
        name: interaction.options.getString('nazwa') ?? undefined,
        description: interaction.options.getString('opis') ?? undefined,
        price: interaction.options.getInteger('cena') ?? undefined,
        stock: limit === null ? undefined : limit,
        enabled: interaction.options.getBoolean('dostepny') ?? undefined,
      };

      if (Object.values(patch).every((value) => value === undefined)) {
        return reply.error(interaction, 'Nie podano zadnej wartosci do zmiany.');
      }

      const item = shopRepo.updateItem(guild.id, itemId, patch);
      if (!item) return reply.error(interaction, 'Nie znalazlem tego przedmiotu.');

      return reply.panel(interaction, [
        shopService.buildShopPanel(guild, { forAdmin: true, notice: `✏️ Zaktualizowano **${item.name}**` }),
      ]);
    }

    if (subcommand === 'opublikuj') {
      const channel = interaction.options.getChannel('kanal') ?? interaction.channel;

      const permissions = channel.permissionsFor(guild.members.me);
      if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions?.has(PermissionFlagsBits.ViewChannel)) {
        return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
      }

      if (shopRepo.listItems(guild.id, { onlyEnabled: true }).length === 0) {
        return reply.error(interaction, 'Sklep nie ma jeszcze zadnych dostepnych przedmiotow (`/sklep dodaj`).');
      }

      const message = await channel.send({
        components: [shopService.buildShopPanel(guild)],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });

      guilds.update(guild.id, { economy_shop_channel_id: channel.id });
      return reply.success(interaction, `Panel sklepu opublikowany: ${message.url}`);
    }

    // usun
    const removed = shopRepo.removeItem(guild.id, interaction.options.getInteger('przedmiot', true));
    if (!removed) return reply.error(interaction, 'Nie znalazlem tego przedmiotu.');

    return reply.panel(interaction, [
      shopService.buildShopPanel(guild, { forAdmin: true, notice: `🗑️ Usunieto **${removed.name}** ze sklepu` }),
    ]);
  },
};
