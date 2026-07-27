# Single-domain production deployment

This stack serves both clients through one public origin:

- `https://eng.dsdtech.site/` -> Next.js web
- `https://eng.dsdtech.site/serious/*` -> NestJS API
- `https://eng.dsdtech.site/tts*` -> NestJS TTS facade
- `https://eng.dsdtech.site/verbal-mapping/*` -> NestJS verbal mapping

The Expo application is installed on users' devices and uses the same origin as
its API base URL. The PostgreSQL, Redis, API, web, and TTS ports are not
published by this Compose stack; only Nginx is published.

## Prepare the server

Keep these sibling directories together:

```text
games-and-tools/
  english-learning-api/
  english-learning-games/
  tts-service/
```

From `english-learning-api`, create the untracked production environment file:

```sh
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Replace every placeholder secret before building. Set the web and mobile
production API values to the same public origin:

```env
NEXT_PUBLIC_API_URL=https://eng.dsdtech.site
EXPO_PUBLIC_API_BASE_URL=https://eng.dsdtech.site
```

`NEXT_PUBLIC_API_URL` is embedded into the browser bundle during the Docker
build. Rebuild `web` after changing it.

`LLM_API_KEY` may remain empty only while `LLM_FALLBACK_ENABLED=false`. In that
mode dictionary fallback generation is disabled, `/serious/llm/health` reports
`disabled`, and the rest of the API remains available. Supply a valid key
before enabling the fallback.

## Validate and start

Take and verify a PostgreSQL backup before running migrations. Then:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml config
docker compose --env-file deploy/.env.production -f deploy/compose.yml build
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d postgres redis
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm api npm run migration:show:prod
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm api npm run migration:run:prod
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d
```

The first migration is an additive legacy baseline. It lets the same chain
initialize a fresh PostgreSQL database and adopt an existing pre-migration
database without dropping legacy data. Always inspect `migration:show:prod`
before applying the chain and never replace migrations with
`TYPEORM_SYNCHRONIZE=true`.

Verify locally on the server before configuring DNS:

```sh
curl -fS -H 'Host: eng.dsdtech.site' http://127.0.0.1/healthz
curl -fS -H 'Host: eng.dsdtech.site' http://127.0.0.1/
curl -fS -H 'Host: eng.dsdtech.site' \
  -H 'content-type: application/json' \
  -d '{"query":"study","direction":"auto"}' \
  http://127.0.0.1/serious/dictionary/resolve
```

Before a public release, run `npm audit --omit=dev` in both
`english-learning-api` and `english-learning-games`. High or critical
production advisories remain a release blocker unless the owner records a
specific risk acceptance.

## Add Cloudflare later

For a Cloudflare Tunnel running on the same host:

1. Change `HTTP_BIND_ADDRESS` to `127.0.0.1`.
2. Point the tunnel service at `http://localhost:80`.
3. Map the public hostname `eng.dsdtech.site` to that service.
4. Keep the application base URLs unchanged.

The `/serious` prefix separates API routes; it is not a security boundary.
HTTPS, JWT checks, private container networking, secret management, backups,
rate limiting, and Cloudflare policy provide the security controls.
