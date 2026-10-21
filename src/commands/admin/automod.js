'use strict';

const { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const moderation = require('../../database/repositories/moderation');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

const ACTION_LABELS = {
  delete: 'tylko usuniecie wiadomosci',
  warn: 'usuniecie + ostrzezenie',
  timeout: 'usuniecie + wyciszenie',
};

function buildOverview(guild) {
  const settings = guilds.get(guild.id);
  const words = moderation.listBlockedWords(guild.id);

  const toggle = (value) => (value ? '🟢 wlaczony' : '⚪ wylaczony');

  return panel({
    color: settings.automod_enabled ? COLORS.success : COLORS.neutral,
    title: '🤖 Automoderacja',
    description: settings.automod_enabled
      ? 'Automoderacja jest **wlaczona** na tym serwerze.'
      : 'Automoderacja jest **wylaczona**. Wlacz ja komenda `/automod ustaw wlaczona:true`.',
    fields: [
      {
        name: 'Filtry',
        value:
          `Wulgaryzmy / zabronione slowa: ${toggle(settings.automod_words)} (**${words.length}** slow)\n` +
          `Linki: ${toggle(settings.automod_links)}\n` +
          `Zaproszenia Discord: ${toggle(settings.automod_invites)}\n` +
          `Spam: ${toggle(settings.automod_spam)} (**${settings.automod_spam_messages}** wiadomosci / **${settings.automod_spam_seconds}** s)`,
      },
      {
        name: 'Reakcja na naruszenie',
        value:
          `${ACTION_LABELS[settings.automod_action] ?? settings.automod_action}` +
          (settings.automod_action === 'timeout' ? ` (**${settings.automod_timeout_minutes}** min)` : ''),
      },
      {
        name: 'Role zwolnione z filtrow',
        value: settings.automod_exempt_roles.length
          ? settings.automod_exempt_roles.map((id) => `<@&${id}>`).join(' ')
          : '*brak* — osoby z uprawnieniem Zarzadzanie wiadomosciami sa zwolnione zawsze',
      },
      {
        name: 'Dozwolone domeny',
        value: settings.automod_link_whitelist.length
          ? truncate(settings.automod_link_whitelist.map((domain) => `\`${domain}\``).join(', '), 900)
          : '*brak* — przy wlaczonym filtrze linkow blokowane sa wszystkie adresy',
      },
    ],
    footer: 'Konfiguracja: /automod ustaw • Slowa: /automod slowa • Domeny: /automod domeny',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Automoderacja: filtr wulgaryzmow, linkow, zaproszen i spamu')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('pokaz').setDescription('Pokazuje ustawienia automoderacji'))
    .addSubcommand((sub) =>
      sub
        .setName('ustaw')
        .setDescription('Zmienia ustawienia automoderacji')
        .addBooleanOption((option) => option.setName('wlaczona').setDescription('Wlacz/wylacz automoderacje'))
        .addBooleanOption((option) => option.setName('slowa').setDescription('Filtr zabronionych slow'))
        .addBooleanOption((option) => option.setName('linki').setDescription('Filtr linkow'))
        .addBooleanOption((option) => option.setName('zaproszenia').setDescription('Filtr zaproszen na inne serwery'))
        .addBooleanOption((option) => option.setName('spam').setDescription('Filtr spamu'))
        .addStringOption((option) =>
          option
            .setName('akcja')
            .setDescription('Co zrobic przy naruszeniu')
            .addChoices(
              { name: 'Usun wiadomosc', value: 'delete' },
              { name: 'Usun + ostrzezenie', value: 'warn' },
              { name: 'Usun + wyciszenie', value: 'timeout' },
            ),
        )
        .addIntegerOption((option) =>
          option.setName('timeout_minut').setDescription('Dlugosc wyciszenia w minutach (1-10080)').setMinValue(1).setMaxValue(10080),
        )
        .addIntegerOption((option) =>
          option.setName('spam_wiadomosci').setDescription('Ile wiadomosci uznajemy za spam (2-20)').setMinValue(2).setMaxValue(20),
        )
        .addIntegerOption((option) =>
          option.setName('spam_sekundy').setDescription('W jakim oknie czasowym (1-60 s)').setMinValue(1).setMaxValue(60),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('slowa')
        .setDescription('Lista zabronionych slow')
        .addSubcommand((sub) => sub.setName('lista').setDescription('Pokazuje zabronione slowa'))
        .addSubcommand((sub) =>
          sub
            .setName('dodaj')
            .setDescription('Dodaje slowo do filtra')
            .addStringOption((option) =>
              option.setName('slowo').setDescription('Slowo lub fraza (mozna podac kilka po przecinku)').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa slowo z filtra')
            .addStringOption((option) => option.setName('slowo').setDescription('Slowo do usuniecia').setRequired(true)),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('wyjatki')
        .setDescription('Role zwolnione z automoderacji')
        .addSubcommand((sub) =>
          sub
            .setName('dodaj')
            .setDescription('Dodaje role do wyjatkow')
            .addRoleOption((option) => option.setName('rola').setDescription('Rola').setRequired(true)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa role z wyjatkow')
            .addRoleOption((option) => option.setName('rola').setDescription('Rola').setRequired(true)),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('domeny')
        .setDescription('Domeny dozwolone mimo filtra linkow')
        .addSubcommand((sub) =>
          sub
            .setName('dodaj')
            .setDescription('Dodaje domene do listy dozwolonych')
            .addStringOption((option) =>
              option.setName('domena').setDescription('np. youtube.com').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa domene z listy dozwolonych')
            .addStringOption((option) => option.setName('domena').setDescription('np. youtube.com').setRequired(true)),
        ),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (group === 'slowa') {
      if (subcommand === 'lista') {
        const words = moderation.listBlockedWords(guildId);
        return reply.panel(
          interaction,
          panel({
            color: COLORS.info,
            title: '🚫 Zabronione slowa',
            description: words.length
              ? truncate(words.map((word) => `\`${word}\``).join(', '), 3500)
              : '*Lista jest pusta.* Dodaj slowa komenda `/automod slowa dodaj`.',
            footer: `Lacznie: ${words.length}`,
          }),
        );
      }

      if (subcommand === 'dodaj') {
        const input = interaction.options.getString('slowo', true);
        const words = input
          .split(',')
          .map((word) => word.trim().toLowerCase())
          .filter((word) => word.length >= 2 && word.length <= 60);

        if (words.length === 0) {
          return reply.error(interaction, 'Podaj przynajmniej jedno slowo (2–60 znakow).');
        }

        const added = words.filter((word) => moderation.addBlockedWord(guildId, word));
        return reply.success(
          interaction,
          added.length
            ? `Dodano do filtra: ${added.map((word) => `\`${word}\``).join(', ')}.`
            : 'Wszystkie podane slowa byly juz na liscie.',
        );
      }

      const word = interaction.options.getString('slowo', true).trim().toLowerCase();
      return moderation.removeBlockedWord(guildId, word)
        ? reply.success(interaction, `Usunieto \`${word}\` z filtra.`)
        : reply.error(interaction, `Slowa \`${word}\` nie ma na liscie.`);
    }

    if (group === 'wyjatki') {
      const role = interaction.options.getRole('rola', true);
      const settings = guilds.get(guildId);
      const current = new Set(settings.automod_exempt_roles);

      if (subcommand === 'dodaj') {
        if (current.has(role.id)) return reply.error(interaction, `Rola ${role} jest juz na liscie wyjatkow.`);
        current.add(role.id);
        guilds.update(guildId, { automod_exempt_roles: [...current] });
        return reply.success(interaction, `Rola ${role} zostala zwolniona z automoderacji.`);
      }

      if (!current.delete(role.id)) return reply.error(interaction, `Roli ${role} nie ma na liscie wyjatkow.`);
      guilds.update(guildId, { automod_exempt_roles: [...current] });
      return reply.success(interaction, `Rola ${role} podlega ponownie automoderacji.`);
    }

    if (group === 'domeny') {
      const raw = interaction.options.getString('domena', true).trim().toLowerCase();
      const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        return reply.error(interaction, 'To nie wyglada na poprawna domene. Przyklad: `youtube.com`.');
      }

      const settings = guilds.get(guildId);
      const current = new Set(settings.automod_link_whitelist);

      if (subcommand === 'dodaj') {
        if (current.has(domain)) return reply.error(interaction, `Domena \`${domain}\` jest juz dozwolona.`);
        current.add(domain);
        guilds.update(guildId, { automod_link_whitelist: [...current] });
        return reply.success(interaction, `Domena \`${domain}\` zostala dodana do dozwolonych.`);
      }

      if (!current.delete(domain)) return reply.error(interaction, `Domeny \`${domain}\` nie ma na liscie.`);
      guilds.update(guildId, { automod_link_whitelist: [...current] });
      return reply.success(interaction, `Domena \`${domain}\` zostala usunieta z dozwolonych.`);
    }

    if (subcommand === 'pokaz') {
      return reply.panel(interaction, buildOverview(interaction.guild));
    }

    // ustaw
    const mapping = {
      wlaczona: 'automod_enabled',
      slowa: 'automod_words',
      linki: 'automod_links',
      zaproszenia: 'automod_invites',
      spam: 'automod_spam',
    };

    const patch = {};
    for (const [option, column] of Object.entries(mapping)) {
      const value = interaction.options.getBoolean(option);
      if (value !== null) patch[column] = value;
    }

    const action = interaction.options.getString('akcja');
    if (action) patch.automod_action = action;

    const timeoutMinutes = interaction.options.getInteger('timeout_minut');
    if (timeoutMinutes !== null) patch.automod_timeout_minutes = timeoutMinutes;

    const spamMessages = interaction.options.getInteger('spam_wiadomosci');
    if (spamMessages !== null) patch.automod_spam_messages = spamMessages;

    const spamSeconds = interaction.options.getInteger('spam_sekundy');
    if (spamSeconds !== null) patch.automod_spam_seconds = spamSeconds;

    if (Object.keys(patch).length === 0) {
      return reply.error(interaction, 'Nie podano zadnej opcji do zmiany.');
    }

    guilds.update(guildId, patch);

    if (patch.automod_words && moderation.listBlockedWords(guildId).length === 0) {
      return reply.panel(interaction, [
        buildOverview(interaction.guild),
        panel({
          color: COLORS.warning,
          title: '⚠️ Lista slow jest pusta',
          description: 'Filtr slow jest wlaczony, ale nie dodano jeszcze zadnego slowa — uzyj `/automod slowa dodaj`.',
        }),
      ]);
    }

    return reply.panel(interaction, buildOverview(interaction.guild));
  },

  buildOverview,
};
