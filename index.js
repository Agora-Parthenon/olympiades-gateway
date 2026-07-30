const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');
const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');
const addresses = require("./addresses.json");
const jsonwebtoken = require('jsonwebtoken');
const cors = require('cors');

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

function extractRoles(payload) {
  return payload.realm_access?.roles || [];
}

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

const platformProxy = createProxyMiddleware({
  target: `http://${addresses.platform.name}:${addresses.platform.port}`,
  changeOrigin: true,
  pathRewrite: (path) => path.replace(`/api/${addresses.platform.name}`, ""),
  onProxyReq: (proxyReq, req) => {
    const payload = req.auth;
    if (payload) {
      proxyReq.setHeader('X-User-Id', payload.sub);
      proxyReq.setHeader('X-User-Roles', extractRoles(payload).join(','));
    }
  },
});

// Proxy rules: route /api/platform -> platform:8080, /api/game -> game:8080
app.use(`/api/${addresses.platform.name}`, platformProxy);
app.use('/admin', requireRole('ROLE_ADMIN'), platformProxy);
for (const game in addresses.games) {
    app.use(`/api/${game.name}`, createProxyMiddleware(
        {
            target: `http://${game.name}:${game.port}`,
            changeOrigin: true,
            pathRewrite: (path) => path.replace(`/api/${game.name}`, "")
        }
    ));
}

//handling errors in api calls
app.use('/api', (req, res) => {
    const parsed = url.parse(req.url, true);
    const service = parsed.query.service || parsed.pathname.split('/')[1] || "";
    const returnMessage = service === "" ?
        {
            "error": `no service asked`,
            "message": "Request must contains service name"
        } :
        {
            "error": `unknown service: ${service}`,
            "message": "You are trying to request a service that may not exist " +
                "or the service name provided in request is invalid"
        };
    res.status(400).send(returnMessage);
})

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
  const service = parsed.query.service || parsed.pathname.split('/')[2] || `${addresses.platform.name}`;
  let target = `ws://${addresses.platform.name}:${addresses.platform.port}`;
  for (const game in addresses.games) {
      if (service === game.name || parsed.pathname.includes(game.name)) target = `ws://${game.name}:${game.port}`;
  }
  if (service === 'game' || parsed.pathname.includes('game'))
      target = `ws://${addresses.platform.name}:${addresses.platform.port}`;
  proxy.ws(req, socket, head, { target });
});

server.listen(PORT, () => console.log(`Gateway listening on ${PORT}`));
