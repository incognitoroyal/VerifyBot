/**
 * OAuth2 verification service.
 *
 * Discord never gives bots a member's IP. The address is captured here, on
 * your own callback hit, which is exactly how every "verify + IP log" bot
 * works.
 */
const express = require('express');
const { AttachmentBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../logger').create('verify');
const { stateStore, getGuild } = require('../store');
const { findMemberRole, findUnverifiedRole, hierarchyWarning } = require('../roles');
const { clientIp, geolocate, classify } = require('./ip');
const { fetchMap } = require('./map');
const {
  signState,
  readState,
  authorizeUrl,
  exchangeCode,
  fetchUser,
  redirectUri,
} = require('./oauth');
const { saveVerification } = require('./records');
const { buildVerifyEmbed, accountAge } = require('./log');

const RATE_LIMIT = { windowMs: 5 * 60_000, max: 20 };
const buckets = new Map();

// Drop expired buckets so a stream of unique addresses cannot grow the map
// without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(ip);
  }
}, RATE_LIMIT.windowMs).unref();

const snowflakeTimestamp = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

const page = ({ title, heading, body, tone = 'ok' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Verification</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:radial-gradient(1200px 600px at 50% -10%,#2b2350,#0f0f14 60%);color:#e7e7ef}
  .card{width:min(520px,100%);background:#191920;border:1px solid #2a2a35;border-radius:16px;
        padding:32px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
  .badge{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:26px;
         margin-bottom:16px;background:${tone === 'ok' ? 'rgba(87,242,135,.14)' : 'rgba(237,66,69,.14)'}}
  h1{font-size:21px;margin:0 0 10px;letter-spacing:-.01em}
  p{margin:0;color:#a6a6b8;line-height:1.55;font-size:14.5px}
  .foot{margin-top:22px;padding-top:16px;border-top:1px solid #26262f;font-size:12.5px;color:#6f6f82}
</style></head>
<body><div class="card">
  <div class="badge">${tone === 'ok' ? '✓' : '!'}</div>
  <h1>${heading}</h1>
  <p>${body}</p>
  <div class="foot">Verification service · you can close this tab</div>
</div></body></html>`;

const sendPage = (res, status, options) => {
  res.status(status).type('html').send(page(options));
};

const rateLimit = (req, res, next) => {
  const ip = clientIp(req, config.verify.trustProxy) ?? req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT.max) {
    return sendPage(res, 429, {
      title: 'Slow down',
      heading: 'Too many attempts',
      body: 'Give it a few minutes and try again.',
      tone: 'warn',
    });
  }
  return next();
};

const resolveGuild = async (client) => {
  if (config.guildId) {
    const cached = client.guilds.cache.get(config.guildId);
    if (cached) return cached;
    return client.guilds.fetch(config.guildId).catch(() => null);
  }
  return client.guilds.cache.first() ?? null;
};

const resolveRoles = async (guild) => {
  const state = await stateStore.update((s) => s);
  getGuild(state, guild.id);

  return {
    // What verification grants: the existing "Member" role — never a new one.
    granted: findMemberRole(guild),
    // What it takes away.
    removed: findUnverifiedRole(guild),
  };
};

const logChannelFor = async (guild) => {
  if (config.verifyLogChannelId) {
    const cached = guild.channels.cache.get(config.verifyLogChannelId);
    if (cached?.isTextBased?.()) return cached;
    const fetched = await guild.channels.fetch(config.verifyLogChannelId).catch(() => null);
    if (fetched?.isTextBased?.()) return fetched;
  }
  return (
    guild.channels.cache.find(
      (channel) => channel.isTextBased?.() && /verify-?logs?/i.test(channel.name)
    ) ?? null
  );
};

const postVerifyLog = async (guild, entry, sharedWith) => {
  const channel = await logChannelFor(guild);
  if (!channel) {
    logger.warn('No verify-log channel; record saved but not posted');
    return;
  }

  const map = await fetchMap(entry.geo);
  const embed = buildVerifyEmbed(guild.name, entry, sharedWith);
  const files = [];

  if (map) {
    files.push(new AttachmentBuilder(map, { name: 'location.png' }));
    embed.setImage('attachment://location.png');
  } else if (entry.geo?.ok) {
    embed.setURL(
      `https://www.openstreetmap.org/?mlat=${entry.geo.lat}&mlon=${entry.geo.lon}` +
        `#map=11/${entry.geo.lat}/${entry.geo.lon}`
    );
  }

  await channel.send({ embeds: [embed], files }).catch((err) => {
    logger.error('Could not post verification log', err.message);
  });
};

const handleCallback = async (req, res, client) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return sendPage(res, 400, {
      title: 'Cancelled',
      heading: 'Verification cancelled',
      body: `Authorization was not granted${errorDescription ? `: ${escapeHtml(errorDescription)}` : '.'}`,
      tone: 'warn',
    });
  }

  if (!readState(state, config.verify.stateSecret)) {
    return sendPage(res, 400, {
      title: 'Expired',
      heading: 'This link expired',
      body: 'Verification links are valid for 10 minutes. Go back to Discord and press Verify again.',
      tone: 'warn',
    });
  }

  if (!code) {
    return sendPage(res, 400, {
      title: 'Bad request',
      heading: 'Missing authorization code',
      body: 'Start from the Verify button in Discord.',
      tone: 'warn',
    });
  }

  const address = clientIp(req, config.verify.trustProxy);
  const userAgent = String(req.headers['user-agent'] ?? '');

  let user;
  let email = null;
  let grantedScopes = [];

  try {
    const token = await exchangeCode(config, String(code));
    // `scope` reflects what the user actually approved, which can be narrower
    // than what was requested.
    grantedScopes = String(token.scope ?? '')
      .split(/[\s,]+/)
      .filter(Boolean);
    user = await fetchUser(token.access_token);

    if (grantedScopes.includes('email') && typeof user.email === 'string' && user.email) {
      email = user.email;
    }
  } catch (err) {
    logger.error('OAuth exchange failed', err.message);
    return sendPage(res, 502, {
      title: 'Error',
      heading: 'Discord did not confirm that login',
      body: 'That authorization code was already used or expired. Press Verify in Discord again.',
      tone: 'warn',
    });
  }

  const guild = await resolveGuild(client);
  if (!guild) {
    return sendPage(res, 503, {
      title: 'Unavailable',
      heading: 'The bot is not in a server yet',
      body: 'Ask an admin to invite the bot, then try again.',
      tone: 'warn',
    });
  }

  const guildMember = await guild.members.fetch(user.id).catch(() => null);
  if (!guildMember) {
    return sendPage(res, 403, {
      title: 'Not a member',
      heading: 'Join the server first',
      body: `You need to be in <strong>${escapeHtml(guild.name)}</strong> before verifying. Join, then press Verify again.`,
      tone: 'warn',
    });
  }

  const geo = address ? await geolocate(address) : { ok: false, error: 'no address' };

  const stateRecord = await stateStore.update((s) => s);
  const guildState = getGuild(stateRecord, guild.id);
  const blockVpn = guildState.verify?.blockVpn ?? config.verify.blockVpn;
  const risk = classify(geo);

  const entry = {
    userId: user.id,
    username: user.username,
    email,
    scopes: grantedScopes,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null,
    address,
    geo,
    risky: risk.risky,
    riskReason: risk.reason,
    userAgent,
    accountAge: accountAge(snowflakeTimestamp(user.id)),
    verifiedAt: new Date().toISOString(),
    // Explicit, so a previously blocked record does not keep the flag after
    // the same user retries without a VPN.
    blocked: false,
  };

  if (blockVpn && risk.risky) {
    await saveVerification(guild.id, { ...entry, blocked: true });
    await postVerifyLog(guild, { ...entry, verified: false, blocked: true }, []);
    logger.warn(`Verification blocked for ${user.username}: ${risk.reason}`);

    return sendPage(res, 403, {
      title: 'VPN detected',
      heading: 'Turn off your VPN and retry',
      body: 'This server does not accept verifications from VPN or datacenter addresses.',
      tone: 'warn',
    });
  }

  const { granted, removed } = await resolveRoles(guild);

  const warning = hierarchyWarning(guild, [granted, removed]);
  if (warning) logger.warn(warning);

  if (!granted) {
    logger.error('No Member role configured (MEMBER_ROLE_ID or a role named "Member")');
    return sendPage(res, 500, {
      title: 'Not configured',
      heading: 'The verified role is missing',
      body: 'An admin needs to set <code>MEMBER_ROLE_ID</code> or create a role named <strong>Member</strong>.',
      tone: 'warn',
    });
  }

  try {
    await guildMember.roles.add(granted, 'Verification');
  } catch (err) {
    logger.error(`Could not add ${granted.name} to ${user.username}`, err.message);
    return sendPage(res, 500, {
      title: 'Role error',
      heading: 'Could not assign the verified role',
      body: 'The bot role must sit above the Member role in Server Settings → Roles. Tell the staff it happened.',
      tone: 'warn',
    });
  }

  // Swapping the roles is what actually unlocks the server: Member gains the
  // channels, and losing Unverified hides #verify.
  if (removed && guildMember.roles.cache.has(removed.id)) {
    await guildMember.roles.remove(removed, 'Verified').catch((err) => {
      logger.error(`Could not remove ${removed.name} from ${user.username}`, err.message);
    });
  }

  const { sharedWith } = await saveVerification(guild.id, entry);
  await postVerifyLog(guild, entry, sharedWith);

  logger.info(`Verified ${user.username} (${user.id}) from ${address ?? 'unknown IP'}`);

  const linked = sharedWith.length
    ? `<br><br><strong>Heads up:</strong> ${sharedWith.length} other account(s) already verified from this address.`
    : '';

  return sendPage(res, 200, {
    title: 'Verified',
    heading: `You're verified, ${escapeHtml(user.username)}`,
    body: `Your access to <strong>${escapeHtml(guild.name)}</strong> is unlocked.${linked}`,
  });
};

const startVerificationServer = (client) => {
  const { port, publicUrl } = config.verify;

  const app = express();
  app.set('trust proxy', config.verify.trustProxy);
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // Diagnostic: shows the caller their own detected address, so the proxy
  // chain can be verified before wiring OAuth. Reveals nothing about others.
  app.get('/ip', (req, res) => {
    const address = clientIp(req, config.verify.trustProxy);
    res.json({
      ip: address,
      viaForwardedHeader: Boolean(req.headers['x-forwarded-for']),
      note: address ? undefined : 'no public address in the proxy chain',
    });
  });

  app.get('/', (_req, res) => {
    sendPage(res, 200, {
      title: 'Verification',
      heading: 'Verification endpoint',
      body: 'Use the Verify button in Discord.',
    });
  });

  app.get('/verify', rateLimit, (req, res) => {
    if (!config.clientId || !config.verify.clientSecret) {
      return sendPage(res, 503, {
        title: 'Not configured',
        heading: 'Verification is not configured yet',
        body: 'CLIENT_ID, CLIENT_SECRET and PUBLIC_URL must be set, and the redirect URI registered in the Discord Developer Portal.',
        tone: 'warn',
      });
    }

    return res.redirect(authorizeUrl(config, signState(config.verify.stateSecret)));
  });

  app.get(config.verify.redirectPath, rateLimit, (req, res) => {
    handleCallback(req, res, client).catch((err) => {
      logger.error('Verification callback crashed', err);
      if (!res.headersSent) {
        sendPage(res, 500, {
          title: 'Error',
          heading: 'Something broke',
          body: 'Verification failed on our side. Try again, and tell the staff it happened.',
          tone: 'warn',
        });
      }
    });
  });

  app.use((_req, res) =>
    sendPage(res, 404, { title: '404', heading: 'Not found', body: 'Nothing here.' })
  );

  const server = app.listen(port, () => {
    logger.info(`Verification server listening on :${port}`);
    if (publicUrl) logger.info(`Redirect URI: ${redirectUri(config)}`);
    else logger.warn('PUBLIC_URL is empty — the OAuth redirect will not work');
  });

  server.on('error', (err) => logger.error('Verification server error', err.message));
  return server;
};

module.exports = {
  startVerificationServer,
  postVerifyLog,
  logChannelFor,
  resolveRoles,
};
