'use strict';

const {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const rolePanelsRepo = require('../../database/repositories/rolePanels');
const rolePanels = require('../../services/rolePanels');
const { COLORS, V2_FLAGS, panel, reply } = require('../../ui/components');
const { memberCanAssignRole } = require('../../utils/permissions');
const { truncate } = require('../../utils/format');

const MAX_PANELS = 25;

const MODE_CHOICES = [
  { name: 'Wiele rol naraz', value: 'multi' },
  { name: 'Tylko jedna rola z panelu', value: 'single' },
];

/** Opcja wyboru panelu z autouzupelnianiem. */
const panelOption = (option) =>
  option.setName('panel').setDescription('Panel rol').setAutocomplete(true).setRequired(true);

function findPanel(interaction) {
  return rolePanelsRepo.getForGuild(interaction.guild.id, interaction.options.getInteger('panel', true));
}

/** Odswieza opublikowany panel i dopisuje informacje do odpowiedzi. */
async function refreshNote(guild, panelId) {
  const updated = rolePanelsRepo.get(panelId);
  if (!updated.message_id) return ' Opublikuj go komenda `/role-panel opublikuj`.';
  const ok = await rolePanels.refreshMessage(guild, updated);
  return ok ? ' Opublikowany panel zostal odswiezony.' : ' ⚠️ Nie udalo sie odswiezyc opublikowanej wiadomosci.';
}

const handlers = {
  async utworz(interaction) {
    if (rolePanelsRepo.list(interaction.guild.id).length >= MAX_PANELS) {
      return reply.error(interaction, `Mozna miec maksymalnie **${MAX_PANELS}** paneli rol.`);
    }

    const created = rolePanelsRepo.create({
      guildId: interaction.guild.id,
      title: interaction.options.getString('tytul', true).trim(),
      description: interaction.options.getString('opis')?.trim() || null,
      mode: interaction.options.getString('tryb') ?? 'multi',
      createdBy: interaction.user.id,
    });

    return reply.success(
      interaction,
      `Utworzono panel **#${created.id} ${truncate(created.title, 100)}** (${rolePanels.MODE_LABELS[created.mode]}).\n` +
        'Dodaj role: `/role-panel dodaj`, a potem opublikuj: `/role-panel opublikuj`.',
    );
  },

  async dodaj(interaction) {
    const rolePanel = findPanel(interaction);
    if (!rolePanel) return reply.error(interaction, 'Nie znalazlem tego panelu.');

    const role = interaction.options.getRole('rola', true);
    const safety = rolePanels.checkRoleSafety(interaction.guild, role);
    if (!safety.ok) return reply.error(interaction, safety.reason);

    const hierarchy = memberCanAssignRole(interaction.member, role);
    if (!hierarchy.ok) return reply.error(interaction, hierarchy.reason);

    const exists = rolePanel.entries.some((entry) => entry.role_id === role.id);
    if (!exists && rolePanel.entries.length >= rolePanels.MAX_ROLES) {
      return reply.error(interaction, `Panel moze miec maksymalnie **${rolePanels.MAX_ROLES}** rol.`);
    }

    const emoji = interaction.options.getString('emoji')?.trim() || null;
    if (!rolePanels.isValidEmoji(emoji)) {
      return reply.error(interaction, 'Nieprawidlowe emoji — podaj pojedyncze emoji albo emoji serwera (np. `<:nazwa:123>`).');
    }

    const label = truncate(interaction.options.getString('etykieta')?.trim() || role.name, 80);
    rolePanelsRepo.addEntry(rolePanel.id, { roleId: role.id, label, emoji });

    const note = await refreshNote(interaction.guild, rolePanel.id);
    return reply.success(interaction, `${exists ? 'Zaktualizowano' : 'Dodano'} role ${role} w panelu **#${rolePanel.id}**.${note}`);
  },

  async 'usun-role'(interaction) {
    const rolePanel = findPanel(interaction);
    if (!rolePanel) return reply.error(interaction, 'Nie znalazlem tego panelu.');

    const role = interaction.options.getRole('rola', true);
    if (!rolePanelsRepo.removeEntry(rolePanel.id, role.id)) {
      return reply.error(interaction, `Roli ${role} nie ma w panelu **#${rolePanel.id}**.`);
    }

    const note = await refreshNote(interaction.guild, rolePanel.id);
    return reply.success(interaction, `Usunieto role ${role} z panelu **#${rolePanel.id}**.${note}`);
  },

  async tryb(interaction) {
    const rolePanel = findPanel(interaction);
    if (!rolePanel) return reply.error(interaction, 'Nie znalazlem tego panelu.');

    const mode = interaction.options.getString('tryb', true);
    rolePanelsRepo.setMode(rolePanel.id, mode);
    const note = await refreshNote(interaction.guild, rolePanel.id);
    return reply.success(interaction, `Panel **#${rolePanel.id}**: ${rolePanels.MODE_LABELS[mode]}.${note}`);
  },

  async opublikuj(interaction) {
    const rolePanel = findPanel(interaction);
    if (!rolePanel) return reply.error(interaction, 'Nie znalazlem tego panelu.');
    if (rolePanel.entries.length === 0) {
      return reply.error(interaction, 'Panel nie ma zadnych rol — dodaj je komenda `/role-panel dodaj`.');
    }

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const permissions = channel.permissionsFor?.(interaction.guild.members.me);
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
      return reply.error(interaction, `Nie mam uprawnien do pisania na kanale ${channel}.`);
    }

    const message = await channel.send({
      components: [rolePanels.buildPanel(interaction.guild, rolePanel)],
      flags: V2_FLAGS,
      allowedMentions: { parse: [] },
    });
    rolePanelsRepo.setMessage(rolePanel.id, channel.id, message.id);

    return reply.success(interaction, `Panel **#${rolePanel.id}** opublikowany: ${message.url}`);
  },

  async lista(interaction) {
    const panels = rolePanelsRepo.list(interaction.guild.id);
    return reply.panel(
      interaction,
      panel({
        color: COLORS.info,
        title: '🎭 Panele rol',
        blocks: panels.length
          ? panels.map((entry) => truncate(rolePanels.describePanel(interaction.guild, entry), 350)).slice(0, 8)
          : ['*Brak paneli. Utworz pierwszy komenda `/role-panel utworz`.*'],
        footer: panels.length > 8 ? `Pokazano 8 z ${panels.length} paneli.` : undefined,
      }),
    );
  },

  async usun(interaction) {
    const rolePanel = findPanel(interaction);
    if (!rolePanel) return reply.error(interaction, 'Nie znalazlem tego panelu.');

    if (rolePanel.message_id) {
      const channel = interaction.guild.channels.cache.get(rolePanel.channel_id);
      const message = await channel?.messages?.fetch(rolePanel.message_id).catch(() => null);
      await message?.delete().catch(() => {});
    }
    rolePanelsRepo.remove(rolePanel.id);
    return reply.success(interaction, `Usunieto panel **#${rolePanel.id} ${truncate(rolePanel.title, 100)}**.`);
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role-panel')
    .setDescription('Panele rol do samodzielnego wyboru (admin)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('utworz')
        .setDescription('Tworzy nowy panel rol')
        .addStringOption((option) => option.setName('tytul').setDescription('Tytul panelu').setMaxLength(100).setRequired(true))
        .addStringOption((option) => option.setName('opis').setDescription('Opis nad przyciskami').setMaxLength(1000))
        .addStringOption((option) =>
          option.setName('tryb').setDescription('Ile rol z panelu mozna miec').addChoices(...MODE_CHOICES),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('dodaj')
        .setDescription('Dodaje role do panelu')
        .addIntegerOption(panelOption)
        .addRoleOption((option) => option.setName('rola').setDescription('Rola do wyboru').setRequired(true))
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji na przycisku').setMaxLength(64))
        .addStringOption((option) =>
          option.setName('etykieta').setDescription('Tekst przycisku (domyslnie nazwa roli)').setMaxLength(80),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('usun-role')
        .setDescription('Usuwa role z panelu')
        .addIntegerOption(panelOption)
        .addRoleOption((option) => option.setName('rola').setDescription('Rola do usuniecia').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('tryb')
        .setDescription('Zmienia tryb panelu (jedna / wiele rol)')
        .addIntegerOption(panelOption)
        .addStringOption((option) =>
          option.setName('tryb').setDescription('Tryb wyboru').addChoices(...MODE_CHOICES).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('opublikuj')
        .setDescription('Publikuje panel na kanale')
        .addIntegerOption(panelOption)
        .addChannelOption((option) =>
          option
            .setName('kanal')
            .setDescription('Gdzie opublikowac (domyslnie biezacy kanal)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) => sub.setName('lista').setDescription('Lista paneli rol'))
    .addSubcommand((sub) =>
      sub.setName('usun').setDescription('Usuwa panel (i opublikowana wiadomosc)').addIntegerOption(panelOption),
    ),

  async autocomplete(interaction) {
    const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
    const choices = rolePanelsRepo
      .list(interaction.guild.id)
      .filter((entry) => `${entry.id} ${entry.title}`.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((entry) => ({ name: truncate(`#${entry.id} ${entry.title} (${entry.entries.length} rol)`, 100), value: entry.id }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const handler = handlers[interaction.options.getSubcommand()];
    return handler(interaction);
  },
};
