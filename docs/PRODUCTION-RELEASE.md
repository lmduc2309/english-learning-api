# Production release gate

This repository currently has no checked-in CI/CD workflow, server inventory,
SSH target, or production secret-management contract. Do not infer that the
legacy API at `113.160.225.76:8558` is the deploy target merely because older
clients referenced it.

The checked-in production Compose and Nginx configuration under `deploy/`
targets `https://eng.dsdtech.site`. It keeps web, API, PostgreSQL, Redis, and
TTS internal and publishes only the reverse proxy. Follow `deploy/README.md`;
the files prepare a release but do not replace host access, secrets, a verified
database backup, DNS, TLS, or a Cloudflare configuration.

## Required information

- Confirm the production host or platform and the owner-approved deployment account.
- Confirm where PostgreSQL and Redis run and how their credentials are supplied.
- Confirm whether the service is Docker Compose, a container platform, PM2, or systemd.
- Confirm the public origin is `https://eng.dsdtech.site` and whether TLS
  terminates at Cloudflare Tunnel or another owner-approved reverse proxy.
- Commit or otherwise package an intentional release; do not deploy a dirty working tree containing unrelated local changes.

## Pre-deploy gate

```sh
npm ci
npm test -- --runInBand --no-watchman
npm run test:scripts -- --runInBand --no-watchman
npm run build
npm audit --omit=dev
npm run curation:validate -- --file data/learner-core/pilot-ngsl-10-draft-2026-07-20.json
npm run curation:validate -- --file data/learner-core/study-draft-2026-07-21.json
npm run curation:validate -- --file data/learner-core/grammar-functions-draft-2026-07-21.json
```

Treat unresolved high-severity production advisories as a release blocker unless the owner records a scoped risk acceptance. Do not use `npm audit fix --force` during a release because it can silently introduce major framework upgrades.

The production-only audit on 2026-07-27 reported:

- API: 22 affected packages (1 low, 11 moderate, 10 high).
- Web: 18 affected packages (3 low, 4 moderate, 10 high, 1 critical).

These counts can change as advisories and lockfiles change, so rerun both
audits. The stack is deployable for local validation but is not approved for a
public release while these high and critical findings remain unresolved or
unaccepted.

Take and verify a production PostgreSQL backup before schema changes. Then run migrations using the production environment and verify that only expected migrations are pending:

```sh
npm run migration:show
npm run migration:run
npm run migration:show
```

For the production container image, use the compiled runner instead of `ts-node`:

```sh
docker compose run --rm api npm run migration:show:prod
docker compose run --rm api npm run migration:run:prod
docker compose run --rm api npm run migration:show:prod
docker compose up -d api
```

The compiled files are `dist/main.js` and `dist/migrations/runner.js`. The
additive `CreateLegacyBaseline1721399000000` migration owns the schema that
predates versioned migrations. It has been rehearsed on an empty PostgreSQL
database together with every later migration. Its rollback is intentionally a
no-op because an adopted legacy schema must not be destroyed.

For the sibling-project production stack, use the fully qualified commands in
`deploy/README.md`, including `--env-file deploy/.env.production` and
`-f deploy/compose.yml`.

`LLM_API_KEY` is optional only when `LLM_FALLBACK_ENABLED=false`. That
configuration starts the API with LLM fallback disabled instead of failing
boot; the LLM health response reports `disabled`.

Do not run `curation:import --write` for any current batch. Every current review decision and reviewer field is intentionally blank.

## Smoke checks

After restarting the exact deployed build, verify:

```sh
curl -fS https://eng.dsdtech.site/serious/dictionary/health
curl -fS -X POST https://eng.dsdtech.site/serious/dictionary/resolve \
  -H 'content-type: application/json' \
  -d '{"query":"study","direction":"auto"}'
curl -fS -X POST https://eng.dsdtech.site/serious/dictionary/resolve \
  -H 'content-type: application/json' \
  -d '{"query":"học","direction":"vi-en"}'
```

Until reviewed learner senses are published, the second lookup may correctly use the translation fallback and return an empty `matches` list.

## Rollback

Application rollback should redeploy the previous immutable build. Database rollback must be planned separately: restore the verified backup if later writes depend on the new schema. Do not casually run `migration:revert` after production traffic has written data.
