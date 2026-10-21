'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const logsRepo = require('../../database/repositories/logs');
const guilds = require('../../database/repositories/guilds');
const serverLogs = require('../../services/serverLogs');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

const CATEGORY_CHOICES = logsRepo.CATEGORIES.map((category) => ({
  name: `${serverLogs.CATEGORY_META[category].emoji} ${serverLogs.CATEGORY_META[category].label} — ${serverLogs.CATEGORY_META[category].description}`,
  value: category,
}));

function buildOverview(guild) {
  const settings = logsRepo.list(guild.id);
  const ignores = logsRepo.listIgnores(guild.id);
  const modlogChannel = guilds.get(guild.id).modlog_channel_id;

  const rows = settings.map((entry) => {
    const meta = serverLogs.CATEGORY_META[entry.category];
    const state = !entry.channelId
      ? '`nie ustawiono`'
      : entry.enabled
        ? `<#${entry.channelId}>`
        : `<#${entry.channelId}> *(wylaczone)*`;
    return `${meta.emoji} **${meta.label}** — ${state}\n-# ${meta.description}`;
  });

  const ignoreValue = [
    ignores.channel.length ? `Kanaly: ${ignores.channel.map((id) => `<#${id}>`).join(' ')}` : null,
    ignores.role.length ? `Role: ${ignores.role.map((id) => `<@&${id}>`).join(' ')}` : null,
    ignores.user.length ? `Osoby: ${ignores.user.map((id) => `<@${id}>`).join(' ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return panel({
    color: COLORS.info,
    title: '📋 Logi serwera',
    description:
      'Logi zdarzen sa niezalezne od logu moderacji (`/konfiguracja kanal typ:logi`), ' +
      'ktory zapisuje akcje wykonane komendami bota.',
    blocks: rows,
    fields: [
      {
        name: 'Log moderacji (kary, rekrutacja)',
        value: modlogChannel ? `<#${modlogChannel}>` : '`nie ustawiono` — `/konfiguracja kanal typ:logi`',
      },
      { name: 'Wykluczenia', value: ignoreValue || '*brak* — logowane jest wszystko' },
    ],
    footer: 'Ustawienia: /logi kanal • /logi wszystko • /logi ignoruj • Test: /logi test',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logi')
    .setDescription('Konfiguracja logow zdarzen serwera')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('pokaz').setDescription('Pokazuje konfiguracje logow'))
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Ustawia kanal dla wybranej kategorii logow')
        .addStringOption((option) =>
          option.setName('kategoria').setDescription('Co logujemy').addChoices(...CATEGORY_CHOICES).setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal docelowy')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('wszystko')
        .setDescription('Kieruje wszystkie kategorie logow na jeden kanal')
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal docelowy')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('przelacz')
        .setDescription('Wlacza lub wylacza kategorie logow')
        .addStringOption((option) =>
          option.setName('kategoria').setDescription('Ktora kategoria').addChoices(...CATEGORY_CHOICES).setRequired(true),
        )
        .addBooleanOption((option) => option.setName('wlaczone').setDescription('Czy logowac').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Wysyla testowy wpis, aby sprawdzic uprawnienia bota')
        .addStringOption((option) =>
          option.setName('kategoria').setDescription('Ktora kategoria').addChoices(...CATEGORY_CHOICES).setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('wylacz-wszystko').setDescription('Kasuje cala konfiguracje logow'))
    .addSubcommandGroup((group) =>
      group
        .setName('ignoruj')
        .setDescription('Kanaly, role i osoby pomijane w logach')
        .addSubcommand((sub) =>
          sub
            .setName('dodaj')
            .setDescription('Dodaje wykluczenie')
            .addChannelOption((option) => option.setName('kanal').setDescription('Kanal do pominiecia'))
            .addRoleOption((option) => option.setName('rola').setDescription('Rola do pominiecia'))
            .addUserOption((option) => option.setName('uzytkownik').setDescription('Osoba do pominiecia')),
        )
        .addSubcommand((sub) =>
          sub
            .setName('usun')
            .setDescription('Usuwa wykluczenie')
            .addChannelOption((option) => option.setName('kanal').setDescription('Kanal'))
            .addRoleOption((option) => option.setName('rola').setDescription('Rola'))
            .addUserOption((option) => option.setName('uzytkownik').setDescription('Osoba')),
        ),
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    // ─── Wykluczenia ────────────────────────────────────────────────────
    if (group === 'ignoruj') {
      const targets = [
        ['channel', interaction.options.getChannel('kanal')],
        ['role', interaction.options.getRole('rola')],
        ['user', interaction.options.getUser('uzytkownik')],
      ].filter(([, value]) => value);

      if (targets.length === 0) {
        return reply.error(interaction, 'Podaj przynajmniej jedno: `kanal`, `rola` lub `uzytkownik`.');
      }

      const changed = [];
      for (const [type, target] of targets) {
        const applied =
          subcommand === 'dodaj'
            ? logsRepo.addIgnore(guild.id, type, target.id)
            : logsRepo.removeIgnore(guild.id, type, target.id);
        if (applied) changed.push(`${target}`);
      }

      if (changed.length === 0) {
        return reply.error(
          interaction,
          subcommand === 'dodaj' ? 'Te pozycje sa juz na liscie wykluczen.' : 'Tych pozycji nie ma na liscie wykluczen.',
        );
      }

      return reply.panel(interaction, [
        buildOverview(guild),
        panel({
          color: COLORS.success,
          title: subcommand === 'dodaj' ? '✅ Dodano wykluczenia' : '✅ Usunieto wykluczenia',
          description: truncate(changed.join(' '), 900),
        }),
      ]);
    }

    if (subcommand === 'pokaz') {
      return reply.panel(interaction, buildOverview(guild));
    }

    if (subcommand === 'kanal' || subcommand === 'wszystko') {
      const channel = interaction.options.getChannel('kanal', true);

      const permissions = channel.permissionsFor(guild.members.me);
      if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages)) {
        return reply.error(
          interaction,
          `Nie mam uprawnien do pisania na kanale ${channel}. Nadaj mi **Wyswietlanie kanalu** i **Wysylanie wiadomosci**.`,
        );
      }

      if (subcommand === 'wszystko') {
        logsRepo.setAll(guild.id, channel.id);
        return reply.panel(interaction, [
          buildOverview(guild),
          panel({
            color: COLORS.success,
            title: '✅ Wszystkie logi skierowane na jeden kanal',
            description: `Kazda kategoria trafia teraz na ${channel}.`,
          }),
        ]);
      }

      const category = interaction.options.getString('kategoria', true);
      logsRepo.setChannel(guild.id, category, channel.id);

      return reply.panel(interaction, [
        buildOverview(guild),
        panel({
          color: COLORS.success,
          title: '✅ Kanal ustawiony',
          description: `**${serverLogs.CATEGORY_META[category].label}** → ${channel}`,
        }),
      ]);
    }

    if (subcommand === 'przelacz') {
      const category = interaction.options.getString('kategoria', true);
      const enabled = interaction.options.getBoolean('wlaczone', true);
      const result = logsRepo.setEnabled(guild.id, category, enabled);

      if (enabled && !result.channelId) {
        return reply.error(
          interaction,
          `Kategoria **${serverLogs.CATEGORY_META[category].label}** nie ma jeszcze kanalu — ustaw go komenda \`/logi kanal\`.`,
        );
      }

      return reply.panel(interaction, buildOverview(guild));
    }

    if (subcommand === 'test') {
      const category = interaction.options.getString('kategoria', true);

      const sent = await serverLogs.send(guild, category, {
        title: 'Wpis testowy',
        color: COLORS.info,
        fields: [
          { name: 'Kategoria', value: serverLogs.CATEGORY_META[category].label, inline: true },
          { name: 'Wywolal(a)', value: `${interaction.user}`, inline: true },
        ],
        footer: 'Jesli to widzisz, logi tej kategorii dzialaja poprawnie.',
      });

      return sent
        ? reply.success(interaction, `Wpis testowy wyslany na kanal logow kategorii **${serverLogs.CATEGORY_META[category].label}**.`)
        : reply.error(
            interaction,
            'Nie udalo sie wyslac wpisu. Sprawdz, czy kategoria ma ustawiony kanal, jest wlaczona ' +
              'i czy mam na nim uprawnienia do pisania.',
          );
    }

    // wylacz-wszystko
    const cleared = logsRepo.clear(guild.id);
    return reply.success(interaction, `Wyczyszczono konfiguracje logow (usunieto **${cleared}** wpisow).`);
  },

  buildOverview,
};
