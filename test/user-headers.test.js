const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { applyUserHeaders, applyUserHeadersToUpgrade } = require('../user-headers');

// Minimal stand-in for the request http-proxy sends to a service
function fakeProxyReq(headers = {}) {
  const store = { ...headers };
  return {
    store,
    removeHeader: (name) => {
      for (const key of Object.keys(store)) if (key.toLowerCase() === name) delete store[key];
    },
    setHeader: (name, value) => {
      store[name.toLowerCase()] = value;
    },
  };
}

const auth = { sub: 'user-1', realm_access: { roles: ['ROLE_USER', 'ROLE_ADMIN'] } };

describe('applyUserHeaders', () => {
  test('sets the identity from the token', () => {
    const req = fakeProxyReq();
    applyUserHeaders(req, auth);
    assert.equal(req.store['x-user-id'], 'user-1');
    assert.equal(req.store['x-user-roles'], 'ROLE_USER,ROLE_ADMIN');
  });

  test('replaces an identity forged by the client', () => {
    const req = fakeProxyReq({ 'X-User-Id': 'admin-forge', 'x-user-roles': 'ROLE_ADMIN' });
    applyUserHeaders(req, { sub: 'user-2', realm_access: { roles: ['ROLE_USER'] } });
    assert.equal(req.store['x-user-id'], 'user-2');
    assert.equal(req.store['x-user-roles'], 'ROLE_USER');
    assert.equal(req.store['X-User-Id'], undefined);
  });

  test('drops forged headers when there is no token at all', () => {
    const req = fakeProxyReq({ 'x-user-id': 'admin-forge', 'x-user-roles': 'ROLE_ADMIN' });
    applyUserHeaders(req, undefined);
    assert.deepEqual(req.store, {});
  });

  test('sends no role when the token has none', () => {
    const req = fakeProxyReq();
    applyUserHeaders(req, { sub: 'user-3' });
    assert.equal(req.store['x-user-roles'], '');
  });
});

describe('applyUserHeadersToUpgrade', () => {
  test('replaces forged headers on a WebSocket upgrade, and keeps the others', () => {
    const req = { headers: { 'x-user-id': 'admin-forge', 'x-user-roles': 'ROLE_ADMIN', origin: 'http://localhost:3000' } };
    applyUserHeadersToUpgrade(req, auth);
    assert.equal(req.headers['x-user-id'], 'user-1');
    assert.equal(req.headers['x-user-roles'], 'ROLE_USER,ROLE_ADMIN');
    assert.equal(req.headers.origin, 'http://localhost:3000');
  });
});

describe('username header', () => {
  test('sends the username from the token', () => {
    const req = fakeProxyReq();
    applyUserHeaders(req, { ...auth, preferred_username: 'lucy' });
    assert.equal(req.store['x-user-name'], 'lucy');
  });

  test('URI-encodes it so any character is a valid header value', () => {
    const req = fakeProxyReq();
    applyUserHeaders(req, { ...auth, preferred_username: 'Zoë Łukasz@mail' });
    assert.equal(req.store['x-user-name'], 'Zo%C3%AB%20%C5%81ukasz%40mail');
    assert.equal(decodeURIComponent(req.store['x-user-name']), 'Zoë Łukasz@mail');
  });

  test('replaces a username forged by the client, even when the token has none', () => {
    const req = fakeProxyReq({ 'X-User-Name': 'admin' });
    applyUserHeaders(req, auth);
    assert.equal(req.store['x-user-name'], undefined);
    assert.equal(req.store['X-User-Name'], undefined);
  });

  test('is also set on a WebSocket upgrade', () => {
    const req = { headers: { 'x-user-name': 'forged' } };
    applyUserHeadersToUpgrade(req, { ...auth, preferred_username: 'lucy' });
    assert.equal(req.headers['x-user-name'], 'lucy');
  });
});
