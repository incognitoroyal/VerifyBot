/**
 * Role lookup and hierarchy helpers.
 *
 * A role is resolved by saved/config ID first, then by exact name, then by a
 * case-insensitive name match. That lets the bot work whether the server uses
 * "Member" or "member", and whether the IDs are configured or not.
 */
const config = require('./config');

const MEMBER_NAMES = ['Member', 'Verified', 'Members'];
const UNVERIFIED_NAMES = ['Unverified', 'Not Verified', 'Unverified Member'];

/** Strips decorative prefixes so "・Member" and "Member" compare equal. */
const normaliseName = (name) =>
  String(name ?? '')
    .trim()
    .replace(/^[・·•\-–—_\s]+/, '')
    .trim()
    .toLowerCase();

const findRole = (guild, { id, names = [] } = {}) => {
  if (!guild?.roles?.cache) return null;

  if (id) {
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }

  for (const name of names.filter(Boolean)) {
    const exact = guild.roles.cache.find((role) => role.name === name);
    if (exact) return exact;
  }

  const wanted = names.filter(Boolean).map(normaliseName);
  return guild.roles.cache.find((role) => wanted.includes(normaliseName(role.name))) ?? null;
};

/** The role granted when a member verifies. */
const findMemberRole = (guild) =>
  findRole(guild, {
    id: config.memberRoleId,
    names: MEMBER_NAMES,
  });

/** The gate role a new member receives and verification removes. */
const findUnverifiedRole = (guild) =>
  findRole(guild, {
    id: config.unverifiedRoleId,
    names: UNVERIFIED_NAMES,
  });

/**
 * Creates the Unverified role when it is missing. It deliberately has no
 * permissions: its only job is to be removed when the member verifies.
 */
const ensureUnverifiedRole = async (guild) => {
  const existing = findUnverifiedRole(guild);
  if (existing) return existing;

  if (typeof guild.roles?.create !== 'function') return null;

  try {
    return await guild.roles.create({
      name: 'Unverified',
      color: 0x747f8d,
      hoist: false,
      mentionable: false,
      permissions: [],
      reason: 'Verification gate role',
    });
  } catch {
    return null;
  }
};

/**
 * Discord refuses to add or remove a role that sits at or above the bot's
 * highest role. Returns a human-readable warning when that is the case.
 */
const hierarchyWarning = (guild, roles) => {
  const highest = guild?.members?.me?.roles?.highest;
  if (!highest) return 'The bot could not resolve its own highest role.';

  const blocked = roles
    .filter(Boolean)
    .filter((role) => role.id !== highest.id && role.position >= highest.position);

  if (!blocked.length) return null;

  return (
    `The bot's highest role (${highest.name}) is not above ` +
    `${blocked.map((role) => role.name).join(', ')}. ` +
    'Drag the bot role above them in Server Settings → Roles.'
  );
};

module.exports = {
  findRole,
  findMemberRole,
  findUnverifiedRole,
  ensureUnverifiedRole,
  hierarchyWarning,
  MEMBER_NAMES,
  UNVERIFIED_NAMES,
};
