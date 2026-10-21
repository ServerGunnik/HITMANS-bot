'use strict';

const {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const voiceRepo = require('../../database/repositories/voice');
const voiceService = require('../../services/voice');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply, V2_FLAGS } = require('../../ui/components');
const { build: customId } = require('../../utils/customId');

const NAMESPACE = voiceService.NAMESPACE;

function canManage(member, record) {
  return member.id === record.owner_id || isAdmin(member);
}

function buildRenameModal() {
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'renameModal'))
    .setTitle('Zmien nazwe kanalu')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nowa nazwa')
        .setDescription('Max 100 znakow.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(100)
            .setPlaceholder('np. Chill z ekipa'),
        ),
    );
}

function buildLimitModal() {
  return new ModalBuilder()
    .setCustomId(customId(NAMESPACE, 'limitModal'))
    .setTitle('Ustaw limit osob')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Limit (0-99)')
        .setDescription('0 = bez limitu.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('limit')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2)
            .setPlaceholder('np. 5'),
        ),
    );
}

module.exports = {
  namespace: NAMESPACE,

  async execute(interaction, { action }) {
    const channel = interaction.channel;
    const record = voiceRepo.get(channel?.id);

    if (!record) {
      return reply.error(interaction, 'Ten panel dziala tylko w kanale tymczasowym utworzonym przez bota.');
    }

    if (!canManage(interaction.member, record)) {
      return reply.error(interaction, 'Tylko wlasciciel kanalu lub administrator moze uzyc tej akcji.');
    }

    if (action === 'rename') return interaction.showModal(buildRenameModal());
    if (action === 'limit') return interaction.showModal(buildLimitModal());

    if (action === 'lock') {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
      return reply.success(interaction, '🔒 Kanal zablokowany — nikt nowy nie dolaczy.');
    }
    if (action === 'unlock') {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: null });
      return reply.success(interaction, '🔓 Kanal odblokowany — kazdy moze dolaczyc.');
    }

    if (action === 'transfer' || action === 'kick') {
      const placeholder = action === 'transfer' ? 'Wybierz nowego wlasciciela' : 'Wybierz osobe do wyrzucenia';
      return reply.panel(
        interaction,
        panel({
          color: COLORS.info,
          description: action === 'transfer'
            ? 'Wybierz osobe, ktorej chcesz przekazac wlasnosc kanalu:'
            : 'Wybierz osobe do wyrzucenia z tego kanalu:',
          rows: [voiceService.buildUserSelect(action === 'transfer' ? 'transferPick' : 'kickPick', placeholder)],
        }),
        { ephemeral: true },
      );
    }

    if (action === 'close') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await channel.delete('Zamkniecie tymczasowego kanalu przez wlasciciela');
      } catch (error) {
        return reply.error(interaction, `Nie moglem usunac kanalu: ${error.message}`);
      }
      voiceRepo.remove(channel.id);
      voiceService.cancelPendingDelete(channel.id);
      return; // followUp niepotrzebny — kanal juz usuniety
    }
  },

  buildRenameModal,
  buildLimitModal,
};
