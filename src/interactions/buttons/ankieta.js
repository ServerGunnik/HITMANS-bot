'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const pollsRepo = require('../../database/repositories/polls');
const pollsService = require('../../services/polls');
const { isAdmin } = require('../../utils/permissions');
const { COLORS, panel, reply, V2_FLAGS } = require('../../ui/components');
const { plural } = require('../../utils/format');

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];

function canManage(member, poll) {
  return member.id === poll.author_id || isAdmin(member) || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

async function handleVote(interaction, poll, optionId) {
  const option = poll.options.find((entry) => entry.id === optionId);
  if (!option) {
    return reply.error(interaction, 'Ta opcja juz nie istnieje.');
  }

  const outcome = pollsRepo.toggleVote({
    pollId: poll.id,
    optionId,
    userId: interaction.user.id,
    multi: poll.multi,
  });

  await interaction.deferUpdate();
  const refreshed = pollsRepo.get(poll.id);
  await interaction.message.edit({
    components: [pollsService.buildPanel(refreshed)],
    flags: V2_FLAGS,
    allowedMentions: { parse: [] },
  });

  return interaction.followUp({
    ...(outcome === 'added'
      ? { components: [panel({ color: COLORS.success, description: `✅ Oddano glos na **${option.label}**.` })] }
      : { components: [panel({ color: COLORS.warning, description: `↩️ Wycofano glos z **${option.label}**.` })] }),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  namespace: pollsService.NAMESPACE,

  async execute(interaction, { action, args }) {
    const pollId = Number(args[0]);
    const poll = pollsRepo.get(pollId);

    if (!poll || poll.guild_id !== interaction.guild.id) {
      return reply.error(interaction, 'Nie znalazlem tej ankiety w bazie.');
    }

    if (action === 'vote') {
      if (poll.closed) return reply.error(interaction, 'Ta ankieta jest juz zamknieta.');
      return handleVote(interaction, poll, Number(args[1]));
    }

    if (action === 'results') {
      const { options, uniqueVoters } = pollsRepo.tally(poll.id);
      const totalVotes = options.reduce((sum, entry) => sum + entry.votes, 0);

      const lines = options
        .map((option, index) => {
          const percent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
          const emoji = LETTERS[index] ?? '•';
          const voters = poll.anonymous
            ? ''
            : (() => {
                const list = pollsRepo.votersFor(option.id);
                if (list.length === 0) return '\n> *brak glosow*';
                const shown = list.slice(0, 10).map((id) => `<@${id}>`).join(', ');
                const more = list.length > 10 ? ` … +${list.length - 10}` : '';
                return `\n> ${shown}${more}`;
              })();
          return `${emoji} **${option.label}** — ${option.votes} (${percent}%)${voters}`;
        })
        .join('\n\n');

      return reply.panel(
        interaction,
        panel({
          color: COLORS.info,
          title: `📊 Wyniki: ${poll.question}`,
          blocks: [lines || '*Brak glosow.*'],
          footer: `${totalVotes} ${plural(totalVotes, 'glos', 'glosy', 'glosow')} od ${uniqueVoters} ${plural(uniqueVoters, 'osoby', 'osob', 'osob')}${poll.anonymous && !poll.closed ? ' • ankieta anonimowa' : ''}`,
        }),
      );
    }

    if (action === 'close') {
      if (!canManage(interaction.member, poll)) {
        return reply.error(interaction, 'Tylko autor ankiety lub administrator moze ja zamknac.');
      }
      if (poll.closed) return reply.error(interaction, 'Ankieta jest juz zamknieta.');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await pollsService.closePoll(interaction.client, poll.id);
      return reply.success(interaction, 'Ankieta zamknieta. Wyniki sa widoczne w oryginalnej wiadomosci.');
    }
  },
};
