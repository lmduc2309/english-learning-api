# DSD Production Backup and Preflight — 2026-08-09

> Historical pre-provisioning snapshot. The subsequent production staging and
> current remaining blockers are recorded in
> `PRODUCTION-AI-PILOT-STAGING-2026-08-09.md`.

## Outcome

- Immediate pre-import legacy dump: **VERIFIED**
- DSD production platform gate A2: **NO-GO**
- DSD data imported: **none**
- Production migration/restart during these checks: **none**

The backup-only workflow ran before any DSD production write. It used the
existing PostgreSQL container to create a custom-format archive, required a
non-empty file, checked the archive with `pg_restore --list`, and wrote a
SHA-256 sidecar. The validate and deploy jobs were skipped.

## Verified same-host dump

| Field | Value |
| --- | --- |
| Database | `english_learning_db` |
| Created (UTC) | `2026-08-09T05:37:02Z` |
| VPS path | `/var/www/sites/dsd-english/backups/manual-pre-import/english_learning_db-20260809T053702Z.dump` |
| Bytes | `123227992` |
| SHA-256 | `b3a9ef918a4ef0b58e52154335d65dcfc83dcea07bf986363e94c1cd7919a895` |
| Workflow run | `31297067293` |

`dsd_corpus_db` did not exist and was therefore correctly skipped. This dump
is an immediate rollback safeguard on the same VPS. It is not an off-host copy
and does not satisfy Task 2A's encrypted/versioned/KMS recovery requirement.

## Read-only production preflight

Workflow run `31297180285` inspected production without modifying it. The API
repository was clean on `main` at
`9d33565df04e44f9a6aee1778d0887d242d6756a`.

The result was `DSD_PRODUCTION_PREFLIGHT=NO-GO` with 23 findings:

- `dsd_corpus_db` was absent.
- All nine scoped DSD/backup/audit roles were absent.
- All eight role-specific database URLs were absent.
- Backup S3 URI, KMS key, and AWS access credentials were absent.
- `COMMERCIAL_SAFE_MODE=true` was not recorded in the production environment.

## Required before the first DSD production write

1. Provision a versioned, Object-Locked off-host backup bucket and KMS key.
2. Install scoped backup credentials and all role-specific database URLs in
   `deploy/.env.production` without logging their values.
3. Set `COMMERCIAL_SAFE_MODE=true` and keep `DSD_RELEASE_CHANNEL=off`.
4. Run provisioning plan, then the reviewed idempotent apply.
5. Back up both databases off-host and successfully restore both into guarded
   scratch databases.
6. Run production permission tests and DSD migration preflight.

No migration or data import may proceed until these items turn gate A2 to GO.
