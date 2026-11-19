/**
 * Discord OAuth2 helpers.
 *
 * The `state` parameter is HMAC-signed instead of stored in memory, so a bot
 * restart between pressing Verify and approving the consent screen does not
 * break the flow. It also stops anyone from forging a callback URL.
 */
const crypto = require('node:crypto');

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/oauth2/token';
const API = 'https://discord.com/api/v10';

const redirectUri = (config) => `${config.verify.publicUrl}${config.verify.redirectPath}`;

/** Creates `timestamp.nonce.signature`, valid for 10 minutes. */
const signState = (secret) => {
  const payload = `${Date.now()}.${crypto.randomBytes(12).toString('hex')}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
};

/** Returns true only when the signature is valid and the state is fresh. */
const readState = (state, secret, maxAgeMs = 10 * 60 * 1000) => {
  if (typeof state !== 'string') return false;

  const parts = state.split('.');
  if (parts.length !== 3) return false;

  const [ts, nonce, sig] = parts;
  const payload = `${ts}.${nonce}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);

  const provided = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
    return false;
  }

  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
};

const authorizeUrl = (config, state) => {
  const scopes = String(config.verify.scopes || 'identify')
    .split(/[\s,]+/)
    .filter(Boolean);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(config),
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    prompt: 'consent',
  });

  return `${AUTHORIZE}?${params.toString()}`;
};

const exchangeCode = async (config, code) => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.verify.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config),
  });

  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `token exchange failed (${res.status})`);
  }
  return data;
};

const fetchUser = async (accessToken) => {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`user fetch failed (${res.status})`);
  return res.json();
};

module.exports = {
  signState,
  readState,
  authorizeUrl,
  exchangeCode,
  fetchUser,
  redirectUri,
};
