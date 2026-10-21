'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');

const { truncate } = require('../utils/format');

/**
 * Wszystkie widoczne dla uzytkownika wiadomosci bota budujemy w Components V2
 * (Container -> Section / TextDisplay / Separator / ActionRow).
 * Flaga IsComponentsV2 wyklucza uzycie pol `content` i `embeds`.
 */
const V2_FLAGS = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  info: 0x3498db,
  neutral: 0x2b2d31,
  clan: 0x9b59b6,
};

const EMOJI = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  question: '❓',
  clan: '🏰',
  shield: '🛡️',
  hammer: '🔨',
  scroll: '📜',
  chart: '📊',
  user: '👤',
};

/** TextDisplay - podstawowy blok tekstu w Components V2. */
function text(content) {
  return new TextDisplayBuilder().setContent(truncate(content, 4000));
}

/** Separator (opcjonalnie z linia i wiekszym odstepem). */
function separator({ divider = true, large = false } = {}) {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/** Section z tekstem i przyciskiem po prawej stronie. */
function sectionWithButton(content, button) {
  return new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(button);
}

/** Section z tekstem i miniaturka (np. awatarem uzytkownika). */
function sectionWithThumbnail(content, url, description) {
  const thumbnail = new ThumbnailBuilder().setURL(url);
  if (description) thumbnail.setDescription(truncate(description, 256));
  return new SectionBuilder().addTextDisplayComponents(text(content)).setThumbnailAccessory(thumbnail);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.flat());
}

function button({ id, label, style = 'primary', emoji, disabled = false, url }) {
  const styles = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
    link: ButtonStyle.Link,
  };

  const builder = new ButtonBuilder().setStyle(styles[style] ?? ButtonStyle.Primary);
  if (label) builder.setLabel(truncate(label, 80));
  if (emoji) builder.setEmoji(emoji);
  if (disabled) builder.setDisabled(true);
  if (url) builder.setURL(url);
  else builder.setCustomId(id);
  return builder;
}

/** Renderuje liste pol jako czytelny blok tekstu. */
function renderFields(fields = []) {
  return fields
    .filter((field) => field && field.value !== undefined && field.value !== null && field.value !== '')
    .map((field) =>
      field.inline
        ? `**${field.name}:** ${field.value}`
        : `**${field.name}**\n${field.value}`,
    )
    .join('\n');
}

/**
 * Buduje kompletny kontener Components V2.
 *
 * @param {object} options
 * @param {number}  [options.color]        kolor akcentu kontenera
 * @param {string}  [options.title]        naglowek (renderowany jako "## ...")
 * @param {string}  [options.description]  tekst pod naglowkiem
 * @param {object}  [options.thumbnail]    { url, description } - naglowek staje sie Section
 * @param {Array}   [options.fields]       [{ name, value, inline }]
 * @param {Array}   [options.sections]     [{ content, button }] - Section z przyciskiem
 * @param {Array}   [options.rows]         gotowe ActionRow (przyciski / selecty)
 * @param {string}  [options.footer]       male szare info na dole
 * @param {Array}   [options.blocks]       dodatkowe bloki tekstu miedzy opisem a polami
 */
function panel({
  color = COLORS.primary,
  title,
  description,
  thumbnail,
  fields,
  sections,
  rows,
  footer,
  blocks,
} = {}) {
  const container = new ContainerBuilder().setAccentColor(color);

  const header = [title ? `## ${title}` : null, description ?? null].filter(Boolean).join('\n');

  if (header) {
    if (thumbnail?.url) {
      container.addSectionComponents(sectionWithThumbnail(header, thumbnail.url, thumbnail.description));
    } else {
      container.addTextDisplayComponents(text(header));
    }
  }

  for (const block of blocks ?? []) {
    if (block) container.addTextDisplayComponents(text(block));
  }

  const renderedFields = renderFields(fields);
  if (renderedFields) {
    if (header || blocks?.length) container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(renderedFields));
  }

  for (const section of sections ?? []) {
    if (!section) continue;
    container.addSeparatorComponents(separator({ divider: false }));
    container.addSectionComponents(
      section.button
        ? sectionWithButton(section.content, section.button)
        : new SectionBuilder().addTextDisplayComponents(text(section.content)),
    );
  }

  for (const actionRow of rows ?? []) {
    if (!actionRow) continue;
    container.addSeparatorComponents(separator({ divider: false }));
    container.addActionRowComponents(actionRow);
  }

  if (footer) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(`-# ${truncate(footer, 500)}`));
  }

  return container;
}

/** Gotowe payloady dla krotkich odpowiedzi statusowych. */
function statusPayload(emoji, color, message, { title, footer, ephemeral = true } = {}) {
  return {
    components: [
      panel({
        color,
        title: title ? `${emoji} ${title}` : undefined,
        description: title ? message : `${emoji} ${message}`,
        footer,
      }),
    ],
    flags: ephemeral ? V2_EPHEMERAL : V2_FLAGS,
    allowedMentions: { parse: [] },
  };
}

const payloads = {
  success: (message, options) => statusPayload(EMOJI.success, COLORS.success, message, options),
  error: (message, options) => statusPayload(EMOJI.error, COLORS.danger, message, options),
  warning: (message, options) => statusPayload(EMOJI.warning, COLORS.warning, message, options),
  info: (message, options) => statusPayload(EMOJI.info, COLORS.info, message, options),
};

/**
 * Odpowiada na interakcje, wybierajac reply/editReply/followUp zaleznie od stanu.
 * Przy edycji odroczonej odpowiedzi zostawiamy wylacznie flage Components V2 —
 * o tym, czy odpowiedz jest ephemeral, decyduje moment deferReply().
 */
async function respond(interaction, payload) {
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply({ ...payload, flags: V2_FLAGS });
  }
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

const reply = {
  success: (interaction, message, options) => respond(interaction, payloads.success(message, options)),
  error: (interaction, message, options) => respond(interaction, payloads.error(message, options)),
  warning: (interaction, message, options) => respond(interaction, payloads.warning(message, options)),
  info: (interaction, message, options) => respond(interaction, payloads.info(message, options)),
  panel: (interaction, container, { ephemeral = true, allowedMentions = { parse: [] } } = {}) =>
    respond(interaction, {
      components: Array.isArray(container) ? container : [container],
      flags: ephemeral ? V2_EPHEMERAL : V2_FLAGS,
      allowedMentions,
    }),
};

module.exports = {
  COLORS,
  EMOJI,
  V2_FLAGS,
  V2_EPHEMERAL,
  text,
  separator,
  section: sectionWithButton,
  sectionWithButton,
  sectionWithThumbnail,
  row,
  button,
  panel,
  payloads,
  reply,
  respond,
};
