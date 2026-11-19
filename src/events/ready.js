const { ActivityType, Events } = require('discord.js');
const config = require('../config');
const logger = require('../logger').create('ready');
const { registerCommands } = require('../register');
const { startVerificationServer } = require('../verify/server');
const { redirectUri } = require('../verify/oauth');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Logged in as ${client.user.tag} (${client.user.id})`);
    logger.info(`Serving ${client.guilds.cache.size} guild(s)`);

    client.user.setPresence({
      status: 'online',
      activities: [{ name: '/verify panel', type: ActivityType.Watching }],
    });

    if (process.env.REGISTER_COMMANDS_ON_START !== 'false') {
      try {
        await registerCommands(client);
      } catch (err) {
        logger.warn(`Slash command registration failed: ${err.message || err}`);
      }
    }

    if (!config.verify.publicUrl) {
      logger.warn('PUBLIC_URL is empty — verification links will not work until it is set');
    } else {
      logger.info(`OAuth redirect URI: ${redirectUri(config)}`);
    }

    client.verifyServer = startVerificationServer(client);
  },
};
