/**
 * Verification records: who verified, from which address, and who else shares
 * it. Correlation only uses residential addresses — a shared VPN exit node is
 * not evidence that two people are the same person.
 */
const { stateStore, getGuild } = require('../store');

const MAX_IPS_PER_USER = 5;

const readAll = async (guildId) => {
  const state = await stateStore.update((s) => s);
  return getGuild(state, guildId).verifications ?? {};
};

const getRecord = async (guildId, userId) => (await readAll(guildId))[userId] ?? null;

/**
 * Stores a verification and returns the accounts that share the address.
 * `entry.risky` records are kept for the audit trail but never link accounts.
 */
const saveVerification = async (guildId, entry) => {
  let sharedWith = [];

  await stateStore.update((state) => {
    const guild = getGuild(state, guildId);
    guild.verifications ??= {};

    const previous = guild.verifications[entry.userId];
    const ips = [...new Set([entry.address, ...(previous?.ips ?? [])].filter(Boolean))];

    if (!entry.risky && entry.address) {
      sharedWith = Object.values(guild.verifications)
        .filter(
          (other) =>
            other.userId !== entry.userId &&
            !other.risky &&
            (other.address === entry.address || (other.ips ?? []).includes(entry.address))
        )
        .map((other) => ({ userId: other.userId, username: other.username }));
    }

    guild.verifications[entry.userId] = {
      ...previous,
      ...entry,
      ips: ips.slice(0, MAX_IPS_PER_USER),
      updatedAt: new Date().toISOString(),
    };
  });

  return { sharedWith };
};

/** Every account ever seen on this address, newest first. */
const historyForAddress = async (guildId, address) => {
  if (!address) return [];
  const all = await readAll(guildId);

  return Object.values(all)
    .filter((record) => record.address === address || (record.ips ?? []).includes(address))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
};

/** Accounts sharing a verified user's residential address. */
const sharedAccounts = async (guildId, userId) => {
  const record = await getRecord(guildId, userId);
  if (!record || record.risky || !record.address) return { record, accounts: [] };

  const all = await readAll(guildId);
  const accounts = Object.values(all)
    .filter(
      (other) =>
        other.userId !== userId &&
        !other.risky &&
        (other.address === record.address || (other.ips ?? []).includes(record.address))
    )
    .map((other) => ({ userId: other.userId, username: other.username }));

  return { record, accounts };
};

module.exports = {
  getRecord,
  saveVerification,
  historyForAddress,
  sharedAccounts,
  readAll,
  MAX_IPS_PER_USER,
};
