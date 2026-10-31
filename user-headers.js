// The services behind the gateway trust these headers to know who is calling, so they must
// come from the verified token only: whatever the client sends under these names is dropped.
const IDENTITY_HEADERS = ['x-user-id', 'x-user-roles'];

function extractRoles(payload) {
  return payload.realm_access?.roles || [];
}

function identityHeaders(auth) {
  return { 'x-user-id': auth.sub, 'x-user-roles': extractRoles(auth).join(',') };
}

// For proxied HTTP requests (http-proxy-middleware `onProxyReq`)
function applyUserHeaders(proxyReq, auth) {
  IDENTITY_HEADERS.forEach((name) => proxyReq.removeHeader(name));
  if (auth) {
    Object.entries(identityHeaders(auth)).forEach(([name, value]) => proxyReq.setHeader(name, value));
  }
}

// For WebSocket upgrades, where the incoming request's headers are forwarded as they are
function applyUserHeadersToUpgrade(req, auth) {
  IDENTITY_HEADERS.forEach((name) => delete req.headers[name]);
  if (auth) {
    Object.assign(req.headers, identityHeaders(auth));
  }
}

module.exports = { extractRoles, applyUserHeaders, applyUserHeadersToUpgrade };
