const config = require('./src/config');
const logger = require('./src/logger').create('boot');
const { createClient } = require('./src/client');

const main = async () => {
  config.assertRuntime();

  const client = createClient();

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down`);
    client.verifyServer?.close?.();
    await client.destroy().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(config.token);
};

main().catch((err) => {
  logger.error('Fatal startup error:', err.message);
  if (err.message?.includes('invalid token') || err.code === 'TokenInvalid') {
    logger.error('Check DISCORD_TOKEN in your .env file.');
  }
  process.exit(1);
});
