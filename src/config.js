const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

// .env wins, then .env.local overrides it. On a host both files may be absent
// and the variables are supplied by the platform instead.
for (const [file, override] of [['.env', false], ['.env.local', true]]) {
  const target = path.join(ROOT, file);
  if (fs.existsSync(target)) require('dotenv').config({ path: target, override, quiet: true });
}

const num = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const config = {
  root: ROOT,
  dataDir: process.env.DATA_DIR
    ? path.resolve(ROOT, process.env.DATA_DIR)
    : path.join(ROOT, 'data'),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),

  token: (process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim(),
  clientId: (process.env.CLIENT_ID || process.env.APPLICATION_ID || '').trim(),
  guildId: (process.env.GUILD_ID || '').trim(),

  memberRoleId: (process.env.MEMBER_ROLE_ID || '').trim(),
  unverifiedRoleId: (process.env.UNVERIFIED_ROLE_ID || '').trim(),
  verifyLogChannelId: (process.env.VERIFY_LOG_CHANNEL_ID || '').trim(),

  verify: {
    clientSecret: (process.env.CLIENT_SECRET || '').trim(),
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
    port: num(process.env.PORT ?? process.env.SERVER_PORT, 3000),
    blockVpn: bool(process.env.BLOCK_VPN, false),
    trustProxy: bool(process.env.TRUST_PROXY, true),
    stateSecret: (process.env.STATE_SECRET || process.env.CLIENT_SECRET || '').trim(),
    redirectPath: '/verify/callback',
    scopes: (process.env.VERIFY_SCOPES || 'identify').trim(),
  },
};

config.assertRuntime = () => {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (!config.verify.clientSecret) missing.push('CLIENT_SECRET');
  if (!config.verify.publicUrl) missing.push('PUBLIC_URL');
  if (!config.guildId) missing.push('GUILD_ID');

  if (missing.length) {
    throw new Error(
      `Missing environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
  }
};

module.exports = config;
