/**
 * Small JSON-file store with atomic writes and a serialised write queue.
 *
 * The file is deliberately simple so it can be read, copied and inspected
 * without a database. Every guild gets one bucket:
 *
 *   {
 *     "guilds": {
 *       "123": {
 *         "verifications": { "<userId>": { ... } },
 *         "panelMessageId": "...",
 *         "panelChannelId": "...",
 *         "verify": { "blockVpn": null }
 *       }
 *     }
 *   }
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const logger = require('./logger').create('store');

const DEFAULT_STATE = {
  version: 1,
  guilds: {},
};

class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  read() {
    try {
      if (!fs.existsSync(this.file)) return structuredClone(this.fallback);
      const raw = fs.readFileSync(this.file, 'utf8');
      if (!raw.trim()) return structuredClone(this.fallback);
      return { ...structuredClone(this.fallback), ...JSON.parse(raw) };
    } catch (err) {
      logger.error(`Unreadable state file ${this.file}; using defaults.`, err.message);
      return structuredClone(this.fallback);
    }
  }

  /** Serialised read-modify-write. The mutator may be async. */
  async update(mutator) {
    const run = async () => {
      const state = this.read();
      const result = await mutator(state);
      const next = result && typeof result === 'object' && !Array.isArray(result) ? result : state;
      this.writeAtomic(next);
      return next;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  writeAtomic(state) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }
}

const stateStore = new JsonStore(path.join(config.dataDir, 'state.json'), DEFAULT_STATE);

const guildDefaults = () => ({
  verifications: {},
  panelMessageId: null,
  panelChannelId: null,
  verify: {
    blockVpn: null, // null -> use BLOCK_VPN from the environment
  },
});

const getGuild = (state, guildId) => {
  state.guilds ??= {};
  state.guilds[guildId] ??= guildDefaults();

  const base = guildDefaults();
  for (const [key, value] of Object.entries(base)) {
    if (state.guilds[guildId][key] === undefined) state.guilds[guildId][key] = value;
  }
  state.guilds[guildId].verify ??= { blockVpn: null };
  if (state.guilds[guildId].verify.blockVpn === undefined) {
    state.guilds[guildId].verify.blockVpn = null;
  }
  return state.guilds[guildId];
};

module.exports = { stateStore, getGuild, DEFAULT_STATE, guildDefaults };
