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

The existing portfolio deployment uses `/var/www/sites` on the VPS. Provision
these sibling repositories under a dedicated directory:

```text
/var/www/sites/dsd-english/
  english-learning-api/
  english-learning-games/
  tts-service/
  backups/
```

`english-learning-games` and `tts-service` are private repositories. Confirm
that the VPS Git credential can read both of them; access to the private
portfolio repository does not prove that a repository-scoped deploy key can
read other repositories.

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

`COMMERCIAL_SAFE_MODE=true` is mandatory for a commercial deployment. It makes
dictionary and category endpoints fail closed to published learner-overlay
content and disables legacy, external-audio and generated fallbacks. Do not set
`COMMERCIAL_ALLOW_GENERATED_CONTENT=true` until provider terms and the product
policy have been recorded and approved.

## Validate and start

Take and verify a PostgreSQL backup before running migrations. Then:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml config
docker compose --env-file deploy/.env.production -f deploy/compose.yml build
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d postgres redis
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm api npm run migration:show:prod
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm api npm run migration:run:prod
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm api npm run commercial:audit:prod
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

The commercial audit is a hard release gate. A `NO-GO` result—including zero
published learner entries—must stop deployment. Commercial exports must use
`npm run commercial:export`; `export-word-data` deliberately includes the
reference corpus and is never a commercial distribution artifact.

For a local preflight, use:

```sh
COMMERCIAL_SAFE_MODE=true COMMERCIAL_ALLOW_GENERATED_CONTENT=false npm run commercial:audit
```

## Add Cloudflare later

For a Cloudflare Tunnel running on the same host:

1. Change `HTTP_BIND_ADDRESS` to `127.0.0.1`.
2. Point the tunnel service at `http://localhost:80`.
3. Map the public hostname `eng.dsdtech.site` to that service.
4. Keep the application base URLs unchanged.

The `/serious` prefix separates API routes; it is not a security boundary.
HTTPS, JWT checks, private container networking, secret management, backups,
rate limiting, and Cloudflare policy provide the security controls.

## GitHub Actions deployment

`.github/workflows/deploy.yml` provides a manual-only production deployment. It
uses the same secret names as `duskstilldev-portfolio`:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_KEY`

GitHub Actions secrets are repository- or organization-scoped and their values
cannot be read back after creation. The portfolio repository currently has
these names, but `english-learning-api` must receive them separately or inherit
organization-level secrets. Prefer a protected `production` environment with
required approval.

The manual workflow has four explicit operations:

- `backup-only` creates custom-format dumps for each existing production
  database, verifies that `pg_restore` can read the archive, and records a
  SHA-256 file beside it. It does not pull, build, migrate, restart, or import.
- `preflight-only` reads configuration/database/role readiness without changing
  production. Secret values are never printed; only `configured` or `missing`.
- `stage-ai-pilot` requires the pinned verified legacy dump, validates the
  selected Git commit, provisions the isolated DSD database and scoped roles,
  imports the committed 50-entry AI pilot as drafts, audits it, and creates a
  verified post-import DSD dump. It forces `DSD_RELEASE_CHANNEL=off`; it neither
  approves/publishes content nor rebuilds/restarts the long-running services.
- `deploy` runs the full validated deployment sequence below.

Run `backup-only` before the first DSD provisioning attempt and preserve its
reported path, UTC timestamp, size and SHA-256 in the production evidence log.
A same-host manual dump protects the immediate change window, but does not
satisfy Task 2A's off-host recovery gate by itself.

The workflow deliberately does not clone repositories or create
`deploy/.env.production`. Those are one-time server provisioning actions. On
each manual run it:

1. requires clean, already-provisioned sibling repositories;
2. fast-forwards all three `main` branches;
3. creates, uploads and verifies snapshot-bound backups for both databases;
4. builds the stack and runs compiled migrations;
5. starts the services and runs local origin smoke checks.
