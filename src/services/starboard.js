'use strict';

const { MediaGalleryBuilder, MediaGalleryItemBuilder, PermissionFlagsBits } = require('discord.js');

const starboardRepo = require('../database/repositories/starboard');
const { COLORS, V2_FLAGS, button, panel, row, separator, text } = require('../ui/components');
const { timestamp, truncate } = require('../utils/format');
const logger = require('../utils/logger');

const STAR = '⭐';
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

/** Kolejka per wiadomosc — szybkie reakcje nie utworza dwoch kart naraz. */
const locks = new Map();

function withLock(key, task) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(key, next);
  next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => {});
  return next;
}

/** Liczy gwiazdki: bez autora wiadomosci i bez botow. */
function countStars(users, authorId) {
  let count = 0;
  for (const user of users) {
    if (!user || user.bot || user.id === authorId) continue;
    count += 1;
  }
  return count;
}

/**
 * Co zrobic z karta na starboardzie:
 * create — prog osiagniety, karty brak; update — karta jest, zmiana liczby;
 * delete — liczba spadla ponizej progu; none — nic.
 */
function decide({ stars, threshold, existing }) {
  if (stars >= threshold) {
    if (!existing) return 'create';
    return existing.stars === stars ? 'none' : 'update';
  }
  return existing ? 'delete' : 'none';
}

/** Pierwszy obrazek z zalacznikow wiadomosci (lub null). */
function findImage(message) {
  for (const attachment of message.attachments?.values?.() ?? []) {
    if (attachment.contentType?.startsWith('image/') || IMAGE_EXTENSIONS.test(attachment.name ?? attachment.url ?? '')) {
      return attachment.url;
    }
  }
  return null;
}

function starEmoji(stars) {
  if (stars >= 15) return '💫';
  if (stars >= 8) return '🌟';
  return STAR;
}

/** Karta wiadomosci na starboardzie (Components V2). */
function buildCard(message, stars) {
  const author = message.author;
  const content = message.content?.trim() ? truncate(message.content, 3000) : '*[brak tekstu]*';
  const otherFiles = [...(message.attachments?.values?.() ?? [])].filter((file) => file.url !== findImage(message));

  const container = panel({
    color: COLORS.warning,
    description:
      `**${starEmoji(stars)} ${stars}** • <#${message.channelId}> • ${author ? `<@${author.id}>` : 'nieznany autor'}\n\n` +
      content,
    thumbnail: author?.displayAvatarURL ? { url: author.displayAvatarURL(), description: author.username } : undefined,
  });

  if (otherFiles.length) {
    container.addTextDisplayComponents(
      text(truncate(otherFiles.map((file) => `📎 [${file.name ?? 'plik'}](${file.url})`).join('\n'), 500)),
    );
  }

  const image = findImage(message);
  if (image) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)),
    );
  }

  container.addSeparatorComponents(separator({ divider: false }));
  container.addActionRowComponents(row(button({ label: 'Przejdz do wiadomosci', style: 'link', url: message.url })));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(
    text(`-# ${author?.tag ?? 'nieznany autor'} • ${timestamp(message.createdTimestamp, 'f')}`),
  );
  return container;
}

async function fetchStarboardMessage(guild, post) {
  const channel = guild.channels.cache.get(post.starboard_channel_id);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(post.starboard_message_id).catch(() => null);
}

/** Usuwa karte ze starboardu (np. gdy oryginal zniknal). */
async function removeCard(guild, sourceMessageId) {
  const post = starboardRepo.getPost(sourceMessageId);
  if (!post) return false;
  const card = await fetchStarboardMessage(guild, post);
  if (card) await card.delete().catch(() => {});
  starboardRepo.removePost(sourceMessageId);
  return true;
}

/**
 * Czy wiadomosc mozna pokazac na starboardzie: kanal zrodlowy musi byc
 * widoczny dla @everyone, a tresc NSFW tylko na kanale NSFW.
 */
