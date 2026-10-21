'use strict';

const economy = require('../database/repositories/economy');
const shopRepo = require('../database/repositories/shop');
const economyService = require('./economy');
const logger = require('../utils/logger');
const serverLogs = require('./serverLogs');
const { build: customId } = require('../utils/customId');
const { COLORS, button, panel, row } = require('../ui/components');
const { canManageRole } = require('../utils/permissions');
const { formatNumber, humanDuration, timestamp, truncate } = require('../utils/format');

const NAMESPACE = 'sklep';
const ITEMS_PER_PAGE = 6;

const TYPE_LABELS = {
  role: '🎭 rola na stale',
  temp_role: '⏳ rola czasowa',
  custom: '🎁 przedmiot',
};

/** Opis przedmiotu w sklepie. */
function describeItem(guild, item) {
  const parts = [TYPE_LABELS[item.type] ?? item.type];

  if (item.type === 'temp_role' && item.duration_hours) {
    parts.push(humanDuration(item.duration_hours * 60 * 60 * 1000));
  }
  if (item.role_id) {
    const role = guild.roles.cache.get(item.role_id);
    parts.push(role ? `${role}` : '⚠️ rola usunieta');
  }
  if (item.stock !== null && item.stock !== undefined) {
    parts.push(item.stock > 0 ? `pozostalo: ${item.stock}` : 'wyprzedane');
  }
  if (!item.enabled) parts.push('⚠️ wylaczony');

  return parts.join(' • ');
}

/** Panel sklepu — kazdy przedmiot jako Section z przyciskiem zakupu. */
function buildShopPanel(guild, { page = 0, balance = null, forAdmin = false, notice = null } = {}) {
  const items = shopRepo.listItems(guild.id, { onlyEnabled: !forAdmin });
  const pages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const visible = items.slice(current * ITEMS_PER_PAGE, current * ITEMS_PER_PAGE + ITEMS_PER_PAGE);

  const sections = visible.map((item) => {
    const soldOut = item.stock !== null && item.stock !== undefined && item.stock <= 0;
    const affordable = balance === null || balance >= item.price;

    return {
      content:
        `**${truncate(item.name, 80)}** — ${economyService.formatCurrency(guild.id, item.price, { short: true })}\n` +
        (item.description ? `${truncate(item.description, 200)}\n` : '') +
        `-# ${describeItem(guild, item)}`,
      button: button({
        id: customId(NAMESPACE, 'buy', item.id),
        label: soldOut ? 'Wyprzedane' : 'Kup',
        emoji: soldOut ? '🚫' : '🛒',
        style: affordable && !soldOut ? 'success' : 'secondary',
        disabled: soldOut || !item.enabled || !affordable,
      }),
    };
  });

  const rows = [];
  if (pages > 1) {
    rows.push(
      row(
        button({
          id: customId(NAMESPACE, 'page', current - 1),
          label: 'Poprzednia',
          emoji: '◀️',
          style: 'secondary',
          disabled: current === 0,
        }),
        button({
          id: customId(NAMESPACE, 'page', current + 1),
          label: 'Nastepna',
          emoji: '▶️',
          style: 'secondary',
          disabled: current >= pages - 1,
        }),
      ),
    );
  }

  return panel({
    color: COLORS.clan,
    title: '🛒 Sklep klanowy',
    description:
      items.length === 0
        ? '*Sklep jest pusty.* Administracja moze dodac przedmioty komenda `/sklep dodaj`.'
        : balance !== null
          ? `Twoje saldo: ${economyService.formatCurrency(guild.id, balance)}`
          : 'Wybierz przedmiot, aby go kupic.',
    blocks: notice ? [notice] : [],
    sections,
    rows,
    footer:
      items.length > 0
        ? `Strona ${current + 1}/${pages} • Przedmiotow: ${items.length} • Zakupy: /sklep moje`
        : 'Dodawanie przedmiotow: /sklep dodaj',
  });
}

/**
 * Realizuje zakup: sprawdza dostepnosc i saldo, pobiera punkty,
 * nadaje role i zapisuje zakup wraz z transakcja.
 */
