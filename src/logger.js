const config = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (level, scope, args) => {
  if (LEVELS[level] > threshold) return;
  const prefix = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}]`;
  const sink = level === 'error' ? console.error : console.log;
  sink(prefix, ...args);
};

const create = (scope) => ({
  error: (...args) => write('error', scope, args),
  warn: (...args) => write('warn', scope, args),
  info: (...args) => write('info', scope, args),
  debug: (...args) => write('debug', scope, args),
});

module.exports = { create, ...create('verifybot') };
