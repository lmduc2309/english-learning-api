# DSD Operations Runbook

Provisioning, backup, restore, and recovery for `dsd_corpus_db` and the legacy
`english_learning_db`.

Written to be followed under pressure. Where a step is destructive it says so,
and where a decision needs a human it stops and asks for one.

---

## 1. The two databases are not equivalent

They fail differently, and treating them the same is the most likely way to
lose something irreplaceable.

| | `dsd_corpus_db` | `english_learning_db` |
| --- | --- | --- |
| Holds | Authored corpus content | Legacy reference corpus **and live user data** |
| Written by | Curators, in reviewed batches | Users, continuously |
| Restore loses | Authored work since the backup | **User word lists, history, sessions since the backup** |
| Second copy exists? | Yes — curation batch JSON under `data/dsd/curation/` | No |
| Replaceable? | Expensive but reconstructible from batches | User data is not reconstructible |

**Consequence:** restoring the legacy database silently discards user writes and
there is no second copy. Roll forward wherever possible; restore it only when
the alternative is worse, and say out loud what will be lost before you do.

DSD content is expensive — roughly 1.4 person-years to v1 — but the reviewed
batch packages are a second copy. A DSD restore costs re-import time, not
re-authoring.

---

## 2. Provisioning

```bash
# Inspect first. Never apply blind.
npm run dsd:provision:plan
npm run dsd:provision:apply
npm run dsd:provision:status
```

Idempotent: a normal re-run changes nothing and exits 0. It will not drop,
recreate, rename, reassign, or re-credential an existing database.

It refuses, before touching anything, when:

- `DSD_DB_DATABASE` equals `DB_DATABASE`, compared normalized so casing or
  padding cannot slip past.
- Either name is not a plain lowercase identifier.
- A role must be created but no password was supplied.

Local development uses `npm run dsd:db:create` instead, which builds a
workbench with throwaway credentials.

### Roles

| Role | Purpose |
| --- | --- |
| `dsd_owner` | NOLOGIN. Owns the database and schema. |
| `dsd_migrator` | DDL, via membership in `dsd_owner`. |
| `dsd_curator` | Content workflow DML, provenance INSERT. No DDL, no grants. |
| `dsd_app` | SELECT on published serving views only. |
| `dsd_auditor` | DSD read, similarity decisions, provenance INSERT. |
| `dsd_backup` | Read-only, for `pg_dump`. |
| `dsd_similarity_reader` | One legacy view. Nothing else. |

**No routine process authenticates as `dsd_owner`.** If a service needs owner
rights, that is a design error, not a grant to widen.

`dsd_similarity_reader` is the licensing boundary. It can read
`dsd_compliance.english_similarity_input` — `record_kind`, `headword`,
`part_of_speech`, `content_en`, `content_digest` — and is denied the legacy base
tables, both Vietnamese columns, every `learner_*` table, every `cleanup_*`
backup, all writes, and all DDL. `scripts/dsd/permissions.spec.ts` proves this
against a real database; run it after any grant change:

```bash
npm run dsd:permissions:test
```

Widening that view widens the licensing boundary and requires compliance review.

---

## 3. Secret rotation

PostgreSQL holds one password per role, so rotation has an unavoidable window
where old connections break. Plan it; do not discover it.

```bash
# Requires the new password in DSD_PASSWORD_<ROLE>. Explicit by design —
# provisioning never rotates silently.
npm run dsd:provision:apply -- --rotate-credentials
```

Order of operations:

1. Generate the new secret and store it, **without** activating it.
2. Announce a short connection-error window for the affected role.
3. Rotate in PostgreSQL.
4. Update the running configuration and restart the affected services.
5. Confirm health, then retire the old secret from the store.

For `dsd_app`, where a window is least acceptable, prefer creating
`dsd_app_next`, cutting over, and dropping the old role — rather than rotating
in place.

Rotate on: contributor offboarding, suspected exposure, and at least annually.
Secrets live in the production secret store and never in Git, command output,
backup manifests, or release artifacts.

---

## 4. Backups

```bash
npm run dsd:backup -- --database dsd_corpus_db     --out-dir "$DSD_BACKUP_DIR"
npm run dsd:backup -- --database english_learning_db --out-dir "$DSD_BACKUP_DIR"
```

Each run produces a custom-format dump and a manifest **captured from the same
exported snapshot**. That is the property that makes verification meaningful: a
manifest built by querying after the dump would describe a database that had
already moved on.

The manifest records the database, creation time, snapshot ID, PostgreSQL
version, dump SHA-256 and size, migration state, and per-table row counts plus
whole-row content digests.

Set `DSD_PG_CONTAINER` when `pg_dump` is not on the host — the deploy runs it
inside the Postgres container, and developer machines generally have no client
install.

Local files are written `0600` in a `0700` directory. **A local dump is not
disaster recovery**; off-host copies are, and they are still outstanding.

### Retention

`DSD_BACKUP_RETENTION_DAYS` governs how long copies are kept. Keep at minimum:
the last 7 daily backups, the last 4 weekly, and every pre-release backup
indefinitely — a release backup is the only way back to a shipped state.

Never delete a backup that has not been superseded by a **verified** one.

---

## 5. Restore verification

```bash
# Both databases: fresh backup, restore, compare.
npm run dsd:verify-restores
```

Restores into a uniquely named scratch database, recomputes the manifest, and
compares against the stored one. Verified at real scale: 4,935,244 rows across
40 tables in 33.4s.

A **fresh** backup is taken first, deliberately. Verifying an old dump proves
only that an old file still restores, not that today's backup is good.

### Scratch safety

The scratch name passes three guards before any DDL runs:

1. Never equal to a production database name, compared normalized.
2. A plain lowercase identifier — nothing that could carry SQL.
3. Must start with `dsd_restore_check_`.

