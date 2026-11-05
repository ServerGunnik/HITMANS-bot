'use strict';

const { getDb } = require('../index');

const DEFAULT_THRESHOLD = 3;

/** Ustawienia starboardu (domyslnie wylaczony, prog 3 gwiazdki). */
function getSettings(guildId) {
  const row = getDb().prepare('SELECT * FROM starboard_settings WHERE guild_id = ?').get(guildId);
  if (!row) return { guild_id: guildId, channel_id: null, threshold: DEFAULT_THRESHOLD, enabled: false };
  return { ...row, enabled: Boolean(row.enabled) };
}

function updateSettings(guildId, patch) {
  const next = { ...getSettings(guildId), ...patch };
  getDb()
    .prepare(
      `INSERT INTO starboard_settings (guild_id, channel_id, threshold, enabled) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET
         channel_id = excluded.channel_id, threshold = excluded.threshold, enabled = excluded.enabled`,
    )
    .run(guildId, next.channel_id ?? null, next.threshold ?? DEFAULT_THRESHOLD, next.enabled ? 1 : 0);
  return getSettings(guildId);
}

function getPost(sourceMessageId) {
  return getDb().prepare('SELECT * FROM starboard_posts WHERE source_message_id = ?').get(sourceMessageId) ?? null;
}

function getPostByStarboardMessage(starboardMessageId) {
  return getDb().prepare('SELECT * FROM starboard_posts WHERE starboard_message_id = ?').get(starboardMessageId) ?? null;
}

function createPost({ guildId, sourceChannelId, sourceMessageId, authorId, starboardChannelId, starboardMessageId, stars }) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO starboard_posts
         (source_message_id, guild_id, source_channel_id, author_id, starboard_channel_id, starboard_message_id, stars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sourceMessageId, guildId, sourceChannelId, authorId, starboardChannelId, starboardMessageId, stars, now, now);
  return getPost(sourceMessageId);
}

function updateStars(sourceMessageId, stars) {
  getDb()
    .prepare('UPDATE starboard_posts SET stars = ?, updated_at = ? WHERE source_message_id = ?')
    .run(stars, Date.now(), sourceMessageId);
}

function removePost(sourceMessageId) {
  return getDb().prepare('DELETE FROM starboard_posts WHERE source_message_id = ?').run(sourceMessageId).changes > 0;
}

module.exports = {
  DEFAULT_THRESHOLD,
  getSettings,
  updateSettings,
  getPost,
  getPostByStarboardMessage,
  createPost,
  updateStars,
  removePost,
};
