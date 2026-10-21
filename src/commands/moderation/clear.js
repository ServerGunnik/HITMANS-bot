'use strict';

const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const { reply } = require('../../ui/components');
const { plural } = require('../../utils/format');
const modlog = require('../../utils/modlog');

const MAX_DELETE = 100;
const BULK_LIMIT_MS = 14 * 24 * 60 * 60 * 1000; // 14 dni

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Usuwa ostatnie wiadomosci z kanalu (opcjonalnie tylko od jednego uzytkownika)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('ilosc')
        .setDescription('Ile wiadomosci usunac (1-100)')
        .setMinValue(1)
        .setMaxValue(MAX_DELETE)
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('uzytkownik')
        .setDescription('Usun tylko wiadomosci tej osoby (przeszuka ostatnie 100 wiadomosci)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('ilosc', true);
    const targetUser = interaction.options.getUser('uzytkownik');
    const channel = interaction.channel;

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
      return reply.error(interaction, 'Brakuje mi uprawnienia **Zarzadzanie wiadomosciami** na tym kanale.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Do filtrowania po uzytkowniku pobieramy pelne 100, potem wybieramy N.
    const fetchLimit = targetUser ? MAX_DELETE : amount;
    const messages = await channel.messages.fetch({ limit: fetchLimit }).catch(() => null);
    if (!messages || messages.size === 0) {
      return reply.error(interaction, 'Nie znalazlem zadnych wiadomosci na tym kanale.');
    }

    let candidates = [...messages.values()];
    if (targetUser) {
      candidates = candidates.filter((message) => message.author.id === targetUser.id);
    }

    const cutoff = Date.now() - BULK_LIMIT_MS;
    const deletable = candidates.filter((message) => message.createdTimestamp > cutoff);
    const tooOld = candidates.length - deletable.length;

    const toDelete = deletable.slice(0, amount);
    if (toDelete.length === 0) {
      return reply.error(
        interaction,
        targetUser
          ? `Nie znalazlem swiezych wiadomosci od ${targetUser} do usuniecia${tooOld ? ` (${tooOld} starszych niz 14 dni pominietych)` : ''}.`
          : 'Nie znalazlem swiezych wiadomosci do usuniecia (wszystkie starsze niz 14 dni).',
      );
    }

    let deletedCount = 0;
    try {
      const deleted = await channel.bulkDelete(toDelete, true);
      deletedCount = deleted.size;
    } catch (error) {
      return reply.error(interaction, `Nie udalo sie usunac wiadomosci: ${error.message}`);
    }

    const parts = [];
    parts.push(
      `Usunieto **${deletedCount}** ${plural(deletedCount, 'wiadomosc', 'wiadomosci', 'wiadomosci')}` +
        (targetUser ? ` od ${targetUser}` : '') + '.',
    );
    if (tooOld > 0) parts.push(`Pominieto **${tooOld}** starszych niz 14 dni (Discord API nie pozwala ich usuwac zbiorczo).`);

    await modlog
      .logEvent(interaction.guild, {
        action: 'clear',
        user: targetUser ?? interaction.user,
        moderator: interaction.user,
        reason: `Usunieto ${deletedCount} wiadomosci na kanale <#${channel.id}>${targetUser ? ` (filtr: ${targetUser.tag})` : ''}`,
      })
      .catch(() => {});

    return reply.success(interaction, parts.join(' '));
  },
};
