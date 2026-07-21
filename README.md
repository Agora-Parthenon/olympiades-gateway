# olympiades-gateway
API Gateway de la plateforme **Olympiades**, une application web de jeux de société en ligne en temps réel.

Gateway implementation
----------------------

This repository contains a minimal Node.js gateway used as a reference implementation for local development. It:

- Verifies JWT tokens against Keycloak JWKS
- Proxies HTTP API requests to backend services (`/api/*`)
- Forwards WebSocket upgrade requests to backend game services

To run locally (from `olympiades-infra`):

```sh
make up
```

To build the gateway image alone:

```sh
docker build -t olympiades/gateway:local .
```

