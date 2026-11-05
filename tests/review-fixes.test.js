'use strict';

require('./setup');

const assert = require('node:assert/strict');
const { describe, it, before } = require('node:test');
const { PermissionFlagsBits } = require('discord.js');

const database = require('../src/database');
const recruitment = require('../src/database/repositories/recruitment');
const starboard = require('../src/services/starboard');
const { checkSelfAssignableRole, isOfficer } = require('../src/utils/permissions');
const { parseLeaveDate } = require('../src/utils/clanTime');

const GUILD = 'guild-review';

/** Minimalny obiekt uprawnien: has(flag) sprawdza liste flag. */
function permissions(flags = []) {
  return { has: (flag) => flags.includes(flag) };
}

describe('poprawki po przegladzie', () => {
  before(() => database.init());

  describe('starboard — tylko publiczne kanaly', () => {
    const everyone = { id: GUILD };
    const guild = { roles: { everyone } };
    const message = (channel) => ({ guild, channel });

    it('pomija kanal niewidoczny dla @everyone', () => {
      const hidden = { permissionsFor: () => permissions([]), nsfw: false };
      assert.equal(starboard.isPublicSource(message(hidden), { nsfw: false }), false);
    });

    it('przepuszcza kanal publiczny', () => {
      const open = { permissionsFor: () => permissions([PermissionFlagsBits.ViewChannel]), nsfw: false };
      assert.equal(starboard.isPublicSource(message(open), { nsfw: false }), true);
    });

    it('NSFW trafia tylko na starboard NSFW', () => {
      const nsfw = { permissionsFor: () => permissions([PermissionFlagsBits.ViewChannel]), nsfw: true };
      assert.equal(starboard.isPublicSource(message(nsfw), { nsfw: false }), false);
      assert.equal(starboard.isPublicSource(message(nsfw), { nsfw: true }), true);
    });
  });

  describe('starboard — liczenie gwiazdek', () => {
    it('ponizej progu nie pobiera listy reagujacych', async () => {
      const reaction = {
        count: 2,
        users: {
          fetch: () => {
            throw new Error('nie powinno pobierac');
          },
        },
      };
      assert.equal(await starboard.countReactionStars(reaction, 'autor', 3), 2);
    });

    it('odejmuje autora i boty od licznika', async () => {
      const users = new Map([
        ['autor', { id: 'autor', bot: false }],
        ['bot', { id: 'bot', bot: true }],
        ['a', { id: 'a', bot: false }],
        ['b', { id: 'b', bot: false }],
      ]);
      const reaction = { count: 4, users: { fetch: async () => users } };
      assert.equal(await starboard.countReactionStars(reaction, 'autor', 3), 2);
    });
  });

  describe('powrot na serwer', () => {
    it('pamieta, czy wychodzacy mial role czlonka', () => {
      assert.equal(recruitment.hadMemberRoleOnExit(GUILD, 'nieznany'), false);
      recruitment.recordExit(GUILD, 'czlonek', true);
      assert.equal(recruitment.hadMemberRoleOnExit(GUILD, 'czlonek'), true);
      // ktos zostal usuniety z klanu i dopiero potem wyszedl
      recruitment.recordExit(GUILD, 'czlonek', false);
      assert.equal(recruitment.hadMemberRoleOnExit(GUILD, 'czlonek'), false);
    });
  });

  describe('rola nadawana samoobslugowo', () => {
    const guild = {
      members: { me: { permissions: permissions([PermissionFlagsBits.ManageRoles]), roles: { highest: { position: 10 } } } },
      roles: { everyone: { id: 'everyone' } },
    };

    it('odrzuca role z niebezpiecznymi uprawnieniami', () => {
      const role = { id: 'r', position: 1, managed: false, permissions: permissions([PermissionFlagsBits.KickMembers]) };
      const result = checkSelfAssignableRole(guild, role);
      assert.equal(result.ok, false);
      assert.match(result.reason, /niebezpieczne/);
    });

    it('przepuszcza zwykla role', () => {
      const role = { id: 'r', position: 1, managed: false, permissions: permissions([]) };
      assert.equal(checkSelfAssignableRole(guild, role).ok, true);
    });
  });

  describe('oficer — jedna definicja', () => {
    const member = (flags) => ({
      id: 'x',
      guild: { id: GUILD, ownerId: 'owner' },
      permissions: permissions(flags),
      roles: { cache: new Map() },
    });

    it('Zarzadzanie wydarzeniami i Moderowanie czlonkami daja oficera', () => {
      assert.equal(isOfficer(member([PermissionFlagsBits.ManageEvents])), true);
      assert.equal(isOfficer(member([PermissionFlagsBits.ModerateMembers])), true);
      assert.equal(isOfficer(member([])), false);
    });
  });

  describe('daty urlopu', () => {
    const now = Date.UTC(2026, 10, 5, 12, 0, 0);

    it('przyjmuje tez formaty z godzina z /event i /przypomnij', () => {
      assert.equal(new Date(parseLeaveDate('jutro 20:00', now)).toISOString(), '2026-11-06T19:00:00.000Z');
      assert.equal(parseLeaveDate('za 30 minut', now), now + 30 * 60 * 1000);
      assert.equal(parseLeaveDate('za 7d', now), now + 7 * 24 * 60 * 60 * 1000);
      assert.equal(parseLeaveDate('bzdura', now), null);
    });
  });
});
