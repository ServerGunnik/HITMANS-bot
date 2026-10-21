'use strict';

const { getDb } = require('../index');

function create({ channelId, guildId, ownerId, panelMessageId = null }) {
  getDb()
    .prepare(
      `INSERT INTO voice_channels (channel_id, guild_id, owner_id, panel_message_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(channelId, guildId, ownerId, panelMessageId, Date.now());
}

function get(channelId) {
  return getDb().prepare('SELECT * FROM voice_channels WHERE channel_id = ?').get(channelId);
}

function findByOwner(guildId, ownerId) {
  return getDb()
    .prepare('SELECT * FROM voice_channels WHERE guild_id = ? AND owner_id = ?')
    .get(guildId, ownerId);
}

function remove(channelId) {
  getDb().prepare('DELETE FROM voice_channels WHERE channel_id = ?').run(channelId);
}

function setPanelMessage(channelId, messageId) {
  getDb().prepare('UPDATE voice_channels SET panel_message_id = ? WHERE channel_id = ?').run(messageId, channelId);
}

function transferOwner(channelId, newOwnerId) {
  getDb().prepare('UPDATE voice_channels SET owner_id = ? WHERE channel_id = ?').run(newOwnerId, channelId);
}

function listAll(guildId) {
  return getDb().prepare('SELECT * FROM voice_channels WHERE guild_id = ?').all(guildId);
}

function listAllChannels() {
  return getDb().prepare('SELECT * FROM voice_channels').all();
}

module.exports = {
  create,
  get,
  findByOwner,
  remove,
  setPanelMessage,
  transferOwner,
  listAll,
  listAllChannels,
};
