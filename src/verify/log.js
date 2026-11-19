const { EmbedBuilder } = require('discord.js');
const { describeLocation, describeConnection } = require('./ip');
const ua = require('./useragent');

const COLOR_OK = 0x57f287;
const COLOR_RISKY = 0xe74c3c;

const accountAge = (createdAt, now = Date.now()) => {
  const days = Math.max(Math.floor((now - createdAt) / 86_400_000), 0);
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;

  const years = Math.floor(days / 365);
  const rest = Math.floor((days % 365) / 30);
  return `${years} year${years === 1 ? '' : 's'}${rest ? `, ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
};

const userValue = (entry) => {
  const name = entry.username ? `${entry.username}\n` : '';
  return `${name}\`${entry.userId}\``;
};

const ipValue = (entry) => {
  if (!entry.address) return '`unavailable`';
  if (entry.risky) return `\`${entry.address}\`\n⚠️ ${entry.riskReason ?? 'VPN / proxy'}`;
  return `\`${entry.address}\``;
};

/**
 * The verification log card: identity, address, location, device, and any
 * accounts already known on the same residential address.
 */
const buildVerifyEmbed = (guildName, entry, sharedWith = []) => {
  const embed = new EmbedBuilder()
    .setColor(entry.risky ? COLOR_RISKY : COLOR_OK)
    .setAuthor({ name: `${entry.username ?? 'Member'} verified`, iconURL: entry.avatarUrl ?? undefined })
    .setTitle(entry.risky ? '✅ Verified — flagged address' : '✅ Successfully Verified')
    .addFields(
      { name: '👤 User', value: userValue(entry), inline: true },
      { name: '🌐 Client IP', value: ipValue(entry), inline: true },
      { name: '📅 Account Age', value: entry.accountAge ?? 'unknown', inline: true },
      { name: '📍 IP Info', value: describeLocation(entry.geo), inline: true },
      { name: '🔗 Connection', value: describeConnection(entry.geo), inline: true },
      { name: '💻 Device', value: ua.describe(entry.userAgent), inline: true }
    )
    .setFooter({ text: guildName })
    .setTimestamp();

  if (entry.email) {
    embed.addFields({ name: '✉️ Email', value: `\`${entry.email}\``, inline: true });
  }

  if (sharedWith.length) {
    embed.addFields({
      name: '⚠️ Linked accounts',
      value: sharedWith
        .map((account) => `<@${account.userId}>${account.username ? ` (${account.username})` : ''}`)
        .join('\n'),
    });
  }

  if (entry.risky) {
    embed.addFields({
      name: '🚩 Note',
      value: `${entry.riskReason}. This address is shared infrastructure — it is **not** used to link accounts.`,
    });
  }

  if (entry.blocked) {
    embed.setColor(0xed4245).addFields({
      name: '⛔ Blocked',
      value: 'Verification was refused because this server rejects VPN / proxy addresses.',
    });
  }

  return embed;
};

module.exports = { buildVerifyEmbed, accountAge, COLOR_OK, COLOR_RISKY };
