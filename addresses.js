const fs = require('fs');

const PLATFORM_SERVICE = 'platform';

// Lowercase only: Express matches routes case-insensitively, so two names that only
// differ by case would be ambiguous. The name is also used as the host name of the service.
const SERVICE_NAME = /^[a-z0-9_-]+$/;

function checkService(service, where) {
  if (!service || !SERVICE_NAME.test(service.name)) {
    throw new Error(`${where}: "name" must be a non-empty string (lowercase letters, digits, - or _)`);
  }
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) {
    throw new Error(`${where}: "port" must be a number between 1 and 65535`);
  }
}

function loadAddresses(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the services addresses file ${file} (${err.code})`);
  }

  let addresses;
  try {
    addresses = JSON.parse(content);
  } catch (err) {
    throw new Error(`the services addresses file ${file} is not valid JSON (${err.message})`);
  }

  checkService(addresses?.platform, '"platform"');
  const games = addresses.games ?? [];
  if (!Array.isArray(games)) {
    throw new Error('"games" must be a list');
  }

  const names = new Set();
  games.forEach((game, i) => {
    checkService(game, `"games[${i}]"`);
    if (game.name === PLATFORM_SERVICE || names.has(game.name)) {
      throw new Error(`"games[${i}]": the name "${game.name}" is already used`);
    }
    names.add(game.name);
  });

  return { platform: addresses.platform, games };
}

// WebSocket target for a service name, or null if the service is not declared.
// 'game' is a legacy alias that always meant the platform backend.
function resolveWsTarget(addresses, service) {
  if (service === PLATFORM_SERVICE || service === 'game') {
    return `ws://${addresses.platform.name}:${addresses.platform.port}`;
  }
  const game = addresses.games.find((g) => g.name === service);
  return game ? `ws://${game.name}:${game.port}` : null;
}

// Removes the /api/<name> prefix before forwarding. Case-insensitive, like the Express
// route that lets the request through.
function stripApiPrefix(name) {
  const prefix = new RegExp(`^/api/${name}`, 'i');
  return (requestPath) => requestPath.replace(prefix, '');
}

module.exports = { PLATFORM_SERVICE, loadAddresses, resolveWsTarget, stripApiPrefix };