async function purchase({ guild, member, item }) {
  if (!item.enabled) return { ok: false, reason: 'Ten przedmiot jest obecnie niedostepny.' };

  if (item.stock !== null && item.stock !== undefined && item.stock <= 0) {
    return { ok: false, reason: 'Ten przedmiot jest wyprzedany.' };
  }

  let role = null;
  if (item.type === 'role' || item.type === 'temp_role') {
    role = guild.roles.cache.get(item.role_id);
    if (!role) return { ok: false, reason: 'Rola przypisana do tego przedmiotu juz nie istnieje.' };

    const check = canManageRole(guild, role);
    if (!check.ok) return { ok: false, reason: check.reason };

    if (item.type === 'role' && member.roles.cache.has(role.id)) {
      return { ok: false, reason: `Masz juz role ${role}.` };
    }
    if (item.type === 'temp_role' && shopRepo.hasActivePurchase(guild.id, member.id, item.id)) {
      return { ok: false, reason: 'Masz juz aktywny zakup tego przedmiotu — poczekaj, az wygasnie.' };
    }
  }

  const payment = economy.spend({
    guildId: guild.id,
    userId: member.id,
    amount: item.price,
    reason: `Zakup: ${item.name}`,
  });

  if (!payment.ok) {
    return {
      ok: false,
      reason:
        `Nie masz wystarczajacych srodkow. Cena: ${economyService.formatCurrency(guild.id, item.price, { short: true })}, ` +
        `Twoje saldo: ${economyService.formatCurrency(guild.id, payment.balance, { short: true })}.`,
    };
  }

  const expiresAt =
    item.type === 'temp_role' && item.duration_hours ? Date.now() + item.duration_hours * 60 * 60 * 1000 : null;

  if (role) {
    try {
      await member.roles.add(role, `Zakup w sklepie klanowym: ${item.name}`);
    } catch (error) {
      // Zwrot punktow, gdy nadanie roli sie nie powiodlo.
      economy.record({
        guildId: guild.id,
        type: 'revert',
        toUserId: member.id,
        amount: item.price,
        reason: `Zwrot za nieudany zakup: ${item.name}`,
        actorId: guild.client.user.id,
        referenceId: payment.transaction.id,
      });

      logger.warn(`Nie udalo sie nadac roli po zakupie (${guild.id}):`, error.message);
      return { ok: false, reason: `Nie udalo sie nadac roli — punkty zostaly zwrocone. (${error.message})` };
    }
  }

  const purchaseRow = shopRepo.addPurchase({
    guildId: guild.id,
    userId: member.id,
    item,
    transactionId: payment.transaction.id,
    expiresAt,
  });

  if (item.stock !== null && item.stock !== undefined) shopRepo.decreaseStock(guild.id, item.id);

  return { ok: true, purchase: purchaseRow, transaction: payment.transaction, balance: payment.balance, role, expiresAt };
}

/** Zdejmuje role czasowe, ktorych termin minal. */
async function processExpiredPurchases(client) {
  const due = shopRepo.dueExpirations();
  if (due.length === 0) return 0;

  let processed = 0;

  for (const entry of due) {
    const guild = client.guilds.cache.get(entry.guild_id);
    if (!guild) {
      shopRepo.markExpired(entry.id);
      continue;
    }

    const item = shopRepo.getItem(entry.guild_id, entry.item_id);
    const member = await guild.members.fetch(entry.user_id).catch(() => null);

    if (member && item?.role_id && member.roles.cache.has(item.role_id)) {
      await member.roles
        .remove(item.role_id, `Wygasl czasowy zakup: ${entry.item_name}`)
        .catch((error) => logger.debug('Nie udalo sie zdjac roli czasowej:', error.message));
    }

    shopRepo.markExpired(entry.id);
    processed += 1;
  }

  if (processed > 0) logger.info(`Sklep: zakonczono ${processed} czasowych zakupow.`);
  return processed;
}

/** Cykliczne sprawdzanie wygasajacych rol czasowych. */
function startExpiryScheduler(client) {
  processExpiredPurchases(client).catch((error) => logger.warn('Scheduler sklepu:', error.message));

  const timer = setInterval(
    () => processExpiredPurchases(client).catch((error) => logger.warn('Scheduler sklepu:', error.message)),
    60 * 1000,
  );

  timer.unref();
  return timer;
}

/** Wpis w logach ekonomii o zakupie (pomaga wykrywac naduzycia). */
async function logPurchase(guild, user, item, result) {
  return serverLogs.logEconomy(guild, {
    title: 'Zakup w sklepie',
    fields: [
      { name: 'Kupujacy', value: serverLogs.describeUser(user) },
      { name: 'Przedmiot', value: item.name, inline: true },
      { name: 'Cena', value: formatNumber(item.price), inline: true },
      { name: 'Saldo po zakupie', value: formatNumber(result.balance), inline: true },
      ...(result.expiresAt ? [{ name: 'Wygasa', value: timestamp(result.expiresAt, 'R'), inline: true }] : []),
    ],
    footer: `Transakcja #${result.transaction.id}`,
  });
}

module.exports = {
  NAMESPACE,
  ITEMS_PER_PAGE,
  TYPE_LABELS,
  describeItem,
  buildShopPanel,
  purchase,
  processExpiredPurchases,
  startExpiryScheduler,
  logPurchase,
};
