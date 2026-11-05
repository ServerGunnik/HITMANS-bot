'use strict';

const { Events } = require('discord.js');

const guilds = require('../database/repositories/guilds');
const recruitment = require('../database/repositories/recruitment');
const serverLogs = require('../services/serverLogs');
const security = require('../services/security');
const logger = require('../utils/logger');
const { COLORS } = require('../ui/components');
const { timestamp } = require('../utils/format');

/**
 * Nowy uzytkownik dostaje automatycznie role "Gosc"/"Rekrut",
 * ktora nie ma dostepu do kanalow klanowych (uprawnienia ustawia /setup).
 */
module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await serverLogs.send(member.guild, 'members', {
      title: member.user.bot ? 'Bot dodany na serwer' : 'Nowy czlonek',
      color: COLORS.success,
      thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
      fields: [
        { name: 'Uzytkownik', value: serverLogs.describeUser(member.user) },
        { name: 'Konto utworzone', value: timestamp(member.user.createdAt, 'R'), inline: true },
        { name: 'Czlonkow na serwerze', value: String(member.guild.memberCount), inline: true },
      ],
      footer: `ID: ${member.id}`,
    });

    // Bezpieczenstwo: raid / min. wiek konta (moze wywalic uzytkownika przed nadaniem rangi).
    await security.handleMemberJoin(member).catch((error) => logger.warn('Security join:', error.message));
    // Sprawdz, czy uzytkownik nadal jest na serwerze po security check.
    if (!member.guild.members.cache.has(member.id)) return;

    if (member.user.bot) return;

    const settings = guilds.get(member.guild.id);

    // Ktos, kto juz zdal rekrutacje i wrocil na serwer, od razu dostaje role czlonka.
    const latest = recruitment.getLatestApplication(member.guild.id, member.id);
    const memberRole = settings.member_role_id ? member.guild.roles.cache.get(settings.member_role_id) : null;
    if (latest?.status === 'accepted' && memberRole?.editable) {
      try {
        await member.roles.add(memberRole, `Powrot czlonka (zgloszenie #${latest.id} zaakceptowane)`);
        return;
      } catch (error) {
        logger.warn(`Nie udalo sie przywrocic roli czlonka uzytkownikowi ${member.id}:`, error.message);
      }
    }

    if (!settings.guest_role_id) return;

    const role = member.guild.roles.cache.get(settings.guest_role_id);
    if (!role) {
      logger.warn(`Rola goscia (${settings.guest_role_id}) nie istnieje na serwerze ${member.guild.id}.`);
      return;
    }

    const me = member.guild.members.me;
    if (!me || role.position >= me.roles.highest.position) {
      logger.warn(
        `Nie moge nadac roli goscia na serwerze ${member.guild.id} — rola bota jest zbyt nisko w hierarchii.`,
      );
      return;
    }

    try {
      await member.roles.add(role, 'Automatyczna rola dla nowego uzytkownika');
      logger.debug(`Nadano role ${role.name} uzytkownikowi ${member.user.tag} (${member.guild.name}).`);
    } catch (error) {
      logger.warn(`Nie udalo sie nadac roli goscia uzytkownikowi ${member.id}:`, error.message);
    }
  },
};
