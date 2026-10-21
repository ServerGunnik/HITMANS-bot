'use strict';

const { MessageFlags } = require('discord.js');

const economy = require('../../database/repositories/economy');
const guilds = require('../../database/repositories/guilds');
const shopRepo = require('../../database/repositories/shop');
const economyService = require('../../services/economy');
const shopService = require('../../services/shop');
const { build: customId } = require('../../utils/customId');
const { COLORS, V2_FLAGS, button, panel, reply, row } = require('../../ui/components');
const { timestamp } = require('../../utils/format');

/** Czy wiadomosc z panelem jest prywatna (ephemeral) — decyduje o update vs reply. */
function isEphemeral(interaction) {
  return Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));
}

/** Przyciski sklepu: zakup z potwierdzeniem oraz przewijanie oferty. */
module.exports = {
  namespace: shopService.NAMESPACE,

  async execute(interaction, { action, args }) {
    const { guild } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    // ─── Przewijanie oferty ─────────────────────────────────────────────
    if (action === 'page') {
      const page = Number(args[0]) || 0;
      const balance = economy.getBalance(guild.id, interaction.user.id);
      const container = shopService.buildShopPanel(guild, { page, balance });

      return isEphemeral(interaction)
        ? interaction.update({ components: [container], flags: V2_FLAGS })
        : reply.panel(interaction, container);
    }

    if (action === 'cancel') {
      return interaction.update({
        components: [
          panel({ color: COLORS.neutral, title: '✖️ Anulowano', description: 'Zakup nie zostal dokonany.' }),
        ],
        flags: V2_FLAGS,
      });
    }

    const item = shopRepo.getItem(guild.id, Number(args[0]));
    if (!item) return reply.error(interaction, 'Ten przedmiot nie jest juz dostepny w sklepie.');

    // ─── Krok 1: potwierdzenie ──────────────────────────────────────────
    if (action === 'buy') {
      const balance = economy.getBalance(guild.id, interaction.user.id);

      if (balance < item.price) {
        return reply.error(
          interaction,
          `Nie masz wystarczajacych srodkow. Cena: ${economyService.formatCurrency(guild.id, item.price, { short: true })}, ` +
            `Twoje saldo: ${economyService.formatCurrency(guild.id, balance, { short: true })}.`,
        );
      }

      const container = panel({
        color: COLORS.warning,
        title: '🛒 Potwierdz zakup',
        description: `Czy na pewno chcesz kupic **${item.name}**?`,
        fields: [
          { name: 'Cena', value: economyService.formatCurrency(guild.id, item.price), inline: true },
          {
            name: 'Saldo po zakupie',
            value: economyService.formatCurrency(guild.id, balance - item.price, { short: true }),
            inline: true,
          },
          { name: 'Rodzaj', value: shopService.describeItem(guild, item) },
        ],
        rows: [
          row(
            button({
              id: customId(shopService.NAMESPACE, 'confirm', item.id),
              label: 'Kupuje',
              emoji: '✅',
              style: 'success',
            }),
            button({ id: customId(shopService.NAMESPACE, 'cancel'), label: 'Anuluj', emoji: '✖️', style: 'secondary' }),
          ),
        ],
      });

      return reply.panel(interaction, container);
    }

    // ─── Krok 2: realizacja zakupu ──────────────────────────────────────
    await interaction.deferUpdate();

    const result = await shopService.purchase({ guild, member: interaction.member, item });

    if (!result.ok) {
      return interaction.editReply({
        components: [panel({ color: COLORS.danger, title: '❌ Zakup nieudany', description: result.reason })],
        flags: V2_FLAGS,
      });
    }

    await shopService.logPurchase(guild, interaction.user, item, result);

    return interaction.editReply({
      components: [
        panel({
          color: COLORS.success,
          title: '🛒 Zakup udany',
          description: `Kupiono **${item.name}** za ${economyService.formatCurrency(guild.id, item.price, { short: true })}.`,
          fields: [
            {
              name: 'Saldo po zakupie',
              value: economyService.formatCurrency(guild.id, result.balance, { short: true }),
              inline: true,
            },
            ...(result.role ? [{ name: 'Nadana rola', value: `${result.role}`, inline: true }] : []),
            ...(result.expiresAt ? [{ name: 'Wygasa', value: timestamp(result.expiresAt, 'R'), inline: true }] : []),
            ...(item.type === 'custom'
              ? [{ name: 'Realizacja', value: 'Administracja zrealizuje ten zakup recznie — jest zapisany w historii.' }]
              : []),
          ],
          footer: `Transakcja #${result.transaction.id} • Twoje zakupy: /sklep moje`,
        }),
      ],
      flags: V2_FLAGS,
    });
  },
};
