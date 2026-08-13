const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');
const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');
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
  target: 'http://platform:8080',
  changeOrigin: true,
  pathRewrite: {'^/api/platform': ''},
  onProxyReq: (proxyReq, req) => {
    const payload = req.auth;
    if (payload) {
      proxyReq.setHeader('X-User-Id', payload.sub);
      proxyReq.setHeader('X-User-Roles', extractRoles(payload).join(','));
    }
  },
});

// Proxy rules: route /api/platform -> platform:8080, /api/uno -> uno:8080
app.use('/api/platform', platformProxy);
app.use('/admin', requireRole('ROLE_ADMIN'), platformProxy);
app.use('/api/uno', createProxyMiddleware({ target: 'http://uno:8080', changeOrigin: true, pathRewrite: {'^/api/uno': ''} }));

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
  const service = parsed.query.service || parsed.pathname.split('/')[2] || 'platform';
  let target = 'ws://platform:8080';
  if (service === 'uno' || parsed.pathname.includes('uno')) target = 'ws://uno:8080';
  if (service === 'game' || parsed.pathname.includes('game')) target = 'ws://platform:8080';
  proxy.ws(req, socket, head, { target });
});

server.listen(PORT, () => console.log(`Gateway listening on ${PORT}`));
