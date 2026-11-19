/**
 * Client IP extraction and geolocation.
 *
 * Discord's gateway never exposes a member's IP. The address is captured on
 * your own OAuth2 callback, which is exactly how every "verify + IP log" bot
 * works. It is the visitor's connection address — or their VPN's.
 */
const net = require('node:net');

/** Networks that are never a useful "real user" location. */
const VPN_HOSTING_HINTS = [
  'cloudflare',
  'amazon',
  'aws',
  'google',
  'microsoft',
  'azure',
  'digitalocean',
  'ovh',
  'hetzner',
  'linode',
  'vultr',
  'm247',
  'contabo',
  'oracle',
  'akamai',
  'leaseweb',
  'choopa',
  'scaleway',
  'upcloud',
  'alibaba',
  'tencent',
  'nordvpn',
  'expressvpn',
  'surfshark',
  'proton',
  'mullvad',
  'private internet access',
  'ipvanish',
  'cyberghost',
  'hostinger',
  'datacamp',
  'quadranet',
  'tzulo',
  'psychz',
];

const stripPort = (value) => {
  let ip = String(value ?? '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('[')) ip = ip.replace(/^\[/, '').replace(/\](:\d+)?$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip;
};

const isPrivate = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    return false;
  }

  return true; // not an address at all
};

/**
 * First public address in the proxy chain. Behind a reverse proxy the request
 * arrives from the proxy, so X-Forwarded-For carries the real client.
 * Set TRUST_PROXY=false when the bot is directly exposed to the internet.
 */
const clientIp = (req, trustProxy = true) => {
  const chain = [];

  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    if (typeof header === 'string') chain.push(...header.split(','));
    else if (Array.isArray(header)) chain.push(...header);
  }

  chain.push(req.socket?.remoteAddress, req.connection?.remoteAddress);

  for (const candidate of chain) {
    const ip = stripPort(candidate);
    if (ip && net.isIP(ip) && !isPrivate(ip)) return ip;
  }
  return null;
};

const GEO_FIELDS =
  'status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query';

/**
 * ip-api.com: no key required, roughly 45 requests/minute, HTTP only.
 * The call is server-to-server, so there is no mixed-content problem.
 * Swap this function for another provider if you need HTTPS or more volume.
 */
const geolocate = async (ip, { timeoutMs = 4000 } = {}) => {
  if (!ip || !net.isIP(ip)) return { ok: false, error: 'no usable IP', query: ip };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${GEO_FIELDS}`,
      { signal: controller.signal }
    );
    const data = await res.json();

    if (data.status !== 'success') {
      return { ok: false, error: data.message || 'lookup failed', query: ip };
    }
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message, query: ip };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Decides whether an address is trustworthy as an identity signal.
 * VPN, proxy and hosting addresses are shared by thousands of people, so they
 * are never used to link accounts. Otherwise one exit node would make the
 * whole server look like alts of each other.
 */
const classify = (geo) => {
  if (!geo?.ok) return { risky: false, reason: null, label: 'unknown' };

  const haystack = `${geo.isp ?? ''} ${geo.org ?? ''} ${geo.as ?? ''}`.toLowerCase();
  const hint = VPN_HOSTING_HINTS.find((needle) => haystack.includes(needle));

  if (geo.proxy) return { risky: true, reason: 'VPN / proxy exit node', label: 'vpn' };
  if (geo.hosting) return { risky: true, reason: 'datacenter / hosting IP', label: 'hosting' };
  if (hint) return { risky: true, reason: `${hint} network — VPN/hosting`, label: 'vpn' };

  return { risky: false, reason: null, label: 'residential' };
};

const flagEmoji = (countryCode) =>
  typeof countryCode === 'string' && /^[A-Za-z]{2}$/.test(countryCode)
    ? String.fromCodePoint(
        ...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
      )
    : '🌐';

const describeLocation = (geo) => {
  if (!geo?.ok) return 'Unknown';
  const parts = [geo.city, geo.regionName, geo.country].filter(Boolean);
  return `${flagEmoji(geo.countryCode)} ${parts.join(', ') || 'Unknown'}`;
};

const describeConnection = (geo) => {
  if (!geo?.ok) return 'Unknown';
  return [geo.isp, geo.as].filter(Boolean).join(' • ') || 'Unknown';
};

module.exports = {
  stripPort,
  isPrivate,
  clientIp,
  geolocate,
  classify,
  flagEmoji,
  describeLocation,
  describeConnection,
  VPN_HOSTING_HINTS,
};
