/**
 * Static map for the verification log.
 *
 * Fetched server-side and posted as an attachment, so the log keeps working
 * even if the tile service blocks Discord's image proxy — and the IP is never
 * handed to a third party through an embed URL.
 *
 * This uses the free OpenStreetMap static-map service. If it is unavailable,
 * the log falls back to a link and still posts normally.
 */
const TILE = 'https://staticmap.openstreetmap.de/staticmap.php';

const fetchMap = async (geo, { timeoutMs = 6000 } = {}) => {
  if (!geo?.ok || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return null;

  const url =
    `${TILE}?center=${geo.lat},${geo.lon}&zoom=11&size=600x300&maptype=mapnik` +
    `&markers=${geo.lat},${geo.lon},red-pushpin`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VerifyBot/1.0 (Discord verification)' },
    });

    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { fetchMap };
