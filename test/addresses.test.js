const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadAddresses, resolveWsTarget, stripApiPrefix } = require('../addresses');

function writeConfig(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addresses-'));
  const file = path.join(dir, 'addresses.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

const valid = {
  platform: { name: 'platform', port: 8080 },
  games: [{ name: 'uno', port: 8080 }],
};

describe('loadAddresses', () => {
  test('reads the platform and the games', () => {
    assert.deepEqual(loadAddresses(writeConfig(valid)), valid);
  });

  test('accepts a file without games', () => {
    const { games } = loadAddresses(writeConfig({ platform: valid.platform }));
    assert.deepEqual(games, []);
  });

  test('says which file is missing', () => {
    assert.throws(() => loadAddresses('/nope/addresses.json'), /cannot read .*\/nope\/addresses\.json/);
  });

  test('refuses invalid JSON', () => {
    assert.throws(() => loadAddresses(writeConfig('{"platform": ')), /not valid JSON/);
  });

  test('refuses a file without platform', () => {
    assert.throws(() => loadAddresses(writeConfig({ games: [] })), /"platform"/);
  });

  test('refuses a port that is not a number', () => {
    const config = { ...valid, platform: { name: 'platform', port: '8080' } };
    assert.throws(() => loadAddresses(writeConfig(config)), /"port" must be a number/);
  });

  test('refuses an out-of-range port', () => {
    const config = { ...valid, games: [{ name: 'uno', port: 70000 }] };
    assert.throws(() => loadAddresses(writeConfig(config)), /"port" must be a number/);
  });

  test('refuses names that are not safe in a route and a host name', () => {
    for (const name of ['a/b', 'a.*', 'Uno', '', 'a b']) {
      const config = { ...valid, games: [{ name, port: 8080 }] };
      assert.throws(() => loadAddresses(writeConfig(config)), /"name" must be/, `name: "${name}"`);
    }
  });

  test('refuses a game declared twice', () => {
    const config = { ...valid, games: [{ name: 'uno', port: 1 }, { name: 'uno', port: 2 }] };
    assert.throws(() => loadAddresses(writeConfig(config)), /already used/);
  });

  test('refuses a game named like the platform', () => {
    const config = { ...valid, games: [{ name: 'platform', port: 1 }] };
    assert.throws(() => loadAddresses(writeConfig(config)), /already used/);
  });

  test('refuses games that is not a list', () => {
    assert.throws(() => loadAddresses(writeConfig({ ...valid, games: {} })), /must be a list/);
  });
});

describe('resolveWsTarget', () => {
  const addresses = {
    platform: { name: 'platform', port: 8080 },
    games: [{ name: 'uno', port: 8081 }, { name: 'endgame', port: 8082 }],
  };

  test('routes a declared game to its own port', () => {
    assert.equal(resolveWsTarget(addresses, 'uno'), 'ws://uno:8081');
  });

  test('routes the platform, and the legacy "game" alias, to the platform', () => {
    assert.equal(resolveWsTarget(addresses, 'platform'), 'ws://platform:8080');
    assert.equal(resolveWsTarget(addresses, 'game'), 'ws://platform:8080');
  });

  test('matches the exact name: a name that only contains another one is not it', () => {
    assert.equal(resolveWsTarget(addresses, 'endgame'), 'ws://endgame:8082');
    assert.equal(resolveWsTarget(addresses, 'unoo'), null);
    assert.equal(resolveWsTarget(addresses, 'ga'), null);
  });

  test('returns null for an undeclared service', () => {
    assert.equal(resolveWsTarget(addresses, 'puissance4'), null);
    assert.equal(resolveWsTarget(addresses, ['uno', 'x']), null);
  });
});

describe('stripApiPrefix', () => {
  test('removes /api/<name> and keeps the rest of the path', () => {
    assert.equal(stripApiPrefix('uno')('/api/uno/rooms/1?a=2'), '/rooms/1?a=2');
  });

  test('ignores the case of the prefix, like the Express route does', () => {
    assert.equal(stripApiPrefix('uno')('/api/UNO/hello'), '/hello');
  });

  test('leaves other paths alone', () => {
    assert.equal(stripApiPrefix('platform')('/admin/users'), '/admin/users');
  });
});
