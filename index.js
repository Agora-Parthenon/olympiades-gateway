const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');
const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

const PORT = process.env.PORT || 8080;
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/olympiades';

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({ ws: true });

// JWT middleware using JWKS from Keycloak
app.use(
  jwt({
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksUri: `${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`
    }),
    algorithms: ['RS256'],
    issuer: KEYCLOAK_ISSUER,
    credentialsRequired: false // allow anonymous for public routes
  }).unless({ path: [/^\/public/, /^\/health/] })
);

// Simple health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Proxy rules: route /api/platform -> platform:8080, /api/uno -> uno:8080
app.use('/api/platform', createProxyMiddleware({ target: 'http://platform:8080', changeOrigin: true, pathRewrite: {'^/api/platform': ''} }));
app.use('/api/uno', createProxyMiddleware({ target: 'http://uno:8080', changeOrigin: true, pathRewrite: {'^/api/uno': ''} }));

// Fallback proxy for other /api/* to platform
app.use('/api', createProxyMiddleware({ target: 'http://platform:8080', changeOrigin: true, pathRewrite: {'^/api': ''} }));

// Upgrade (WebSocket) handling: route by query param 'service' or path
server.on('upgrade', (req, socket, head) => {
  const parsed = url.parse(req.url, true);
  const service = parsed.query.service || parsed.pathname.split('/')[2] || 'platform';
  let target = 'ws://platform:8080';
  if (service === 'uno' || parsed.pathname.includes('uno')) target = 'ws://uno:8080';
  if (service === 'game' || parsed.pathname.includes('game')) target = 'ws://platform:8080';
  proxy.ws(req, socket, head, { target });
});

server.listen(PORT, () => console.log(`Gateway listening on ${PORT}`));
