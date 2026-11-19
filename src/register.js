const { REST, Routes } = require('discord.js');
const config = require('./config');
const logger = require('./logger').create('register');

/**
 * Pushes slash commands.
 * GUILD_ID set -> guild-scoped, instant.
 * GUILD_ID empty -> global; Discord can take up to an hour to show them.
 */
const registerCommands = async (client) => {
  if (!config.clientId) throw new Error('CLIENT_ID is missing — needed to register slash commands.');
  if (!config.token) throw new Error('DISCORD_TOKEN is missing.');

  const body = [...client.commands.values()].map((command) => command.data.toJSON());
  const rest = new REST().setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const result = await rest.put(route, { body });
  logger.info(
    `Registered ${result.length} slash command(s) ${config.guildId ? `in guild ${config.guildId}` : 'globally'}`
  );
  return result;
};

module.exports = { registerCommands };
