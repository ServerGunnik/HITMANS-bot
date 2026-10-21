'use strict';

const {
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const guilds = require('../database/repositories/guilds');
const conquestRepo = require('../database/repositories/conquest');
const { COLORS, button, panel, row, V2_FLAGS } = require('../ui/components');
const { build: customId } = require('../utils/customId');
const { truncate, timestamp } = require('../utils/format');
const logger = require('../utils/logger');

const NAMESPACE = 'podboj';

/** Publiczny panel z przyciskiem otwierajacym formularz. */
function buildPanel({ title, description } = {}) {
  return panel({
    color: COLORS.clan,
    title: title || '🗡️ Zlec podbicie państwa',
    description:
      description ||
      'Chcesz zaproponować sojusz albo zlecić podbicie innego państwa?\n' +
        'Kliknij przycisk poniżej i wypełnij krótki formularz — utworzymy prywatny kanał, gdzie omówimy szczegóły.',
    rows: [
      row(
        button({
          id: customId(NAMESPACE, 'start'),
          label: 'Podbij państwo',
          emoji: '🗡️',
          style: 'danger',
        }),
      ),
    ],
    footer: 'Ticket zobaczą tylko Ty i staff.',
  });
}

/** Modal z 5 polami formularza. */
function buildFormModal() {
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'submit'))
    .setTitle('Zlecenie podbicia państwa')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Twój nick w grze')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('nick')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(32)
            .setPlaceholder('np. NightRaider'),
        ),
      new LabelBuilder()
        .setLabel('Wasze państwo (nazwa + liczba członków)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('ourCountry')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder('np. Polska — 25 członków'),
        ),
      new LabelBuilder()
        .setLabel('Charakter waszego państwa')
        .setDescription('agresywne / pacyfistyczne / mieszane')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('character')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(40)
            .setPlaceholder('np. agresywne'),
        ),
      new LabelBuilder()
        .setLabel('Państwo do podbicia (nazwa + liczba członków)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('target')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder('np. Niemcy — 15 członków'),
        ),
      new LabelBuilder()
        .setLabel('Oferta i dodatkowe informacje')
        .setDescription('Ile płacicie, czym, jakie warunki, kontekst konfliktu...')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('offer')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setPlaceholder('np. 500 diamentów + 3 stacki obsydianu; chcemy zaatakować w weekend...'),
        ),
    );
}

/** Buduje wiadomość w kanale ticketa — dane formularza + przyciski dla staffu. */
function buildTicketMessage(ticket, { user }) {
  const form = ticket.form;
  return panel({
    color: COLORS.warning,
    title: `🗡️ Zlecenie #${ticket.id} — podbicie państwa`,
    description: `Zleceniodawca: ${user ? `<@${user.id}> \`${user.tag}\`` : `<@${ticket.user_id}>`}\nZłożone: ${timestamp(ticket.created_at, 'f')}`,
    fields: [
      { name: 'Nick w grze', value: truncate(form.nick ?? '—', 200) },
      { name: 'Państwo zleceniodawcy', value: truncate(form.ourCountry ?? '—', 200), inline: true },
      { name: 'Charakter państwa', value: truncate(form.character ?? '—', 100), inline: true },
      { name: 'Państwo do podbicia', value: truncate(form.target ?? '—', 200) },
      { name: 'Oferta i szczegóły', value: truncate(form.offer ?? '—', 1000) },
    ],
    rows: [
      row(
        button({
          id: customId(NAMESPACE, 'close', ticket.id),
          label: 'Zamknij ticket',
          emoji: '🔒',
          style: 'danger',
        }),
      ),
    ],
    footer: 'Staff omawia szczegóły z zleceniodawcą tutaj. Zamknięcie usunie kanał.',
  });
}

/** Tworzy prywatny kanał ticketa + posta z danymi. */
async function createTicket(interaction, form) {
  const { guild, user } = interaction;
  const settings = guilds.get(guild.id);

  if (!settings.conquest_category_id) {
    return { ok: false, reason: 'Nie skonfigurowano kategorii ticketów. Admin: `/konfiguracja podboj kategoria:@KATEGORIA`.' };
  }
  if (!settings.conquest_staff_role_id) {
    return { ok: false, reason: 'Nie skonfigurowano roli staffu. Admin: `/konfiguracja podboj staff:@rola`.' };
  }

  const category = guild.channels.cache.get(settings.conquest_category_id);
  if (!category) return { ok: false, reason: 'Skonfigurowana kategoria już nie istnieje.' };

  const staffRole = guild.roles.cache.get(settings.conquest_staff_role_id);
  if (!staffRole) return { ok: false, reason: 'Skonfigurowana rola staffu już nie istnieje.' };

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, reason: 'Brakuje mi uprawnienia **Zarządzanie kanałami** aby stworzyć ticket.' };
  }

  const existing = conquestRepo.findOpenByUser(guild.id, user.id);
  if (existing && existing.channel_id && guild.channels.cache.has(existing.channel_id)) {
    return { ok: false, reason: `Masz już otwarty ticket: <#${existing.channel_id}>. Zamknij go najpierw.` };
  }

  const ticket = conquestRepo.create({
    guildId: guild.id,
    userId: user.id,
    userTag: user.tag,
    form,
  });

  const channelName = `podboj-${user.username}-${ticket.id}`.slice(0, 100);

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: staffRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
      reason: `Ticket podboju #${ticket.id} — ${user.tag}`,
    });
  } catch (error) {
    conquestRepo.markClosed(ticket.id, guild.client.user.id);
    return { ok: false, reason: `Nie udało się stworzyć kanału: ${error.message}` };
  }

  conquestRepo.setChannel(ticket.id, channel.id);
  const updated = conquestRepo.get(ticket.id);

  try {
    await channel.send({
      content: `<@${user.id}> <@&${staffRole.id}>`,
      components: [buildTicketMessage(updated, { user })],
      flags: V2_FLAGS,
      allowedMentions: { users: [user.id], roles: [staffRole.id] },
    });
  } catch (error) {
    logger.warn(`Nie udało się wysłać powitania w ticketcie #${ticket.id}:`, error.message);
  }

  return { ok: true, ticket: updated, channel };
}

async function closeTicket(interaction, ticket) {
  const channel = interaction.guild.channels.cache.get(ticket.channel_id);
  conquestRepo.markClosed(ticket.id, interaction.user.id);

  if (channel) {
    try {
      await channel.delete(`Zamknięcie ticketu #${ticket.id} przez ${interaction.user.tag}`);
    } catch (error) {
      return { ok: false, reason: `Nie mogłem usunąć kanału: ${error.message}` };
    }
  }
  return { ok: true };
}

module.exports = {
  NAMESPACE,
  buildPanel,
  buildFormModal,
  buildTicketMessage,
  createTicket,
  closeTicket,
};
