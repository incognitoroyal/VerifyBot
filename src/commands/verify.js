const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { stateStore, getGuild } = require('../store');
const { findMemberRole, findUnverifiedRole } = require('../roles');
const { ensureVerifyPanel, isReady } = require('../verify/panel');
const { redirectUri } = require('../verify/oauth');

const EPHEMERAL = MessageFlags.Ephemeral;

const blockVpnFor = (guildState) => guildState.verify?.blockVpn ?? config.verify.blockVpn;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification settings and panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Post or refresh the Verify panel in this channel.')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show the current verification configuration.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('Choose whether VPN / proxy addresses can verify.')
        .addBooleanOption((option) =>
          option
            .setName('block-vpn')
            .setDescription('true = reject VPN/proxy users, false = allow and flag them')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Admins only.',
        flags: EPHEMERAL,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (!interaction.channel?.isTextBased()) {
        return interaction.reply({
          content: 'Run this in a text channel.',
          flags: EPHEMERAL,
        });
      }

      // Posting the panel can involve deleting the old one and sending a new
      // message, so acknowledge first to stay inside Discord's 3s window.
      await interaction.deferReply({ flags: EPHEMERAL });

      try {
        await ensureVerifyPanel(interaction.guild, interaction.channel);
      } catch (err) {
        return interaction.editReply({
          content: `Could not post the panel: ${err.message}`,
        });
      }

      return interaction.editReply({
        content: isReady()
          ? 'Verify panel posted.'
          : 'Panel posted, but OAuth is not configured yet. Fill in `PUBLIC_URL`, `CLIENT_ID` and `CLIENT_SECRET`, then run `/verify panel` again.',
      });
    }

    if (sub === 'settings') {
      const block = interaction.options.getBoolean('block-vpn');

      await stateStore.update((state) => {
        const guild = getGuild(state, interaction.guild.id);
        guild.verify ??= {};
        guild.verify.blockVpn = block;
      });

      return interaction.reply({
        content: block
          ? 'VPN / proxy / datacenter addresses are now **rejected** at verification.'
          : 'VPN / proxy / datacenter addresses are now **allowed**. They are flagged on the log and never used to link accounts.',
        flags: EPHEMERAL,
      });
    }

    const state = await stateStore.update((s) => s);
    const guildState = getGuild(state, interaction.guild.id);
    const memberRole = findMemberRole(interaction.guild);
    const unverifiedRole = findUnverifiedRole(interaction.guild);
    const blockVpn = blockVpnFor(guildState);
    const logChannel = config.verifyLogChannelId
      ? `<#${config.verifyLogChannelId}>`
      : 'by channel name `verify-logs`';

    const embed = new EmbedBuilder()
      .setTitle('Verification settings')
      .setColor(blockVpn ? 0xe74c3c : 0x57f287)
      .addFields(
        { name: 'Configured', value: isReady() ? 'yes' : 'no', inline: true },
        { name: 'VPN users', value: blockVpn ? 'rejected' : 'allowed + flagged', inline: true },
        { name: 'Grants', value: memberRole ? `<@&${memberRole.id}>` : 'not found', inline: true },
        {
          name: 'Removes',
          value: unverifiedRole ? `<@&${unverifiedRole.id}>` : 'not found',
          inline: true,
        },
        { name: 'Logs to', value: logChannel, inline: true },
        {
          name: 'Public URL',
          value: config.verify.publicUrl ? `\`${config.verify.publicUrl}\`` : 'not set',
          inline: true,
        },
        {
          name: 'Redirect URI',
          value: `\`${config.verify.publicUrl ? redirectUri(config) : 'not set'}\``,
          inline: false,
        }
      )
      .setFooter({ text: 'Change the VPN policy with /verify settings' });

    return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  },

  _internal: { blockVpnFor },
};