On failure the scratch database is **retained** as evidence and the command
exits non-zero. On success it is dropped. If a run is interrupted, list and
clean up manually:

```sql
SELECT datname FROM pg_database WHERE datname LIKE 'dsd_restore_check_%';
```

`DSD_RESTORE_MAX_AGE_HOURS` bounds how stale a proof may be at release. A
release with no current proof does not ship.

---

## 6. Split migration recovery

PostgreSQL cannot make migrations across two databases atomic. The deploy runs
them in sequence — legacy first, then DSD — and stops before deploying the
application if either fails.

**Every migration in the sequence must be backward compatible with the
currently deployed application.** That single rule is what makes a split state
survivable rather than an outage: the running app keeps working against a
half-migrated pair.

Determine the state before acting:

```bash
npm run migration:show:prod        # legacy
npm run dsd:migration:show:prod    # DSD
```

| State | Legacy | DSD | App | Action |
| --- | --- | --- | --- | --- |
| **S0** | pending | pending | old | Nothing was applied. Fix the fault, re-run the deploy. No recovery needed. |
| **S1** | applied | pending | old | **Most common.** The app is backward compatible, so this is stable. Fix the DSD migration and roll forward. Do **not** revert legacy. |
| **S2** | pending | applied | old | Should be impossible — legacy runs first. Investigate the ordering violation before anything else; something ran out of band. |
| **S3** | applied | applied | old | Migrations succeeded, app deploy failed. Stable. Re-run the app deploy. |
| **S4** | applied | applied | new | Complete. Verify health. |
| **S5** | partial | — | old | An individual migration is atomic (`migrationsTransactionMode: 'each'`), so the sequence stopped cleanly between migrations. Treat as S1: roll forward from the recorded position. |

**Default is roll forward.** Reverting is not offered in production: there is no
`dsd:migration:revert:prod`, and `dsd:migration:revert` refuses when
`NODE_ENV=production`. Recovery is a reviewed forward migration or a restore.

### When restore is the only option

Requires operator confirmation and a named decision-maker. Before starting,
state explicitly:

- Which database.
- The backup timestamp being restored.
- **What will be lost**: for legacy, every user write since that timestamp —
  word lists, lookup history, sessions. For DSD, authored content since that
  timestamp, recoverable by re-importing curation batches.

Then:

1. Stop writes to the affected database.
2. Verify the chosen backup restores cleanly into a scratch database *first*.
3. Rename the damaged database aside rather than dropping it. It is evidence,
   and it may hold the only copy of the data you are about to write off.
4. Restore into a fresh database and rename into place.
5. Re-run migration status on both databases.
6. Re-run `npm run dsd:permissions:test` — a restore does not carry grants.
7. Record the incident, the data-loss window, and who authorised it.

Step 6 is easy to forget and quietly reopens the licensing boundary.

---

## 7. Quarterly recovery exercise

Run against production backups, in a non-production environment, once per
quarter and before any public release. A backup regime that is never exercised
is a belief, not a capability.

1. Take fresh backups of both databases.
2. Restore both into scratch databases and compare manifests.
3. Rehearse one S1 split-migration recovery end to end.
4. Rehearse one full restore of `dsd_corpus_db`, including the curation-batch
   re-import for content written after the backup.
5. Time every step. Record the results.

The exercise fails if any step cannot be completed **from this document alone**.
That is the actual test: not whether recovery is possible, but whether it is
possible by someone who was not there when it was built.

---

## 8. Environment reference

| Variable | Purpose |
| --- | --- |
| `DSD_DB_DATABASE` | DSD database name. Must never equal `DB_DATABASE`. |
| `DSD_RELEASE_CHANNEL` | `off`, `internal`, or `public`. |
| `DSD_APP_DATABASE_URL` | Serving role. No fallback to any other role. |
| `DSD_CURATOR_DATABASE_URL` | Curation commands. |
| `DSD_AUDIT_DATABASE_URL` | Similarity audit, DSD side. |
| `DSD_MIGRATOR_DATABASE_URL` | Migrations. |
| `DSD_BACKUP_DATABASE_URL` | `pg_dump`. |
| `LEGACY_AUDIT_DATABASE_URL` | Similarity audit, legacy side. One view only. |
| `DSD_BACKUP_DIR` | Local backup directory, mode `0700`. |
| `DSD_BACKUP_RETENTION_DAYS` | Retention window. |
| `DSD_RESTORE_MAX_AGE_HOURS` | Maximum age of a restore proof at release. |
| `DSD_PG_CONTAINER` | Run `pg_dump`/`pg_restore` inside this container. |

---

## 9. Known environment issues

**Container `/dev/shm` is 64 MB.** The Docker default is too small to back
parallel workers over a million-row aggregate, and it already failed a count
against the compliance view during development. The backup reader sets
`max_parallel_workers_per_gather = 0` to avoid it, but production should raise
`shm_size` in `deploy/compose.yml` rather than rely on that workaround.

**`pg_dump` is absent from developer hosts.** Set `DSD_PG_CONTAINER`.

**`backups/` is gitignored.** A dump contains the unlicensed legacy Vietnamese
in full. It must never be committed, attached to an issue, or copied to a
shared drive without encryption.

---

## 10. Outstanding

These are required by Task 2A and not yet built. Until they exist, disaster
recovery is incomplete — a local dump on the same host as the database it came
from does not survive the loss of that host.

- Off-host encrypted upload with KMS, bucket versioning, and `HeadObject`
  verification (`scripts/dsd/upload-backup.ts`).
- Deploy integration: backup both databases, run both migration steps
  separately, record before/after versions, and stop safely on any failure.
- Scheduled restore rehearsal (`.github/workflows/verify-dsd-backup.yml`).
