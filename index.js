const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');
const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');
const path = require('path');
const jsonwebtoken = require('jsonwebtoken');
const cors = require('cors');
const { PLATFORM_SERVICE, loadAddresses, resolveWsTarget, stripApiPrefix } = require('./addresses');
const { extractRoles, applyUserHeaders, applyUserHeadersToUpgrade } = require('./user-headers');

// Services addresses come from a file provided by olympiades-infra (mounted in the
// container), never hard-coded here: adding a game must not require a code change.
const ADDRESSES_FILE = process.env.ADDRESSES_FILE || path.join(__dirname, 'addresses.json');
let addresses;
try {
  addresses = loadAddresses(ADDRESSES_FILE);
} catch (err) {
  console.error(`Gateway cannot start: ${err.message}`);
  process.exit(1);
}

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim());
const PORT = process.env.PORT || 8080;
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8180/realms/olympiades';

const KEYCLOAK_JWKS_URI =
  process.env.KEYCLOAK_JWKS_URI ||
  'http://keycloak:8080/realms/olympiades/protocol/openid-connect/certs';

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({ ws: true });

function requireRole(role) {
  return (req, res, next) => {
    const roles = extractRoles(req.auth || {});
    if (!roles.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

// JWT middleware using JWKS from Keycloak
app.use(
  jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksUri: KEYCLOAK_JWKS_URI
    }),
    algorithms: ['RS256'],
    issuer: KEYCLOAK_ISSUER,
    credentialsRequired: true
  }).unless({ path: [/^\/public/, /^\/health/] }),
  cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// --- Vérification JWT pour les upgrades WebSocket ---
const jwksClient = jwksRsa({
  cache: true,
  rateLimit: true,
  jwksUri: KEYCLOAK_JWKS_URI
});

function getSigningKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyWsToken(token) {
  return new Promise((resolve, reject) => {
    jsonwebtoken.verify(
      token,
      getSigningKey,
      { algorithms: ['RS256'], issuer: KEYCLOAK_ISSUER },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

function rejectUpgrade(socket, code, message) {
  socket.write(`HTTP/1.1 ${code} ${message}\r\n\r\n`);
  socket.destroy();
}

// Simple health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Every proxied service, platform or game, gets the caller's identity from the verified
// token and never from what the client sent (see user-headers.js).
function serviceProxy(name, port) {
  return createProxyMiddleware({
    target: `http://${name}:${port}`,
    changeOrigin: true,
    pathRewrite: stripApiPrefix(name),
    onProxyReq: (proxyReq, req) => applyUserHeaders(proxyReq, req.auth),
  });
}

const platformProxy = serviceProxy(addresses.platform.name, addresses.platform.port);

// Proxy rules: /api/platform is fixed (only its target is configurable),
// /api/<game> -> <game>:<port> for every game declared in the addresses file.
app.use('/api/platform', platformProxy);
app.use('/admin', requireRole('ROLE_ADMIN'), platformProxy);
for (const game of addresses.games) {
  app.use(`/api/${game.name}`, serviceProxy(game.name, game.port));
}

// Anything else under /api targets a service that is not declared
app.use('/api', (req, res) => {
  const parsed = url.parse(req.url, true);
  const service = parsed.query.service || parsed.pathname.split('/')[1] || '';
  res.status(404).json(
    service === ''
      ? { error: 'no service asked', message: 'Request must contain a service name' }
      : {
          error: 'unknown service',
          service,
          message: 'This service does not exist or is not declared in the gateway configuration',
        }
  );
});

// Upgrade (WebSocket) handling: route by query param 'service' or path
server.on('upgrade', async (req, socket, head) => {
  const parsed = url.parse(req.url, true);
  const token = parsed.query.token;

  if (!token) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  let payload;
  try {
    payload = await verifyWsToken(token);
  } catch (err) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return;
  }

  req.auth = payload;
  const service = parsed.query.service || parsed.pathname.split('/')[2] || PLATFORM_SERVICE;
  const target = resolveWsTarget(addresses, service);
  if (!target) {
    rejectUpgrade(socket, 404, 'Not Found');
    return;
  }
  applyUserHeadersToUpgrade(req, payload);
  proxy.ws(req, socket, head, { target });
});

// A game server that is down must not take the whole gateway down with it
proxy.on('error', (err, req, socket) => {
  console.error(`WebSocket proxy error: ${err.message}`);
  if (socket && typeof socket.destroy === 'function') socket.destroy();
});

server.listen(PORT, () => console.log(`Gateway listening on ${PORT}`));
