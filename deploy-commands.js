/**
 * Optional manual command registration.
 *
 * The bot registers its commands automatically on startup, so you only need
 * this when you want to push them without restarting:
 *
 *   npm run deploy
 */
const { REST, Routes } = require('discord.js');
const config = require('./src/config');
const command = require('./src/commands/verify');

const main = async () => {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing.');
  if (!config.clientId) throw new Error('CLIENT_ID is missing.');

  const rest = new REST().setToken(config.token);
  const body = [command.data.toJSON()];

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const result = await rest.put(route, { body });
  console.log(`Registered ${result.length} slash command(s).`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