function isPublicSource(message, starboardChannel) {
  const source = message.channel;
  if (!source) return true;
  const everyone = message.guild.roles.everyone;
  const permissions = source.permissionsFor?.(everyone);
  if (permissions && !permissions.has(PermissionFlagsBits.ViewChannel)) return false;
  const nsfw = Boolean(source.nsfw ?? source.parent?.nsfw);
  return !nsfw || Boolean(starboardChannel?.nsfw);
}

/**
 * Liczba gwiazdek bez autora i botow. Ponizej progu wystarcza licznik reakcji
 * (wynik i tak jest za maly); powyzej pobieramy tylko pierwsza strone
 * reagujacych, zamiast wszystkich przy kazdej nowej gwiazdce.
 */
async function countReactionStars(reaction, authorId, threshold) {
  const total = Number.isFinite(reaction.count) ? reaction.count : null;
  if (total !== null && total < threshold) return total;

  const firstPage = [...(await reaction.users.fetch({ limit: 100 })).values()];
  const counted = countStars(firstPage, authorId);
  if (total === null || total <= firstPage.length) return counted;
  return total - (firstPage.length - counted);
}

/** Przelicza gwiazdki wiadomosci i tworzy / aktualizuje / usuwa karte. */
async function sync(message) {
  if (!message?.guild) return 'none';
  const settings = starboardRepo.getSettings(message.guild.id);
  if (!settings.enabled || !settings.channel_id) return 'none';
  if (message.channelId === settings.channel_id) return 'none';

  return withLock(message.id, async () => {
    if (message.partial) message = await message.fetch();
    if (!message.author || message.author.bot) return 'none';

    const existing = starboardRepo.getPost(message.id);
    const channel = message.guild.channels.cache.get(settings.channel_id);
    // Wiadomosci z kanalow prywatnych (oficerowie, tickety, logi) albo NSFW
    // nie moga trafic na publiczny starboard.
    if (!isPublicSource(message, channel)) {
      if (existing) await removeCard(message.guild, message.id);
      return existing ? 'delete' : 'none';
    }

    const reaction = message.reactions.cache.find((entry) => entry.emoji.name === STAR);
    const stars = reaction ? await countReactionStars(reaction, message.author.id, settings.threshold) : 0;
    const action = decide({ stars, threshold: settings.threshold, existing });

    if (action === 'create') {
      if (!channel?.isTextBased()) return 'none';
      const card = await channel.send({
        components: [buildCard(message, stars)],
        flags: V2_FLAGS,
        allowedMentions: { parse: [] },
      });
      starboardRepo.createPost({
        guildId: message.guild.id,
        sourceChannelId: message.channelId,
        sourceMessageId: message.id,
        authorId: message.author.id,
        starboardChannelId: channel.id,
        starboardMessageId: card.id,
        stars,
      });
    } else if (action === 'update') {
      const card = await fetchStarboardMessage(message.guild, existing);
      if (!card) {
        // Ktos usunal karte recznie — tworzymy ja od nowa przy nastepnej reakcji.
        starboardRepo.removePost(message.id);
        return 'delete';
      }
      await card.edit({ components: [buildCard(message, stars)], flags: V2_FLAGS, allowedMentions: { parse: [] } });
      starboardRepo.updateStars(message.id, stars);
    } else if (action === 'delete') {
      await removeCard(message.guild, message.id);
    }

    return action;
  });
}

/** Wspolny handler zdarzen reakcji (dodanie / usuniecie / wyczyszczenie). */
async function handleReaction(reaction) {
  try {
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.emoji.name !== STAR) return;
    await sync(reaction.message);
  } catch (error) {
    logger.debug('Starboard:', error.message);
  }
}

module.exports = {
  STAR,
  countStars,
  isPublicSource,
  countReactionStars,
  decide,
  findImage,
  buildCard,
  sync,
  removeCard,
  handleReaction,
};
