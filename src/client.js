const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('./logger').create('client');

const verifyCommand = require('./commands/verify');
const ready = require('./events/ready');
const interactionCreate = require('./events/interactionCreate');
const guildMemberAdd = require('./events/guildMemberAdd');

const createClient = () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Needed for join events and for resolving members by ID.
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });

  client.commands = new Map([[verifyCommand.data.name, verifyCommand]]);

  const bind = (event) => {
    const register = event.once ? client.once.bind(client) : client.on.bind(client);

    register(event.name, (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((err) => {
        logger.error(`Unhandled error in event "${event.name}"`, err);
      });
    });
  };

  bind(ready);
  bind(interactionCreate);
  bind(guildMemberAdd);

  logger.info(`Loaded ${client.commands.size} command(s)`);
  return client;
};

module.exports = { createClient };
