'use strict';

const { Events } = require('discord.js');

const logger = require('../utils/logger');
const { parse } = require('../utils/customId');
const { payloads, reply } = require('../ui/components');

/** Zwraca pozostaly czas cooldownu (ms) i rejestruje uzycie komendy. */
function checkCooldown(client, interaction, command) {
  const seconds = command.cooldown ?? 0;
  if (seconds <= 0) return 0;

  const key = `${command.data.name}:${interaction.user.id}`;
  const expiresAt = client.cooldowns.get(key) ?? 0;
  const now = Date.now();

  if (expiresAt > now) return expiresAt - now;

  client.cooldowns.set(key, now + seconds * 1000);
  setTimeout(() => client.cooldowns.delete(key), seconds * 1000).unref?.();
  return 0;
}

async function handleCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Nieznana komenda: /${interaction.commandName}`);
    return reply.error(interaction, 'Ta komenda nie jest juz dostepna.');
  }

  if (command.guildOnly !== false && !interaction.inGuild()) {
    return reply.error(interaction, 'Tej komendy mozna uzyc tylko na serwerze.');
  }

  const remaining = checkCooldown(client, interaction, command);
  if (remaining > 0) {
    return reply.error(interaction, `Odczekaj jeszcze **${Math.ceil(remaining / 1000)}s** przed ponownym uzyciem.`);
  }

  await command.execute(interaction, client);
}

async function handleComponent(interaction, client, collection, label) {
  const { namespace, action, args } = parse(interaction.customId);
  const handler = client[collection].get(namespace);

  if (!handler) {
    logger.warn(`Brak handlera ${label} dla customId "${interaction.customId}".`);
    return reply.error(interaction, 'Ten element nie jest juz obslugiwany. Sprobuj uzyc komendy ponownie.');
  }

  await handler.execute(interaction, { action, args }, client);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      if (interaction.isChatInputCommand()) return await handleCommand(interaction, client);
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) return await command.autocomplete(interaction, client);
        return await interaction.respond([]);
      }
      if (interaction.isButton()) return await handleComponent(interaction, client, 'buttons', 'przycisku');
      if (interaction.isModalSubmit()) return await handleComponent(interaction, client, 'modals', 'modalu');
      if (interaction.isAnySelectMenu()) return await handleComponent(interaction, client, 'selects', 'selecta');
    } catch (error) {
      logger.error(`Blad obslugi interakcji (${interaction.customId ?? interaction.commandName}):`, error);

      const payload = payloads.error(
        'Wystapil nieoczekiwany blad podczas wykonywania tej akcji. Sprobuj ponownie za chwile.',
      );

      try {
        if (interaction.deferred) await interaction.editReply(payload);
        else if (interaction.replied) await interaction.followUp(payload);
        else if (!interaction.isAutocomplete()) await interaction.reply(payload);
      } catch (replyError) {
        logger.debug('Nie udalo sie wyslac komunikatu o bledzie:', replyError.message);
      }
    }
  },
};
