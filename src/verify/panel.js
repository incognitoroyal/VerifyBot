const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../logger').create('panel');
const { stateStore, getGuild } = require('../store');

const PANEL_TEXT = [
  '**Verify to unlock the server.**',
  '',
  'Press **Verify** and approve the Discord prompt. You are added to the verified role immediately.',
  'Verification records your account age, device and network details for moderation purposes — ' +
    'that is how ban evasion gets caught.',
].join('\n');

const verifyUrl = () => (config.verify.publicUrl ? `${config.verify.publicUrl}/verify` : null);

const isReady = () =>
  Boolean(verifyUrl() && config.clientId && config.verify.clientSecret);

/**
 * Posts the Verify panel in the given channel. Re-running it replaces the
 * previous panel so the channel never fills up with duplicates.
 */
const ensureVerifyPanel = async (guild, channel) => {
  if (!channel) return null;

  const state = await stateStore.update((s) => s);
  const guildState = getGuild(state, guild.id);
  const existingId = guildState.panelMessageId;

  if (existingId) {
    let oldChannel = guildState.panelChannelId
      ? guild.channels.cache.get(guildState.panelChannelId)
      : null;

    if (!oldChannel && guildState.panelChannelId && typeof guild.channels.fetch === 'function') {
      oldChannel = await guild.channels.fetch(guildState.panelChannelId).catch(() => null);
    }

    oldChannel ??= channel;
    const existing = await oldChannel?.messages?.fetch(existingId).catch(() => null);
    if (existing) await existing.delete().catch(() => {});
  }

  const ready = isReady();
  const embed = new EmbedBuilder()
    .setTitle('✅ Verification')
    .setDescription(PANEL_TEXT)
    .setTimestamp();

  const components = [];

  if (ready) {
    embed.setColor(0x57f287);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Verify')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Link)
          .setURL(verifyUrl())
      )
    );
  } else {
    embed.setColor(0xf39c12).addFields({
      name: '⚠️ Not configured',
      value: [
        'Set `PUBLIC_URL`, `CLIENT_ID` and `CLIENT_SECRET`, then re-run `/verify panel`.',
        `Redirect URI to register: \`${config.verify.publicUrl || 'https://your-domain.example'}/verify/callback\``,
      ].join('\n'),
    });
  }

  const message = await channel.send({ embeds: [embed], components });

  await stateStore.update((s) => {
    const g = getGuild(s, guild.id);
    g.panelMessageId = message.id;
    g.panelChannelId = channel.id;
  });

  logger.info(`Verification panel posted in #${channel.name}${ready ? '' : ' (unconfigured)'}`);
  return message;
};

module.exports = { ensureVerifyPanel, verifyUrl, isReady, PANEL_TEXT };
