'use strict';

const { getDb } = require('../index');

/** Sklep klanowy: przedmioty konfigurowane przez adminow i historia zakupow. */

const ITEM_TYPES = {
  role: 'Rola na stale',
  temp_role: 'Rola czasowa',
  custom: 'Przedmiot wlasny',
};

// ─── Przedmioty ─────────────────────────────────────────────────────────────

function listItems(guildId, { onlyEnabled = false } = {}) {
  const sql = onlyEnabled
    ? 'SELECT * FROM shop_items WHERE guild_id = ? AND enabled = 1 ORDER BY position ASC, id ASC'
    : 'SELECT * FROM shop_items WHERE guild_id = ? ORDER BY position ASC, id ASC';

  return getDb()
    .prepare(sql)
    .all(guildId)
    .map((item) => ({ ...item, enabled: Boolean(item.enabled) }));
}

function getItem(guildId, itemId) {
  const item = getDb().prepare('SELECT * FROM shop_items WHERE guild_id = ? AND id = ?').get(guildId, itemId);
  return item ? { ...item, enabled: Boolean(item.enabled) } : null;
}

function addItem(guildId, item) {
  const position =
    getDb().prepare('SELECT COALESCE(MAX(position), 0) AS max FROM shop_items WHERE guild_id = ?').get(guildId).max + 1;

  const info = getDb()
    .prepare(
      `INSERT INTO shop_items
         (guild_id, name, description, price, type, role_id, duration_hours, stock, enabled, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      guildId,
      item.name,
      item.description ?? null,
      item.price,
      item.type ?? 'role',
      item.roleId ?? null,
      item.durationHours ?? null,
      item.stock ?? null,
      position,
      Date.now(),
    );

  return getItem(guildId, Number(info.lastInsertRowid));
}

function updateItem(guildId, itemId, patch) {
  const allowed = {
    name: 'name',
    description: 'description',
    price: 'price',
    type: 'type',
    roleId: 'role_id',
    durationHours: 'duration_hours',
    stock: 'stock',
    enabled: 'enabled',
  };

  const entries = Object.entries(patch).filter(([key]) => key in allowed && patch[key] !== undefined);
  if (entries.length === 0) return getItem(guildId, itemId);

  const assignments = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
  const values = entries.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));

  getDb().prepare(`UPDATE shop_items SET ${assignments} WHERE guild_id = ? AND id = ?`).run(...values, guildId, itemId);
  return getItem(guildId, itemId);
}

function removeItem(guildId, itemId) {
  const item = getItem(guildId, itemId);
  if (!item) return null;
  getDb().prepare('DELETE FROM shop_items WHERE guild_id = ? AND id = ?').run(guildId, itemId);
  return item;
}

/** Zmniejsza stan magazynowy (gdy przedmiot ma limit). */
function decreaseStock(guildId, itemId) {
  getDb()
    .prepare('UPDATE shop_items SET stock = stock - 1 WHERE guild_id = ? AND id = ? AND stock IS NOT NULL')
    .run(guildId, itemId);
}

// ─── Zakupy ─────────────────────────────────────────────────────────────────

function addPurchase({ guildId, userId, item, transactionId, expiresAt }) {
  const info = getDb()
    .prepare(
      `INSERT INTO shop_purchases
         (guild_id, user_id, item_id, item_name, price, transaction_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, item.id, item.name, item.price, transactionId ?? null, expiresAt ?? null, Date.now());

  return getDb().prepare('SELECT * FROM shop_purchases WHERE id = ?').get(Number(info.lastInsertRowid));
}

function listPurchases(guildId, userId, { limit = 10 } = {}) {
  return getDb()
    .prepare('SELECT * FROM shop_purchases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, userId, limit);
}

/** Aktywne role czasowe uzytkownika. */
function activeTempRoles(guildId, userId) {
  return getDb()
    .prepare(
      `SELECT * FROM shop_purchases
       WHERE guild_id = ? AND user_id = ? AND expired = 0 AND expires_at IS NOT NULL
       ORDER BY expires_at ASC`,
    )
    .all(guildId, userId);
}

/** Zakupy rol czasowych, ktorych termin juz minal. */
function dueExpirations(now = Date.now()) {
  return getDb()
    .prepare('SELECT * FROM shop_purchases WHERE expired = 0 AND expires_at IS NOT NULL AND expires_at <= ?')
    .all(now);
}

function markExpired(purchaseId) {
  getDb().prepare('UPDATE shop_purchases SET expired = 1 WHERE id = ?').run(purchaseId);
}

/** Czy uzytkownik ma juz ten przedmiot (aktywny) — blokuje podwojny zakup roli. */
function hasActivePurchase(guildId, userId, itemId) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM shop_purchases
         WHERE guild_id = ? AND user_id = ? AND item_id = ? AND expired = 0
         LIMIT 1`,
      )
      .get(guildId, userId, itemId),
  );
}

module.exports = {
  ITEM_TYPES,
  listItems,
  getItem,
  addItem,
  updateItem,
  removeItem,
  decreaseStock,
  addPurchase,
  listPurchases,
  activeTempRoles,
  dueExpirations,
  markExpired,
  hasActivePurchase,
};
