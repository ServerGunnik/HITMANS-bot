'use strict';

const { InteractionContextType, SlashCommandBuilder } = require('discord.js');

const guilds = require('../../database/repositories/guilds');
const economyService = require('../../services/economy');
const games = require('../../services/games');
const { COLORS, panel, reply } = require('../../ui/components');

/**
 * Losowa praca z listy „zawodow" — kazdy daje inna wyplate.
 * Cooldown to 1h, zeby /praca nie zastapila pasywnego zarabiania.
 */
const JOBS = [
  { title: 'kelnera w pubie', min: 80, max: 200, flavor: 'Nalales piw kibicom w barze pod stadionem.' },
  { title: 'malarza grafitti', min: 120, max: 280, flavor: 'Pomalowales mur przed derbami.' },
  { title: 'sprzedawcy szalikow', min: 100, max: 240, flavor: 'Rozprowadziles szaliki na meczu.' },
  { title: 'ochroniarza sektora', min: 150, max: 350, flavor: 'Pilnowales sektora rodzinnego.' },
  { title: 'kierowcy autokaru', min: 200, max: 400, flavor: 'Zawiozles ekipe na wyjazd.' },
  { title: 'ultrasa liderskiego', min: 250, max: 500, flavor: 'Prowadziles doping caly mecz.' },
  { title: 'producenta sektorowki', min: 300, max: 600, flavor: 'Odpaliles pirotechnike na trybunie.' },
  { title: 'dilera flag', min: 90, max: 250, flavor: 'Sprzedales partie flag przed meczem.' },
  { title: 'redaktora forum', min: 70, max: 180, flavor: 'Napisales relacje na klanowym forum.' },
  { title: 'kucharza na wyjezdzie', min: 110, max: 270, flavor: 'Nakarmiles ekipe w drodze na mecz.' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('praca')
    .setDescription('Idz do pracy i zarob punkty (cooldown 1h)')
    .setContexts(InteractionContextType.Guild),

  cooldown: 5,

  async execute(interaction) {
    const { guild, user } = interaction;

    if (!guilds.get(guild.id).economy_enabled) {
      return reply.error(interaction, 'Ekonomia jest wylaczona na tym serwerze.');
    }

    const status = games.checkCooldown(guild.id, user.id, 'work');
    if (!status.ready) {
      return reply.warning(
        interaction,
        `Odpocznij chwile — nastepna praca za **${games.formatCooldown(status.remaining)}**.`,
      );
    }

    const job = games.pickRandom(JOBS);
    const payout = games.randomInt(job.min, job.max);

    games.awardEarn({
      guildId: guild.id,
      userId: user.id,
      amount: payout,
      kind: 'work',
      reason: `Praca: ${job.title}`,
    });
    games.stampCooldown(guild.id, user.id, 'work');

    const balance = economyService.formatCurrency(
      guild.id,
      status.account.balance + payout,
      { short: true },
    );

    const container = panel({
      color: COLORS.success,
      title: '💼 Praca wykonana',
      description: `Zatrudniles sie jako **${job.title}**.\n${job.flavor}`,
      fields: [
        { name: 'Wyplata', value: economyService.formatCurrency(guild.id, payout), inline: true },
        { name: 'Twoje saldo', value: balance, inline: true },
      ],
      footer: 'Nastepna zmiana za 1 godzine.',
    });

    return reply.panel(interaction, container, { ephemeral: false });
  },
};
