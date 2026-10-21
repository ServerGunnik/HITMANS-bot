'use strict';

const {
  ApplicationCommandOptionType,
  CommandInteractionOptionResolver,
  MessageFlags,
} = require('discord.js');

/**
 * Lekka atrapa interakcji slash, oparta na prawdziwym resolverze opcji
 * discord.js — dzieki temu testy wykrywaja np. uzycie getBoolean()
 * na opcji tekstowej (discord.js rzuca wtedy wyjatkiem).
 */

const OPTION_TYPES = {
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  boolean: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  role: ApplicationCommandOptionType.Role,
  channel: ApplicationCommandOptionType.Channel,
};

function buildOption(option) {
  const base = { name: option.name, type: OPTION_TYPES[option.type], value: option.value };
  if (option.type === 'user') return { ...base, value: option.value.id, user: option.value };
  if (option.type === 'role') return { ...base, value: option.value.id, role: option.value };
  if (option.type === 'channel') return { ...base, value: option.value.id, channel: option.value };
  return base;
}

function createUser(id, username = `user-${id}`, { bot = false } = {}) {
  return {
    id,
    username,
    bot,
    tag: `${username}#0001`,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    createdAt: new Date('2020-01-01T00:00:00Z'),
    toString: () => `<@${id}>`,
  };
}

function createMember(user, { guild, admin = false, roles = [] } = {}) {
  const cache = new Map(roles.map((role) => [role.id ?? role, role.id ? role : { id: role }]));

  return {
    id: user.id,
    user,
    guild,
    roles: { cache, highest: { position: admin ? 90 : 5 }, add: async () => {}, remove: async () => {} },
    permissions: { has: () => admin },
    displayAvatarURL: () => user.displayAvatarURL(),
    joinedAt: new Date('2024-01-01T00:00:00Z'),
    toString: () => `<@${user.id}>`,
  };
}

function createGuild(id, { name = 'Klan Testowy', members = new Map(), roles = [] } = {}) {
  const roleCache = new Map(roles.map((role) => [role.id, role]));

  const guild = {
    id,
    name,
    ownerId: 'owner',
    memberCount: members.size,
    createdAt: new Date('2021-01-01T00:00:00Z'),
    iconURL: () => null,
    roles: { cache: roleCache, everyone: { id: 'everyone' } },
    channels: { cache: new Map() },
    voiceStates: { cache: new Map() },
    client: { user: createUser('bot', 'bot', { bot: true }), users: { fetch: async () => null } },
    members: {
      cache: members,
      me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
      fetch: async (userId) => members.get(userId) ?? null,
    },
  };

  for (const member of members.values()) member.guild = guild;
  return guild;
}

/** Buduje interakcje i zbiera wyslane odpowiedzi w `interaction.replies`. */
function createInteraction({ guild, member, subcommand = null, group = null, options = [] }) {
  const hoisted = options.map(buildOption);

  let tree = hoisted;
  if (subcommand) tree = [{ name: subcommand, type: ApplicationCommandOptionType.Subcommand, options: hoisted }];
  if (group) tree = [{ name: group, type: ApplicationCommandOptionType.SubcommandGroup, options: tree }];

  const replies = [];

  return {
    guild,
    member,
    user: member.user,
    client: guild.client,
    channel: { id: 'channel', send: async () => ({ url: 'https://discord.com/message' }) },
    options: new CommandInteractionOptionResolver(guild.client, tree, {}),
    replies,
    deferred: false,
    replied: false,
    inGuild: () => true,
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
      return payload;
    },
    async deferReply(payload = {}) {
      this.deferred = true;
      this.ephemeral = Boolean(payload.flags & MessageFlags.Ephemeral);
      return payload;
    },
    async editReply(payload) {
      replies.push(payload);
      return payload;
    },
    async followUp(payload) {
      replies.push(payload);
      return payload;
    },
  };
}

/** Zwraca tekst ostatniej odpowiedzi (do asercji na tresci panelu). */
function replyText(interaction) {
  const last = interaction.replies.at(-1);
  if (!last) return '';
  return JSON.stringify(last.components?.map((component) => component.toJSON?.() ?? component) ?? last);
}

module.exports = { createUser, createMember, createGuild, createInteraction, replyText };
