const { Events, MessageFlags } = require('discord.js');
const logger = require('../logger').create('interactions');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Command failed: ${interaction.commandName}`, err);

      const reply = {
        content: 'Something went wrong running that. The error is in the console.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.deferred) {
        await interaction.editReply(reply).catch(() => {});
      } else if (interaction.replied) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};
