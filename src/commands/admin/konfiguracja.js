'use strict';

const { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const recruitment = require('../../database/repositories/recruitment');
const roles = require('../../database/repositories/roles');
const logsRepo = require('../../database/repositories/logs');
const recruitmentService = require('../../services/recruitment');
const { COLORS, panel, reply } = require('../../ui/components');
const { truncate } = require('../../utils/format');

const CHANNEL_FIELDS = {
  zgloszenia: { column: 'applications_channel_id', label: 'Kanal zgloszen rekrutacyjnych' },
  powitania: { column: 'welcome_channel_id', label: 'Kanal powitalny' },
  logi: { column: 'modlog_channel_id', label: 'Kanal logow moderacji' },
};

const ROLE_FIELDS = {
  gosc: { column: 'guest_role_id', label: 'Rola goscia / rekruta' },
  czlonek: { column: 'member_role_id', label: 'Rola czlonka klanu' },
  wyciszenie: { column: 'mute_role_id', label: 'Rola wyciszenia (tekst)' },
};

function describe(value, formatter) {
  return value ? formatter(value) : '`nie ustawiono`';
}

/** Panel z pelnym podgladem konfiguracji serwera. */
function buildOverview(guild) {
  const settings = guilds.get(guild.id);
  const applicantQuestions = recruitment.countQuestions(guild.id, 'applicant');
  const reviewerQuestions = recruitment.countQuestions(guild.id, 'reviewer');
  const hierarchy = roles.list(guild.id);

  return panel({
    color: COLORS.primary,
    title: `⚙️ Konfiguracja — ${guild.name}`,
    description: 'Ustawienia sa zapisywane osobno dla kazdego serwera.',
    fields: [
      {
        name: '📨 Rekrutacja',
        value:
          `Status: **${settings.recruitment_enabled ? 'otwarta' : 'zamknieta'}**\n` +
          `Pytania dla kandydata: **${applicantQuestions}** / ${recruitment.MAX_QUESTIONS}\n` +
          `Pytania dla rekrutera: **${reviewerQuestions}** / ${recruitment.MAX_QUESTIONS}` +
          `${settings.recruitment_review_required ? ' *(ocena wymagana przed akceptacja)*' : ''}\n` +
          `Kanal zgloszen: ${describe(settings.applications_channel_id, (id) => `<#${id}>`)}\n` +
          `Odstep po odrzuceniu: **${settings.recruitment_cooldown_h} h**`,
      },
      {
        name: '🛡️ Role',
        value:
          `Rola goscia: ${describe(settings.guest_role_id, (id) => `<@&${id}>`)}\n` +
          `Rola czlonka: ${describe(settings.member_role_id, (id) => `<@&${id}>`)}\n` +
          `Stopni w hierarchii: **${hierarchy.length}**`,
      },
      {
        name: '📢 Kanaly',
        value:
          `Powitania: ${describe(settings.welcome_channel_id, (id) => `<#${id}>`)}\n` +
          `Logi moderacji: ${describe(settings.modlog_channel_id, (id) => `<#${id}>`)}`,
      },
      {
        name: '🤖 Automoderacja',
        value: settings.automod_enabled
          ? `**wlaczona** • filtry: ` +
            [
              settings.automod_words ? 'slowa' : null,
              settings.automod_links ? 'linki' : null,
              settings.automod_invites ? 'zaproszenia' : null,
              settings.automod_spam ? 'spam' : null,
            ]
              .filter(Boolean)
              .join(', ') || '**wlaczona** • brak aktywnych filtrow'
          : '`wylaczona` — wlacz komenda `/automod ustaw`',
      },
      {
        name: '📋 Logi zdarzen',
        value: (() => {
          const active = logsRepo.list(guild.id).filter((entry) => entry.enabled && entry.channelId);
          return active.length
            ? `Aktywne kategorie: **${active.length}** z ${logsRepo.CATEGORIES.length} — szczegoly: \`/logi pokaz\``
            : '`wylaczone` — wlacz komenda `/logi wszystko kanal:#logi`';
        })(),
      },
      {
        name: '💰 Ekonomia',
        value: settings.economy_enabled
          ? `**wlaczona** • waluta: ${settings.currency_emoji} ${settings.currency_name} • ` +
            `nagrody: ${settings.economy_message_reward}/wiadomosc, ${settings.economy_voice_reward}/min na glosowym`
          : '`wylaczona` — wlacz komenda `/ekonomia ustaw`',
      },
      {
        name: '💬 Wiadomosc powitalna',
        value: `> ${truncate(settings.welcome_message ?? guilds.DEFAULT_WELCOME, 300).replace(/\n/g, '\n> ')}`,
      },
    ],
    footer: 'Zmiany: /konfiguracja kanal • /konfiguracja rola • /konfiguracja powitanie • /pytania panel',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('konfiguracja')
    .setDescription('Ustawienia bota na tym serwerze')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('pokaz').setDescription('Wyswietla aktualne ustawienia serwera'))
    .addSubcommand((sub) =>
      sub
        .setName('kanal')
        .setDescription('Ustawia kanal dla wybranej funkcji bota')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktory kanal ustawiamy')
            .setRequired(true)
            .addChoices(
              { name: 'Zgloszenia rekrutacyjne', value: 'zgloszenia' },
              { name: 'Powitania nowych czlonkow', value: 'powitania' },
              { name: 'Logi moderacji', value: 'logi' },
            ),
        )
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Kanal (pusty = wyczysc ustawienie)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rola')
        .setDescription('Ustawia role goscia lub czlonka klanu')
        .addStringOption((option) =>
          option
            .setName('typ')
            .setDescription('Ktora role ustawiamy')
            .setRequired(true)
            .addChoices(
              { name: 'Gosc / rekrut (nadawana automatycznie)', value: 'gosc' },
              { name: 'Czlonek klanu (po akceptacji)', value: 'czlonek' },
              { name: 'Wyciszenie tekstowe (rola blokujaca pisanie)', value: 'wyciszenie' },
            ),
        )
        .addRoleOption((option) =>
          option.setName('rola').setDescription('Rola (pusta = wyczysc ustawienie)').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('powitanie')
        .setDescription('Ustawia tresc wiadomosci powitalnej')
        .addStringOption((option) =>
          option
            .setName('tekst')
            .setDescription('Placeholdery: {user}, {user.name}, {server}, {memberCount}')
            .setMaxLength(1500)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('rekrutacja')
        .setDescription('Otwiera lub zamyka rekrutacje i ustawia odstep miedzy zgloszeniami')
        .addBooleanOption((option) =>
          option.setName('otwarta').setDescription('Czy przyjmujemy zgloszenia').setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('odstep')
            .setDescription('Ile godzin po odrzuceniu do kolejnego zgloszenia (0 = bez limitu)')
            .setMinValue(0)
            .setMaxValue(720)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('ocena_wymagana')
            .setDescription('Czy rekruter musi wypelnic ankiete oceny przed akceptacja')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('weryfikacja')
        .setDescription('Ustawienia weryfikacji captcha (rola nadawana po zaliczeniu)')
        .addBooleanOption((option) =>
          option.setName('wlaczona').setDescription('Czy weryfikacja jest wlaczona').setRequired(false),
        )
        .addRoleOption((option) =>
          option
            .setName('rola')
            .setDescription('Rola nadawana po zaliczeniu captcha (pusta = wyczysc)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('kanaly-glosowe')
        .setDescription('Ustawia hub kanalow glosowych — dolaczenie tworzy prywatny kanal dla uzytkownika')
        .addChannelOption((option) =>
          option
            .setName('hub')
            .setDescription('Kanal-tworzacy (glosowy). Pusty = wyczysc.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false),
        )
        .addChannelOption((option) =>
          option
            .setName('kategoria')
            .setDescription('Kategoria dla utworzonych kanalow (domyslnie ta sama co hub)')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('podboj')
        .setDescription('Konfiguracja ticketów podboju państw (Earth SMP)')
        .addChannelOption((option) =>
          option
            .setName('kategoria')
            .setDescription('Kategoria w której powstają prywatne kanały ticketów')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false),
        )
        .addRoleOption((option) =>
          option
            .setName('staff')
            .setDescription('Rola staffu widocznego w ticketach')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('anti-raid')
        .setDescription('Ochrona przed raidami: masowe dolaczenia -> lockdown')
        .addBooleanOption((option) =>
          option.setName('wlaczone').setDescription('Wlacz/wylacz anti-raid').setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('prog')
            .setDescription('Ile dolaczen w oknie wywoluje lockdown (default 5)')
            .setMinValue(2)
            .setMaxValue(50)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('okno')
            .setDescription('Okno czasowe w sekundach (default 10)')
            .setMinValue(5)
            .setMaxValue(300)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('lockdown_min')
            .setDescription('Ile minut trwa lockdown (default 10)')
            .setMinValue(1)
            .setMaxValue(180)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('lockdown')
            .setDescription('Recznie wlacz/wylacz lockdown teraz')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('anti-nuke')
        .setDescription('Ochrona przed nukowaniem: wykrywa masowe usuwanie kanalow/rol/bany')
        .addBooleanOption((option) =>
          option.setName('wlaczone').setDescription('Wlacz/wylacz anti-nuke').setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('prog')
            .setDescription('Ile destrukcyjnych akcji jednego usera wywoluje kare (default 3)')
            .setMinValue(2)
            .setMaxValue(20)
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName('okno')
            .setDescription('Okno czasowe w sekundach (default 60)')
            .setMinValue(5)
            .setMaxValue(3600)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('min-wiek')
        .setDescription('Minimalny wiek konta Discorda przy dolaczeniu — mlodsze konta sa kickowane')
        .addIntegerOption((option) =>
          option
            .setName('dni')
            .setDescription('Ile dni minimum (0 = wylaczone)')
            .setMinValue(0)
            .setMaxValue(365)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('reset').setDescription('Przywraca domyslne ustawienia serwera (pytania pozostaja)'),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'pokaz') {
      return reply.panel(interaction, buildOverview(interaction.guild));
    }

    if (subcommand === 'kanal') {
      const type = interaction.options.getString('typ', true);
      const channel = interaction.options.getChannel('kanal');
      const field = CHANNEL_FIELDS[type];

      if (channel) {
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages)) {
          return reply.error(
            interaction,
            `Nie mam uprawnien do pisania na kanale ${channel}. Nadaj mi **Wyswietlanie kanalu** i **Wysylanie wiadomosci**.`,
          );
        }
      }

      guilds.update(guildId, { [field.column]: channel?.id ?? null });
      return reply.success(
        interaction,
        channel ? `${field.label}: ${channel}` : `${field.label}: ustawienie wyczyszczone.`,
      );
    }

    if (subcommand === 'rola') {
      const type = interaction.options.getString('typ', true);
      const role = interaction.options.getRole('rola');
      const field = ROLE_FIELDS[type];

      if (role) {
        const me = interaction.guild.members.me;
        if (role.managed) {
          return reply.error(interaction, 'Ta rola jest zarzadzana przez integracje — wybierz zwykla role.');
        }
        if (role.position >= me.roles.highest.position) {
          return reply.error(
            interaction,
            `Rola ${role} jest wyzej w hierarchii niz moja — przesun moja role ponad nia, inaczej nie bede mogl jej nadawac.`,
          );
        }
      }

      guilds.update(guildId, { [field.column]: role?.id ?? null });
      return reply.success(
        interaction,
        role ? `${field.label}: ${role}` : `${field.label}: ustawienie wyczyszczone.`,
      );
    }

    if (subcommand === 'powitanie') {
      const text = interaction.options.getString('tekst', true);
      guilds.update(guildId, { welcome_message: text });

      const preview = recruitmentService.renderWelcome(text, {
        member: interaction.member,
        guild: interaction.guild,
      });

      return reply.panel(
        interaction,
        panel({
          color: COLORS.success,
          title: '✅ Zapisano wiadomosc powitalna',
          description: 'Tak bedzie wygladac powitanie nowego czlonka:',
          blocks: [`> ${preview.replace(/\n/g, '\n> ')}`],
          footer: 'Placeholdery: {user}, {user.name}, {server}, {memberCount}',
        }),
      );
    }

    if (subcommand === 'rekrutacja') {
      const open = interaction.options.getBoolean('otwarta');
      const cooldown = interaction.options.getInteger('odstep');
      const reviewRequired = interaction.options.getBoolean('ocena_wymagana');

      if (open === null && cooldown === null && reviewRequired === null) {
        return reply.error(
          interaction,
          'Podaj przynajmniej jedna opcje: `otwarta`, `odstep` lub `ocena_wymagana`.',
        );
      }

      const patch = {};
      if (open !== null) patch.recruitment_enabled = open;
      if (cooldown !== null) patch.recruitment_cooldown_h = cooldown;
      if (reviewRequired !== null) patch.recruitment_review_required = reviewRequired;
      guilds.update(guildId, patch);

      const parts = [];
      if (open !== null) parts.push(`rekrutacja **${open ? 'otwarta' : 'zamknieta'}**`);
      if (cooldown !== null) parts.push(`odstep po odrzuceniu: **${cooldown} h**`);
      if (reviewRequired !== null) {
        parts.push(`ocena rekrutera przed akceptacja: **${reviewRequired ? 'wymagana' : 'opcjonalna'}**`);
      }

      return reply.success(interaction, `Zaktualizowano: ${parts.join(', ')}.`);
    }

    if (subcommand === 'weryfikacja') {
      const enabled = interaction.options.getBoolean('wlaczona');
      const role = interaction.options.getRole('rola');
      const hasRoleOption = interaction.options.get('rola') !== null;

      if (enabled === null && !hasRoleOption) {
        return reply.error(interaction, 'Podaj przynajmniej jedna opcje: `wlaczona` lub `rola`.');
      }

      if (role) {
        const me = interaction.guild.members.me;
        if (role.managed) {
          return reply.error(interaction, 'Ta rola jest zarzadzana przez integracje — wybierz zwykla role.');
        }
        if (role.position >= me.roles.highest.position) {
          return reply.error(
            interaction,
            `Rola ${role} jest wyzej w hierarchii niz moja — przesun moja role ponad nia.`,
          );
        }
      }

      const patch = {};
      if (enabled !== null) patch.verification_enabled = enabled;
      if (hasRoleOption) patch.verification_role_id = role?.id ?? null;
      guilds.update(guildId, patch);

      const parts = [];
      if (enabled !== null) parts.push(`weryfikacja **${enabled ? 'wlaczona' : 'wylaczona'}**`);
      if (hasRoleOption) parts.push(role ? `rola: ${role}` : 'rola: wyczyszczona');

      return reply.success(
        interaction,
        `Zaktualizowano: ${parts.join(', ')}. Panel opublikujesz komenda \`/weryfikacja-panel\`.`,
      );
    }

    if (subcommand === 'kanaly-glosowe') {
      const hub = interaction.options.getChannel('hub');
      const category = interaction.options.getChannel('kategoria');
      const hasHubOption = interaction.options.get('hub') !== null;
      const hasCategoryOption = interaction.options.get('kategoria') !== null;

      if (!hasHubOption && !hasCategoryOption) {
        return reply.error(interaction, 'Podaj przynajmniej jedna opcje: `hub` lub `kategoria`.');
      }

      if (hub) {
        const me = interaction.guild.members.me;
        const perms = hub.permissionsFor(me);
        if (!perms?.has(PermissionFlagsBits.ManageChannels) || !perms?.has(PermissionFlagsBits.MoveMembers)) {
          return reply.error(
            interaction,
            'Do dzialania huba potrzebuje uprawnien **Zarzadzanie kanalami** i **Przenoszenie czlonkow** na tym kanale.',
          );
        }
      }

      const patch = {};
      if (hasHubOption) patch.voice_hub_channel_id = hub?.id ?? null;
      if (hasCategoryOption) patch.voice_hub_category_id = category?.id ?? null;
      guilds.update(guildId, patch);

      const parts = [];
      if (hasHubOption) parts.push(hub ? `hub: ${hub}` : 'hub: wyczyszczony');
      if (hasCategoryOption) parts.push(category ? `kategoria: **${category.name}**` : 'kategoria: wyczyszczona');

      return reply.success(
        interaction,
        `Zaktualizowano ustawienia kanalow glosowych: ${parts.join(', ')}.`,
      );
    }

    if (subcommand === 'podboj') {
      const category = interaction.options.getChannel('kategoria');
      const staff = interaction.options.getRole('staff');
      const hasCategoryOption = interaction.options.get('kategoria') !== null;
      const hasStaffOption = interaction.options.get('staff') !== null;

      if (!hasCategoryOption && !hasStaffOption) {
        return reply.error(interaction, 'Podaj przynajmniej jedną opcję: `kategoria` lub `staff`.');
      }

      const patch = {};
      if (hasCategoryOption) patch.conquest_category_id = category?.id ?? null;
      if (hasStaffOption) patch.conquest_staff_role_id = staff?.id ?? null;
      guilds.update(guildId, patch);

      const parts = [];
      if (hasCategoryOption) parts.push(category ? `kategoria: **${category.name}**` : 'kategoria: wyczyszczona');
      if (hasStaffOption) parts.push(staff ? `staff: ${staff}` : 'staff: wyczyszczony');

      return reply.success(
        interaction,
        `Zaktualizowano tickety podboju: ${parts.join(', ')}. Publikacja panelu: \`/podboj-panel\`.`,
      );
    }

    if (subcommand === 'anti-raid') {
      const enabled = interaction.options.getBoolean('wlaczone');
      const threshold = interaction.options.getInteger('prog');
      const window = interaction.options.getInteger('okno');
      const lockdownMin = interaction.options.getInteger('lockdown_min');
      const lockdownNow = interaction.options.getBoolean('lockdown');

      if (enabled === null && threshold === null && window === null && lockdownMin === null && lockdownNow === null) {
        return reply.error(interaction, 'Podaj przynajmniej jedna opcje.');
      }

      const patch = {};
      if (enabled !== null) patch.anti_raid_enabled = enabled;
      if (threshold !== null) patch.anti_raid_threshold = threshold;
      if (window !== null) patch.anti_raid_window_seconds = window;
      if (lockdownMin !== null) patch.anti_raid_lockdown_minutes = lockdownMin;
      if (lockdownNow !== null) {
        patch.anti_raid_lockdown_until = lockdownNow
          ? Date.now() + (lockdownMin ?? guilds.get(guildId).anti_raid_lockdown_minutes) * 60 * 1000
          : null;
      }
      guilds.update(guildId, patch);

      const parts = [];
      if (enabled !== null) parts.push(`status: **${enabled ? 'wlaczony' : 'wylaczony'}**`);
      if (threshold !== null) parts.push(`prog: **${threshold}**`);
      if (window !== null) parts.push(`okno: **${window}s**`);
      if (lockdownMin !== null) parts.push(`lockdown: **${lockdownMin} min**`);
      if (lockdownNow !== null) parts.push(`lockdown teraz: **${lockdownNow ? 'aktywny' : 'zdjety'}**`);

      return reply.success(interaction, `Anti-raid zaktualizowany: ${parts.join(', ')}.`);
    }

    if (subcommand === 'anti-nuke') {
      const enabled = interaction.options.getBoolean('wlaczone');
      const threshold = interaction.options.getInteger('prog');
      const window = interaction.options.getInteger('okno');

      if (enabled === null && threshold === null && window === null) {
        return reply.error(interaction, 'Podaj przynajmniej jedna opcje.');
      }

      const patch = {};
      if (enabled !== null) patch.anti_nuke_enabled = enabled;
      if (threshold !== null) patch.anti_nuke_threshold = threshold;
      if (window !== null) patch.anti_nuke_window_seconds = window;
      guilds.update(guildId, patch);

      const parts = [];
      if (enabled !== null) parts.push(`status: **${enabled ? 'wlaczony' : 'wylaczony'}**`);
      if (threshold !== null) parts.push(`prog: **${threshold}**`);
      if (window !== null) parts.push(`okno: **${window}s**`);

      return reply.success(
        interaction,
        `Anti-nuke zaktualizowany: ${parts.join(', ')}. Whitelist zarzadzasz komenda \`/anti-nuke whitelist\`.`,
      );
    }

    if (subcommand === 'min-wiek') {
      const days = interaction.options.getInteger('dni', true);
      guilds.update(guildId, { min_account_age_days: days });
      return reply.success(
        interaction,
        days === 0
          ? 'Filtr wieku konta **wylaczony**.'
          : `Filtr wieku konta ustawiony na **${days}** dni. Mlodsze konta beda automatycznie kickowane przy dolaczeniu.`,
      );
    }

    // reset
    guilds.reset(guildId);
    return reply.success(
      interaction,
      'Ustawienia serwera zostaly przywrocone do wartosci domyslnych. Pytania rekrutacyjne i ostrzezenia pozostaly nienaruszone.',
    );
  },

  buildOverview,
};
