# olympiades-gateway
API Gateway de la plateforme **Olympiades**, une application web de jeux de société en ligne en temps réel.

Gateway implementation
----------------------

This repository contains a minimal Node.js gateway used as a reference implementation for local development. It:

- Verifies JWT tokens against Keycloak JWKS
- Proxies HTTP API requests to backend services (`/api/*`)
- Forwards WebSocket upgrade requests to backend game services

Services addresses
------------------

The gateway does not hard-code where the platform and the games live. It reads a JSON file
(`/app/addresses.json`, mounted by `olympiades-infra` from `gateway/addresses.json`; set
`ADDRESSES_FILE` to read another path):

```json
{
  "platform": { "name": "platform", "port": 8080 },
  "games": [{ "name": "uno", "port": 8080 }]
}
```

- `/api/platform/**` always goes to the platform; every game in `games` is served on `/api/<name>/**`
  and on the WebSocket `/ws?service=<name>`. Adding a game only means editing that file and restarting.
- A service that is not declared gets a `404` with a JSON error (HTTP) or is refused (WebSocket).
- If the file is missing or invalid, the gateway stops at startup with a message saying why.

To run locally (from `olympiades-infra`):

```sh
make up
```

To build the gateway image alone:

```sh
docker build -t olympiades/gateway:local .
```

