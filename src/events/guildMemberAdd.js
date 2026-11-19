const { Events, ChannelType, EmbedBuilder } = require('discord.js');
const { stateStore, getGuild } = require('../store');
const { findMemberRole, findUnverifiedRole, ensureUnverifiedRole } = require('../roles');
const logger = require('../logger').create('welcome');

/** Where the greeting goes: the panel channel, or a channel named like #verify. */
const resolveGreetingChannel = (guild, guildState) => {
  const panelId = guildState?.panelChannelId;
  if (panelId) {
    const byId = guild.channels.cache.get(panelId);
    if (byId?.type === ChannelType.GuildText) return byId;
  }

  return (
    guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && /verify/i.test(channel.name)
    ) ?? null
  );
};

const greeting = (member, verifyChannelId) =>
  new EmbedBuilder()
    .setColor(0x6c5ce7)
    .setDescription(
      [
        `Welcome <@${member.id}> to **${member.guild.name}**!`,
        '',
        verifyChannelId
          ? `Press **Verify** in <#${verifyChannelId}> to unlock the server.`
          : 'Verify to unlock the server.',
      ].join('\n')
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setTimestamp();

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user?.bot) return;

    let guildState = {};
    try {
      const state = await stateStore.update((s) => s);
      guildState = getGuild(state, member.guild.id);
    } catch (err) {
      logger.debug(`Could not read state for ${member.guild.name}`, err.message);
    }

    // Gate first: the member should land on #verify even if the greeting fails.
    try {
      const memberRole = findMemberRole(member.guild);

      if (memberRole && member.roles?.cache?.has?.(memberRole.id)) {
        logger.debug(`${member.user?.tag} is already verified; no gate applied`);
      } else {
        const role = findUnverifiedRole(member.guild) ?? (await ensureUnverifiedRole(member.guild));

        if (role) {
          await member.roles.add(role, 'Awaiting verification');
        } else {
          logger.warn(`No Unverified role in ${member.guild.name}; new member is ungated`);
        }
      }
    } catch (err) {
      logger.error(`Could not gate ${member.user?.tag}`, err.message);
    }

    try {
      const channel = resolveGreetingChannel(member.guild, guildState);
      if (!channel) {
        logger.debug('No channel to greet in; greeting skipped');
        return;
      }

      const posted = await channel.send({
        content: `Welcome <@${member.id}> to **${member.guild.name}**!`,
        embeds: [greeting(member, channel.id)],
        allowedMentions: { users: [member.id] },
      });

      // The welcome is shown briefly, then removed so the channel stays clean.
      const timer = setTimeout(() => {
        posted?.delete().catch(() => {});
      }, 10_000);
      timer.unref?.();
    } catch (err) {
      logger.error(`Welcome message failed for ${member.user?.tag}`, err.message);
    }
  },

  _internal: { resolveGreetingChannel },
};
