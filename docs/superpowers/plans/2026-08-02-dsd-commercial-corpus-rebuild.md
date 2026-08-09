# DSD Commercial Corpus Rebuild Implementation Plan

> **Status:** Implementation in progress. The engineering boundary and tooling
> described in the checkpoint below exist in the working tree; the human,
> legal, infrastructure-evidence, and real-content programme is not complete.
> This document does not itself authorize a production deployment, production
> data mutation, or commercial release.
>
> **Implementation checkpoint 2026-08-09:** the fail-closed DSD data source and
> API routing, schema/migrations, curation and similarity tooling, IPA/audio
> gates, deterministic signed export, exact release membership, release audit,
> and Task 2A backup/restore/deploy tooling are implemented in the working tree.
> All migrations have been exercised on the empty local DSD workbench. This is
> not a commercial `GO`: Task 2B's register, measurement protocol, and explicit
> staffing-gate record are implemented, but the gate correctly remains
> `BLOCKED / UNCOMMITTED` pending real contributor/IP evidence and human
> approval. Source and voice-rights approvals, production
> infrastructure/restore evidence, signing trust root, and Tasks 19–24 real
> content remain incomplete or deliberately blocked.

**Goal:** Build a new, commercially releasable English-learning corpus under the DSD name without importing expressive content or row identity from the legacy dictionary, and integrate it into the API behind a fail-closed commercial-safe boundary.

**Architecture:** DSD content lives in a dedicated PostgreSQL database and a dedicated TypeORM data source. It does not reuse `words`, `definitions`, `examples`, `pronunciations`, or the current `learner_*` tables. The existing database remains legacy/reference-only. DSD authoring tools connect only to the DSD database; a separate compliance-only similarity process may read the legacy database through a read-only account and may write only scores and decisions back to DSD. Commercial-safe API requests read DSD only and never fall back to legacy or generated content.

**Content policy:** Publishable definitions, examples, Vietnamese translations,
IPA decisions, learning levels, and relations are DSD-authored or
DSD-contracted and human-approved under a clean-room workflow. Public-domain
material and approved permissively licensed software may support fact-checking
or candidate generation, but third-party wording and raw tool output are never
promoted directly. OEWN, NGSL, Wiktionary, the `tudien` archive, Amy, Ryan, and
all legacy rows are excluded from the DSD release.

**Approved audio direction:** The server-side TTS service uses the pinned
`rhasspy/piper` `2023.11.14-2` runtime with `en_US-ljspeech-medium` for the
existing public `en-aria` contract ID and `en_US-norman-medium` for
`en-guy`. User-facing labels become `DSD Female` and `DSD Male`; they must not
claim to be Amy, Ryan, LJSpeech, Norman, or a real speaker. Amy and Ryan are
blocked. No Piper/eSpeak binary, library, model, installer, container, or TTS
service is bundled into a distributed client without a new distribution and
rights review.

**Tech stack:** NestJS 11, TypeORM 0.3, PostgreSQL, Jest, TypeScript curation
CLIs, Python candidate adapters where required, FastAPI/Pytest in
`tts-service`, pinned Piper ONNX voices, SHA-256 manifests, and Ed25519 release
signatures.

---

## Recorded product decisions

- [x] **APPROVED 2026-08-02.** Use a separate PostgreSQL database named
  `dsd_corpus_db`, not the current `english_learning_db`. It may run in the same
  PostgreSQL cluster, but it has its own roles, migrations, backups, and data
  source.
- [x] **APPROVED 2026-08-02.** Keep the existing legacy and `learner_*` tables
  reference-only; do not migrate their content into DSD.
- [x] **APPROVED 2026-08-02.** Use fresh UUIDs for every DSD entry, sense,
  example, pronunciation, relation, and audio asset.
- [x] **APPROVED 2026-08-02.** Build DSD's headword inventory independently
  from product requirements; do not export the legacy headword set as a
  starting list.
- [x] **APPROVED 2026-08-02.** Treat OEWN and NGSL as excluded from DSD v1 even though the existing project previously approved them under attribution/share-alike terms. See *Accepted trade-off: excluding OEWN* below.
- [x] **APPROVED 2026-08-02.** Require a different human reviewer from the
  author for every publishable textual or IPA record.
- [x] **APPROVED 2026-08-02.** Require US IPA plus human-reviewed headword
  audio from both approved voices before an entry can ship in a complete DSD
  release.
- [x] **APPROVED 2026-08-02.** Use the pinned TTS stack only on DSD-controlled
  servers or authoring machines. Do not bundle any part of it into a web,
  desktop, mobile, or other customer-distributed client under this plan.
- [x] **APPROVED 2026-08-02.** Treat the 500-headword package as an internal
  release drill, 5,000 as the first public commercial v1, and 20,000 as the
  extended corpus. Do not target parity with the 475,153-word legacy corpus.
- [x] **APPROVED 2026-08-02.** Keep the public DSD release channel closed until
  the 5,000-entry v1 passes all gates. A pilot is never a public dictionary.

If any decision changes, update this plan before implementation. Do not silently weaken a release gate to preserve compatibility.

### Accepted trade-off: excluding OEWN

**Decision.** OEWN stays out of authoring and production data, and out of
anything derived from it — including Vietnamese translated from an OEWN
definition.

**Rationale.** CC BY 4.0 permits commercial use, but attribution propagates.
A dataset built on OEWN carries a permanent attribution and licence-compliance
chain that every downstream licensee inherits, so DSD could not offer clean
terms to a buyer or partner. The objective is an independently authored corpus
that can be licensed or resold without a third-party data-attribution chain.
Attribution is cheap when you ship an app and expensive when you license data;
this project is the second case.

**Accepted cost.** Every English definition is authored from scratch rather
than adapted. Taking the review gates at face value — each publishable record
authored and independently reviewed:

| | v1 (5,000 headwords) | extended (20,000) |
| --- | --- | --- |
| Definitions | ~10,000 | ~40,000 |
| Vietnamese translations | ~10,000 | ~40,000 |
| Bilingual examples | ~10,000 | ~40,000 |
| IPA / audio assets | 5,000 / 10,000 | 20,000 / 40,000 |

At roughly 25 minutes for a skilled bilingual lexicographer to author a
complete entry, plus independent review, v1 is on the order of **1.4
person-years** and the 20,000-headword corpus roughly **5.6 person-years** —
about four contributors for four to five months to reach v1. Using OEWN for the
English side would have halved this. That saving is knowingly declined to build
DSD-controlled original textual content without a third-party data-attribution
chain. Contributor and non-copyright rights still require the gates below.

**These figures are provisional.** The 25-minute assumption has not been
measured on this content, this language pair, or this review workflow, and the
derived calendar is a planning placeholder rather than a commitment. It does
not yet separately quantify per-asset audio listening/rework or the engineering,
operations, and legal programme. Task 2B requires the 500-headword pilot to
record actual authoring and review throughput, rework rate, audio-review time,
and similarity false-positive rate; re-derive both estimates from those
measurements and update this section before any launch date is set.

**Consequence for planning.** Tasks 23 and 24 are staffing programmes, not
sprints. Do not schedule them as engineering iterations, and do not relax
invariant 6 (`authored_by ≠ reviewed_by`) to compensate for throughput —
independent review is what makes the corpus defensible as original work.

---

## Review findings and disposition (2026-08-02)

- **F1 — DSD backup and operational roles: RESOLVED IN PLAN by Task 2A.** It
  now covers scoped roles, pre-migration backups, snapshot-bound manifests,
  off-host copies, restore rehearsal, and non-atomic cross-database recovery.
- **F2 — Similarity threshold and clearing path: RESOLVED IN PLAN by Task
  8A.** Thresholds are calibrated by record type against a labeled benchmark;
  manual clearance is hash-bound, reasoned, versioned, and invalidated by any
  edit or policy change.
- **F3 — Interim serving posture: RESOLVED IN PLAN by Task 15 and Task 22.**
  The DSD channel is `off`, `internal`, or `public`; the pilot is internal only,
  and `public` cannot activate before signed v1.
- **F4 — Two voices at v1: ACCEPTED PRODUCT COST.** Both voices remain a
  per-entry release gate. Every released headword asset receives automated QA
  and an individual human listening decision; sampling is only an additional
  checkpoint, not a substitute for review.
- **F5 — Client bundling boundary: RESOLVED IN PLAN by Task 11 and the
  non-goals.** Server-side use is allowed after artifact and rights review;
  customer distribution is outside this plan.
- **F6 — Public-domain recordings do not alone clear voice/personality rights:
  RESOLVED AS A RELEASE GATE in Tasks 1, 11, and 17.** Copyright evidence for
  the training recordings and model is necessary but not sufficient. Counsel
  must approve the intended territories and uses or DSD must replace the voice
  with one trained from an explicitly contracted speaker.

---

## Evidence fixed for this plan

- Misaki is Apache-2.0 and documents American English with `fallback=None`: [official repository](https://github.com/hexgrad/misaki).
- Microsoft PhoneticMatching is MIT and exposes General English IPA, but has old native dependencies that require a feasibility check: [official repository](https://github.com/microsoft/PhoneticMatching).
- LJSpeech's Piper model card records a public-domain dataset and training from scratch: [official model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD).
- Norman's Piper model card records public-domain LibriVox audio and training from scratch: [official model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/norman/medium/MODEL_CARD).
- Ryan is blocked because its model card records `CC BY-NC-SA 4.0`: [official model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ryan/medium/MODEL_CARD).
- Amy is blocked because it is fine-tuned from Lessac: [Amy model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/amy/medium/MODEL_CARD). Lessac's upstream agreement restricts the material to research and excludes commercial TTS: [official licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).
- The exact archived `rhasspy/piper` runtime used by the current installer is
  MIT at release `2023.11.14-2`; the newer `OHF-Voice/piper1-gpl` project is a
  different GPL-3.0 code line and is not an implicit upgrade target:
  [archived MIT licence](https://github.com/rhasspy/piper/blob/master/LICENSE.md),
  [pinned release](https://github.com/rhasspy/piper/releases/tag/2023.11.14-2),
  [new GPL project](https://github.com/OHF-Voice/piper1-gpl).
- The archived `piper-phonemize` wrapper is MIT, while eSpeak NG is a separately
  licensed dependency. The complete binary/container dependency tree must be
  inventoried rather than labeled simply "MIT":
  [piper-phonemize licence](https://github.com/rhasspy/piper-phonemize/blob/master/LICENSE.md),
  [eSpeak NG copying terms](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING).
- GPL does not generally cover ordinary program output, but distribution of
  covered software remains a separate compliance question:
  [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#WhatCaseIsOutputGPL).

These links are evidence inputs, not final legal clearance. A repository-level
licence badge does not necessarily state the licence or performer-rights status
of every voice. Implementation must pin revisions and hashes, snapshot the
relevant notices/model cards, inventory transitive runtime dependencies, and
obtain the release approvals required below.

---

## Global invariants

1. No DSD table has a foreign key to a legacy table or stores a legacy row ID.
2. No DSD authoring command imports or queries a legacy entity.
3. Only the compliance similarity command may open both database connections.
4. DSD authoring files never contain legacy definitions, examples, translations, or IPA as hints.
5. No content becomes `published` without author, reviewer, timestamps, content hash, and an append-only provenance event.
6. `authored_by` and `reviewed_by` must differ for approved content.
7. Machine output is always a candidate. It cannot satisfy human review fields.
8. A published sense requires an approved Vietnamese translation and at least one approved bilingual example.
9. A released entry requires approved US IPA and approved LJSpeech and Norman audio assets.
10. Commercial-safe mode reads DSD only. Missing DSD content returns `404`; it never falls back.
11. Every external tool/model is pinned by immutable revision and SHA-256.
12. Every mutating CLI is dry-run by default and requires `--write`.
13. Imports are transactional and idempotent. Approved/published content cannot be overwritten by draft data.
14. Exports never overwrite an existing directory.
15. The release audit must report zero unknown, blocked, non-commercial, share-alike, legacy, or unreviewed sources.
16. Every authoring batch carries a clean-room declaration: authors did not
    consult or paste blocked dictionary wording while composing it, and all
    research/tool exposure is disclosed.
17. Similarity clearance is bound to the DSD content hash, comparison-policy
    hash, algorithm version, reviewer, reason, and time. Any content or policy
    change makes the clearance stale.
18. The 500-headword pilot is internal-only and cannot activate the public DSD
    release channel.
19. No Piper/eSpeak/model artifact is bundled into a distributed client under
    this plan.
20. Every released audio asset passes deterministic automated QA and an
    individual human listening decision; a batch sample cannot approve
    unreviewed assets.
21. No public release proceeds without contributor-rights evidence, a current
    backup/restore proof, approved release territories, and legal clearance of
    model, training-data, performer/personality, and distribution rights.

---

## Target DSD schema

The completed migration series creates these tables in `dsd_corpus_db`; Task 3
creates the core content/provenance tables and later tasks add their own tables:

| Table | Purpose |
| --- | --- |
| `dsd_entries` | Independent DSD headwords and learning priority |
| `dsd_senses` | DSD-authored English definitions and usage labels |
| `dsd_translations` | Reviewed Vietnamese sense translations |
| `dsd_examples` | Reviewed DSD-authored bilingual examples |
| `dsd_pronunciations` | Human-approved IPA; machine candidates are not stored here |
| `dsd_ipa_candidates` | Non-publishable Misaki/validator suggestions |
| `dsd_audio_assets` | Model/input/file hashes and storage locations |
| `dsd_relations` | DSD-authored synonym, antonym, inflection, and related-word links |
| `dsd_provenance_events` | Append-only authorship, review, import, generation, and release ledger |
| `dsd_similarity_results` | Scores and compliance decisions; no legacy text |
| `dsd_release_builds` | Immutable release manifests and audit result hashes |

Content records use the following workflow values:

```text
draft -> in_review -> approved -> published -> retired
                    \-> rejected
```

Candidates use:

```text
generated -> inspected -> accepted_as_hint | rejected
```

Accepting a hint does not publish it. A human must author the final content record separately.

---

## Execution gates, ownership, and dependency order

| Gate | Owner roles | Opens | Required evidence |
| --- | --- | --- | --- |
| A1 policy/rights | Product owner + legal reviewer | Source/tool registration and technical evaluation | Approved source policy, contributor template, rights matrix, territories |
| A2 platform safety | Tech lead + platform/data owner | Any DSD write outside a disposable workbench | Scoped roles, migrations, two-database backup, off-host copy, restore proof |
| A3 staffing | Product owner + legal reviewer | Task 20 content authoring/review | Eligible author and different reviewer, executed rights evidence |
| B similarity | Compliance + linguistic + legal reviewers | First real textual batch | Frozen Task 8A policy and benchmark approval |
| C IPA | Linguistic/phonetic owner | Real IPA approval | Cleared candidate stack and two-person IPA workflow |
| D audio rights/storage | Legal + audio + platform owners | Real release-eligible audio generation | Voice/runtime rights approval, locked artifacts, durable storage |
| F release | Product + legal + linguistic + data owners | Internal signed package or public activation | `GO` audit, signatures, current restore proof, target-territory sign-offs |

Task dependency spine:

```text
1 -> 2 -> 2A -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 8A
1 + 3 ----------------------------> 9 -> 10
1 -------------------------------> 11 -> 12 -> 12A -> 13
3 + 12A --------------------------> 14 -> 15 -> 16 -> 17 -> 18
2B recorded + 4 ------------------> 19
2B cleared + 8A + 19 -------------> 20 -> 21 -> 22 -> 23 -> 24
```

Task 2B may record a staffing block without stopping Tasks 1–19, but Task 20
cannot start until the block is cleared. Task 11 technical work may run before
voice-rights approval, but Tasks 21–24 cannot treat its output as
release-eligible until Gate D passes.

---

# Phase A — Governance and repository boundary

## Task 1: Create the DSD policy, source registry, and tool registry

**Files:**

- Create: `docs/dsd-corpus/README.md`
- Create: `docs/dsd-corpus/AUTHORING-POLICY.md`
- Create: `docs/dsd-corpus/REVIEW-RUBRIC.md`
- Create: `docs/dsd-corpus/COMMERCIAL-RELEASE-CHECKLIST.md`
- Create: `docs/dsd-corpus/IP-ASSIGNMENT-CHECKLIST.md`
- Create: `docs/dsd-corpus/RIGHTS-MATRIX.md`
- Create: `docs/dsd-corpus/CLEAN-ROOM-DECLARATION.md`
- Create: `data/dsd/source-registry.json`
- Create: `data/dsd/tool-registry.json`
- Create: `data/dsd/contributor-registry.json`
- Create: `scripts/dsd/lib/registry.ts`
- Create: `scripts/dsd/lib/registry.spec.ts`
- Modify: `docs/provenance-and-licensing.md`
- Modify: `.gitignore`

**Implementation:**

- Define source scopes: `inventory`, `definition`, `translation`, `example`, `pronunciation`, `relation`, `audio_model`, `audio_training_data`, `tool`.
- Register only DSD-authored/contracted content as publishable textual sources.
- Register LJSpeech and Norman as the selected technical candidates, with
  public-domain training-recording evidence, but keep public-release status
  blocked until the complete Task 1 rights matrix is approved.
- Register Misaki and Microsoft PhoneticMatching as candidate tools only.
- Explicitly register Amy, Ryan, Lessac, OEWN, NGSL, Wiktionary, `tudien`, and legacy content as blocked for DSD.
- Register pseudonymous contributor IDs, active roles, separation-of-duty permissions, and IP-assignment evidence IDs. Keep names, signatures, and other personal data outside Git.
- Make the registry parser reject duplicate aliases, unknown scopes, mutable URLs without a revision, missing evidence, and an approved source without an approved scope.
- Keep signed contracts and personal data outside Git. Store only evidence IDs and approval status in the repository.
- Define the clean-room authoring boundary: blank DSD templates only; no legacy
  or blocked dictionary window, export, prompt, clipboard content, or wording in
  the author workspace; every batch includes a signed declaration and a list of
  any approved research or tools used.
- Require a counsel-approved contributor agreement that includes a present
  assignment of relevant rights, an assignment fallback where work-for-hire is
  unavailable, originality/non-infringement warranties, disclosure of tools and
  research sources, confidentiality, and moral-rights waiver or consent to the
  extent permitted in the governing jurisdiction.
- Build a rights matrix that treats corpus copyright, software licence, model
  licence, training-recording copyright, performer/voice/personality rights,
  release territory, and binary distribution as separate questions. A
  public-domain training-data label cannot clear the other columns.
- Update `docs/provenance-and-licensing.md` with a separate DSD layer. Preserve
  the historical OEWN/NGSL rules for the existing learner overlay, but make it
  explicit that neither source is approved for DSD.

**Tests:**

```bash
npm run test:scripts -- --runInBand scripts/dsd/lib/registry.spec.ts
```

**Acceptance:**

- Registry validation passes.
- `DSD English original content` remains blocked until the IP-assignment evidence ID is recorded.
- LJSpeech and Norman remain blocked for public release until the rights matrix
  has legal approval for the intended territories and use. If approval is not
  obtained, update this plan and the registries, then replace them with voices
  trained under explicit DSD speaker/TTS consent before Task 21.
- The contributor agreement template and release-territory list have legal
  approval evidence IDs.
- No existing registry is broadened implicitly.

**Review checkpoint A1:** Product owner and legal reviewer approve the source
policy, rights matrix, contributor agreement template, release territories, and
who may sign each class of approval.

---

## Task 2: Add a dedicated DSD database configuration and migration runner

**Files:**

- Create: `src/dsd-corpus/dsd-corpus.config.ts`
- Create: `src/dsd-corpus/dsd-corpus.datasource.ts`
- Create: `src/dsd-corpus/dsd-corpus.module.ts`
- Create: `src/dsd-corpus/migrations/runner.ts`
- Create: `scripts/dsd/migrations.ts`
- Create: `scripts/dsd/create-workbench.sh`
- Create: `src/dsd-corpus/dsd-corpus.config.spec.ts`
- Modify: `src/config/configuration.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `deploy/compose.yml`

**Interfaces:**

```text
DSD_DB_HOST
DSD_DB_PORT
DSD_DB_DATABASE=dsd_corpus_db
DSD_APP_DATABASE_URL
DSD_CURATOR_DATABASE_URL
DSD_AUDIT_DATABASE_URL
DSD_MIGRATOR_DATABASE_URL
DSD_BACKUP_DATABASE_URL
```

Add commands:

```text
dsd:db:create
dsd:migration:show
dsd:migration:run
dsd:migration:revert
```

**Implementation:**

- Use a separate TypeORM data source and a separate `dsd_migrations` table.
- The API uses `DSD_APP_DATABASE_URL`; curation commands use
  `DSD_CURATOR_DATABASE_URL`; the similarity command uses
  `DSD_AUDIT_DATABASE_URL` plus `LEGACY_AUDIT_DATABASE_URL`; and production
  migrations use `DSD_MIGRATOR_DATABASE_URL`. No command silently falls back to
  another role's URL.
- Refuse to initialize if `DSD_DB_DATABASE` equals the legacy database name.
- The workbench script creates only an empty DSD database and local equivalents
  of the scoped roles from Task 2A; it never clones `english_learning_db`.
- Production configuration fails closed for DSD dictionary traffic. When the
  release channel is `internal` or `public`, an unavailable DSD connection
  fails startup/health. When the channel is `off`, user/auth/progress routes may
  remain healthy while public dictionary routes return `404`; they never fall
  back to legacy.
- Do not add DSD entities to the legacy connector.
- `dsd:migration:revert` is a local/rehearsal command only. Production recovery
  uses a reviewed forward migration or the Task 2A restore runbook; deploy never
  auto-reverts a partially completed cross-database sequence.

**Tests:**

```bash
npm test -- --runInBand src/dsd-corpus/dsd-corpus.config.spec.ts
npm run build
```

**Acceptance:**

- DSD migrations can run against an empty database.
- Legacy migration status and row counts are unchanged.
- A test proves the two database names cannot be equal.
- Configuration tests prove every role-specific URL targets
  `DSD_DB_DATABASE`, uses the expected role, and cannot fall back to an owner or
  legacy credential.

---

## Task 2A: Provision, back up, and restrict the DSD database (addresses F1)

Task 2 delivers application configuration and the local workbench. This task
delivers production roles, migration sequencing, recoverable backups, and the
least-privilege legacy input used only by Task 8. It finishes before any DSD
content is authored.

**Files:**

- Create: `scripts/dsd/provision-dsd-database.sh`
- Create: `scripts/dsd/grant-legacy-similarity-reader.sql`
- Create: `scripts/dsd/create-backup-manifest.ts`
- Create: `scripts/dsd/create-backup-manifest.spec.ts`
- Create: `scripts/dsd/upload-backup.ts`
- Create: `scripts/dsd/upload-backup.spec.ts`
- Create: `scripts/dsd/backup-offhost.ts`
- Create: `scripts/dsd/download-backup.ts`
- Create: `scripts/dsd/download-backup.spec.ts`
- Create: `scripts/dsd/record-backup-proof.ts`
- Create: `scripts/dsd/record-backup-proof.spec.ts`
- Create: `scripts/dsd/verify-restore.spec.ts`
- Create: `scripts/dsd/verify-database-restores.sh`
- Create: `scripts/dsd/permissions.spec.ts`
- Create: `src/dsd-corpus/migrations/1785629600000-GrantDsdOperationalMetadata.ts`
- Create: `src/dsd-corpus/migrations/1785629600000-GrantDsdOperationalMetadata.spec.ts`
- Create: `docs/dsd-corpus/OPERATIONS.md`
- Create: `.github/workflows/verify-dsd-backup.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `deploy/compose.yml`
- Modify: `Dockerfile`
- Modify: `.env.example`
- Modify: `package.json`

**Role model:**

```text
dsd_owner              NOLOGIN owner role for the DSD database/schema
dsd_migrator           DDL through controlled membership in dsd_owner
dsd_curator            scoped content workflow DML + provenance INSERT
dsd_app                SELECT on published serving views only
dsd_auditor            DSD read + similarity-result decisions + provenance INSERT
dsd_backup             read-only access required by pg_dump
dsd_similarity_reader  SELECT on one legacy audit view only
legacy_backup          read-only legacy access required by pg_dump
dsd_restore_operator   CREATEDB only for guarded scratch restores; no corpus access
```

Routine services never authenticate as `dsd_owner`. `dsd_curator` cannot alter
schema, change role grants, mutate or delete provenance events, or bypass
published-content guards. `dsd_auditor` cannot edit authored content.
`dsd_auditor` and `dsd_backup` may read the TypeORM `dsd_migrations` ledger so
an audit or backup can bind its evidence to the actual schema version; this
operational metadata grant does not expose authored content to `dsd_app` or
widen the legacy similarity boundary.

**Operational interfaces:**

```text
LEGACY_AUDIT_DATABASE_URL
LEGACY_BACKUP_DATABASE_URL
DSD_BACKUP_DATABASE_URL
DSD_RESTORE_DATABASE_URL
DSD_BACKUP_DIR
DSD_BACKUP_S3_URI
DSD_BACKUP_S3_REGION
DSD_BACKUP_KMS_KEY_ID
DSD_BACKUP_RETENTION_DAYS
DSD_RESTORE_MAX_AGE_HOURS
```

Secrets live in the production secret store and never in Git, command output,
backup manifests, or release artifacts.

**Implementation:**

*Idempotent provisioning.* Guard role/database creation through `pg_roles` and
`pg_database`. A normal re-run makes no changes. Never drop, recreate, rename,
reassign, or change credentials for an existing populated database. Credential
rotation is an explicit, separately confirmed operation. Refuse unresolved or
unsafe identifiers and refuse when the DSD and legacy database names match.

*Legacy audit view.* Create an owner-controlled view such as
`dsd_compliance.english_similarity_input` that exposes only
`record_kind`, `headword`, `part_of_speech`, `content_en`, and a deterministic
digest. The view performs the joins internally; it exposes no legacy row ID,
Vietnamese column, pronunciation, learner table, or cleanup/backup table. Grant
`dsd_similarity_reader` `CONNECT`, `USAGE` on that schema, and `SELECT` on that
view only. Revoke direct base-table/schema access and applicable existing and
default `PUBLIC` privileges from the correct object owner. Task 8 is the only
consumer, and author-facing output never returns `content_en`.

*Non-atomic migration sequence.* PostgreSQL cannot make migrations in two
databases atomic. Before either migration, preflight both data sources and
produce verified backups for both databases. Require every migration in this
sequence to be backward compatible with the currently deployed application.
Run legacy and DSD migration steps separately, record their before/after
versions, and stop before application deployment if either fails. Do not
auto-revert. `OPERATIONS.md` defines roll-forward and restore choices for each
possible split state and requires operator confirmation.

*Snapshot-bound backups.* Use custom-format `pg_dump` files. For each database,
capture the dump and a canonical manifest from the same exported
repeatable-read snapshot. The manifest contains database name, creation time,
migration versions, dump SHA-256, PostgreSQL/pg_dump versions, per-table row
counts, canonical ordered content digests, and the manifest-schema version.
Never compare an old dump with a live database that may have changed.

*Off-host recovery.* Store local backups with directory mode `0700` and file
mode `0600`, then upload encrypted copies with a pinned version of the
Apache-2.0 `@aws-sdk/client-s3`, explicit KMS encryption, bucket versioning,
and retention. Verify the exact remote object versions, size, checksum metadata,
native object checksum, encryption/key ID, retention, and version ID through
`HeadObject`. A local dump alone is not disaster recovery.
Production migration is blocked if either dump, manifest, checksum
verification, remote upload, or remote metadata check fails.

*Restore rehearsal.* On a schedule and before public release, download and
verify the newest eligible backup for each database, restore each to a uniquely
named scratch database whose name is validated never to equal either production
database, recompute its canonical manifest, and compare it with the stored
snapshot manifest. Only after **both** exact off-host database versions restore
successfully may the tool write the structured proof consumed by the release
audit. Bind that proof to both manifests, dump hashes, remote version IDs, and
the DSD migration version. Record duration and result, then remove a scratch
database only after the guard succeeds.

**Tests:**

```bash
zsh scripts/dsd/provision-dsd-database.sh
zsh scripts/dsd/provision-dsd-database.sh          # no-op, exit 0
npm run test:scripts -- --runInBand scripts/dsd/permissions.spec.ts
zsh scripts/dsd/verify-database-restores.sh
npm run dsd:migration:show
```

Permissions tests prove the audit reader can select the narrow view and is
denied `SELECT *` on `words`, `definitions`, `examples`, every Vietnamese
column, every `learner_*`/cleanup/backup table, and all writes/DDL. Tests also
prove `dsd_app` cannot read drafts and curator/auditor roles cannot cross their
write boundaries.

**Acceptance:**

- Provisioning is idempotent and refuses equal DSD/legacy names.
- No routine process authenticates as the owner role.
- Permission tests demonstrate the complete allowlist and denylist above.
- A deploy backs up both databases, uploads verified off-host copies, records
  both migration states, and stops safely on any failure.
- Restore rehearsal reproduces the snapshot-bound row counts and digests, and a
  successful proof is no older than `DSD_RESTORE_MAX_AGE_HOURS` at release.
- `OPERATIONS.md` documents role/secret rotation, retention, restore, split
  migration recovery, scratch safety, and a quarterly recovery exercise.

---

## Task 2B: Confirm authoring capacity and contributor IP evidence (staffing gate)

A governance gate, not an engineering task. It exists because invariant 6
(`authored_by ≠ reviewed_by`) cannot be satisfied by tooling, and because
contributor IP assignment is what makes the OEWN exclusion actually pay off.
At plan completion, no named/eligible authoring capacity has been supplied;
implementation must record the gate as `uncommitted` until external evidence
proves otherwise. Do not invent contributor identities to mark it complete.

**Why this is a gate and not an administrative detail.** OEWN was excluded to
avoid a third-party attribution chain on a corpus intended for licensing or
resale. If contributor agreements do not give DSD the rights required for that
commercial model, DSD may pay the full clean-room authoring cost while still
being unable to offer the promised licensing terms. Contributor-rights evidence
is therefore load bearing, not paperwork.

**Deliverables:**

- Create: `docs/dsd-corpus/CONTRIBUTORS.md` — the contributor register
- Create: `docs/dsd-corpus/evidence/DSD-STAFFING-GATE.md` — the gate decision
- Create: `docs/dsd-corpus/evidence/PILOT-MEASUREMENT-PROTOCOL.md` — metric
  definitions, timers, exclusions, and reporting template

**Minimum release capacity:**

- At least one human author, and at least one **different** human reviewer.
- Both recorded in the Git-tracked register with: pseudonymous stable identifier, role
  (`author`, `reviewer`, or both on different records), languages, engagement
  type (employee or contractor), start date, and a reference to signed
  contributor-rights evidence. Real names, signatures, contact data, contract
  terms, and identity mapping remain in the approved external evidence store.
- `authored_by` and `reviewed_by` values written to `dsd_provenance_events`
  must match register identifiers, so the ledger and the register cannot drift.
- The evidence is based on the counsel-approved agreement from Task 1; a
  work-for-hire label without an assignment fallback is insufficient.

**Blocking rules if no second reviewer is committed:**

- **Blocked:** Task 20 (author and review pilot content), Task 21 (IPA and
  audio review), Task 22 (pilot release drill), and any commercial release.
  These all require independent review and cannot be satisfied by one person.
- **May proceed:** Tasks 1–18 (engineering, tooling, schema, audits, export)
  and Task 19 (the 500-headword inventory), since inventory selection is a
  product decision and carries no publishable expressive content.
- Record the block explicitly in the gate document. Do not work around it by
  relaxing invariant 6 or by having one person hold both roles under different
  identifiers.

**On the effort estimate.** The ~1.4 person-year figure for v1 and the derived
four-to-five-month calendar are **provisional**. They rest on an assumed ~25
minutes to author a complete entry plus independent review, which has not been
measured on this content, this language pair, or this review workflow. Treat
them as a planning placeholder for content labour only, not an engineering,
operations, legal, or already-measured launch estimate.

Task 19 approves the measurement protocol and instruments the inventory stage.
Tasks 20 and 21 then record actual authoring minutes per entry, review minutes
per record/asset, rework rate, rejection reasons, similarity-review time, and
similarity false-positive rate. Re-derive the v1 and 20,000-headword estimates
from the completed pilot and update the *Accepted trade-off* section. Do not
commit to a launch date before that measurement exists.

**Acceptance:**

- Contributor register exists and lists at least one author and one different
  reviewer, or explicitly records that the second reviewer is uncommitted and
  Tasks 20–22 are blocked.
- Every listed contributor has executed, counsel-approved contributor-rights
  evidence referenced, or remains ineligible to author/review publishable data.
- The gate decision is signed by the product owner and legal reviewer.
- The pilot throughput measurement plan is agreed before Task 19 begins.

---

## Task 3: Create core DSD entities and constraints

**Files:**

- Create: `src/dsd-corpus/entities/dsd-entry.entity.ts`
- Create: `src/dsd-corpus/entities/dsd-sense.entity.ts`
- Create: `src/dsd-corpus/entities/dsd-translation.entity.ts`
- Create: `src/dsd-corpus/entities/dsd-example.entity.ts`
- Create: `src/dsd-corpus/entities/dsd-pronunciation.entity.ts`
- Create: `src/dsd-corpus/entities/dsd-provenance-event.entity.ts`
- Create: `src/dsd-corpus/migrations/1785628800000-CreateDsdCorpusCore.ts`
- Create: `src/dsd-corpus/migrations/1785628800000-CreateDsdCorpusCore.spec.ts`

**Required fields:**

- Entries: UUID, headword, normalized headword, language, DSD priority/band, inventory evidence, status.
- Content: UUID, immutable revision number, optional same-table
  `supersedes_id`, author identity, authored timestamp, reviewer identity,
  reviewed timestamp, content SHA-256, approved source-registry ID, authoring
  batch ID, contributor-rights evidence ID, and status.
- Provenance events: entity kind/ID, event type, actor, source/tool identifiers, input/output hashes, evidence ID, timestamp.

**Constraints:**

- Unique `(language, normalized_headword)`.
- Unique sense key and sense order per entry.
- Unique translation locale per sense.
- Unique example order per sense.
- Unique pronunciation `(entry, accent, priority)`.
- Approved/published content requires review metadata and `authored_by <> reviewed_by`.
- Published definitions, translations, examples, and pronunciations require non-empty source identifiers. The release audit validates those identifiers against the versioned DSD registry; database constraints do not pretend to validate a JSON file.
- Status, locale, POS, and event type use explicit allowlists. All stored times
  are UTC and application-supplied review times cannot be in the future.
- Published rows cannot be edited in place. A correction creates a new draft
  revision linked to the retired revision and repeats review, similarity, and
  publication gates.
- `dsd_provenance_events` is append-only: operational roles receive INSERT as
  required but no `UPDATE`/`DELETE`; a database trigger rejects mutation outside
  the documented owner-only break-glass path.

**Tests:**

- Migration SQL creates no FK to a legacy table.
- Invalid transitions and same-person review fail.
- Published-row mutation and provenance mutation fail under every operational
  role.
- Rollback drops only DSD tables.
- Migration round-trip succeeds on an empty scratch DSD database.

**Acceptance:**

```bash
DSD_DB_DATABASE=dsd_corpus_rehearsal npm run dsd:migration:run
DSD_DB_DATABASE=dsd_corpus_rehearsal npm run dsd:migration:show
```

**Review checkpoint A2:** Review the schema and prove there are no legacy
identifiers, cross-database keys, or columns capable of storing legacy wording.

---

# Phase B — Independent inventory and authoring workflow

## Task 4: Build the independent DSD headword inventory tool

**Files:**

- Create: `scripts/dsd/inventory.ts`
- Create: `scripts/dsd/inventory.spec.ts`
- Create: `data/dsd/inventory/inventory-template.csv`
- Create: `data/dsd/schemas/inventory.schema.json`
- Modify: `package.json`

**Commands:**

```text
dsd:inventory:validate --file <csv>
dsd:inventory:import --file <csv> [--write]
dsd:inventory:stats
```

**Implementation:**

- Accept only a DSD-created inventory file with evidence ID, author, date, product rationale, headword, POS expectation, and priority.
- Normalize NFC, whitespace, apostrophes, and case deterministically.
- Reject definitions, translations, examples, IPA, legacy IDs, or source dictionary positions in inventory input.
- Dry-run by default. `--write` imports in one transaction and appends provenance events.
- Generate UUIDs inside DSD; do not match or copy legacy word IDs.
- Require a clean-room declaration ID for the inventory batch. Search analytics
  may contribute aggregate demand terms only when the privacy/data owner has
  approved that use; no legacy dictionary export may be joined to them.

**Acceptance:**

- An input containing `source_definition_id`, `word_id`, or legacy text fails validation.
- Re-importing an unchanged file is idempotent.
- A changed approved entry is rejected unless it uses a dedicated amendment workflow.

---

## Task 5: Define the DSD curation package and content hashes

**Files:**

- Create: `data/dsd/schemas/curation-package.schema.json`
- Create: `data/dsd/curation/curation-template.json`
- Create: `scripts/dsd/lib/content-hash.ts`
- Create: `scripts/dsd/lib/content-hash.spec.ts`
- Create: `scripts/dsd/curation.ts`
- Create: `scripts/dsd/curation.spec.ts`
- Modify: `package.json`

**Package structure:**

```text
entry
  senses[]
    definition_en
    translation_vi
    examples[] { en, vi }
    usage_labels[]
    authorship evidence
```

IPA and audio are separate workflows and must not be accepted in this package.

**Commands:**

```text
dsd:curation:validate --file <json>
dsd:curation:import --file <json> [--write]
dsd:curation:stats
```

**Implementation:**

- Input references DSD entry UUIDs only.
- Definitions, translations, and examples each record their own author and evidence ID.
- Hash normalized content and store the hash both on the row and in the provenance event.
- Import draft content only. This command cannot approve or publish.
- Reject any source not approved for the record's scope.
- Prohibit external provider/model fields in DSD v1; no OpenRouter or remote translation run is part of this plan.
- Require the authoring batch's clean-room declaration and reject a contributor
  whose rights evidence is absent, expired, revoked, or not approved for the
  record's scope.
- Blank templates contain only the DSD entry UUID, headword, expected POS, and
  product rationale. They contain no existing definition, translation,
  example, IPA, similarity score, or blocked-source wording.

**Acceptance:**

- The validator does not connect to either database.
- The importer connects only to DSD.
- Tests prove it cannot populate reviewer fields or publication status.

---

## Task 6: Implement independent review and state transitions

**Files:**

- Create: `scripts/dsd/review.ts`
- Create: `scripts/dsd/review.spec.ts`
- Create: `scripts/dsd/lib/state-machine.ts`
- Create: `scripts/dsd/lib/state-machine.spec.ts`
- Create: `data/dsd/schemas/review-decisions.schema.json`
- Modify: `package.json`

**Commands:**

```text
dsd:review:queue --batch <id> --output <dir>
dsd:review:validate --file <json>
dsd:review:apply --file <json> [--write]
dsd:publish --entry <uuid> [--write]
```

**Implementation:**

- Review queues contain DSD drafts only and never show legacy comparison text.
- Review decisions reference the exact content SHA-256.
- A decision becomes stale if content changes after the queue was generated.
- Reject self-review.
- Approved translations and examples remain independently reviewable.
- A reviewer records linguistic decision notes without pasting third-party
  wording. A rejected/rewrite decision returns DSD-specific guidance only.
- Publication is a separate command and cannot happen automatically on approval. It runs the cross-table completeness, provenance, quality, and similarity gates before changing status.

**Acceptance:**

- A stale hash, unknown reviewer, same author/reviewer, or skipped state fails.
- Every applied decision writes an append-only provenance event.

---

## Task 7: Add deterministic linguistic validation

**Files:**

- Create: `src/dsd-corpus/quality/dsd-quality.ts`
- Create: `src/dsd-corpus/quality/dsd-quality.spec.ts`
- Create: `scripts/dsd/quality-audit.ts`
- Create: `scripts/dsd/quality-audit.spec.ts`
- Modify: `package.json`

**Checks:**

- Empty/whitespace content, raw markup, HTML, templates, prompt leakage, control characters.
- CJK contamination in Vietnamese and unexpected non-Latin scripts.
- Vietnamese equal to English after normalization.
- Duplicate definitions/examples within DSD.
- Circular definitions and headword-only definitions.
- Example does not contain the intended lemma/approved inflection where required.
- Sentence length, punctuation, encoding, and repeated boilerplate.
- POS and usage-label allowlists.
- Formula/CSV injection in exports.

**Acceptance:**

- `dsd:quality:audit` exits non-zero on every critical finding.
- Rules operate only on DSD records.
- No warning is silently converted into approved status.

---

## Task 8: Build the compliance-only legacy similarity audit

**Files:**

- Create: `src/dsd-corpus/entities/dsd-similarity-result.entity.ts`
- Create: `src/dsd-corpus/migrations/1785628900000-AddDsdSimilarityAudit.ts`
- Create: `src/dsd-corpus/migrations/1785628900000-AddDsdSimilarityAudit.spec.ts`
- Create: `scripts/dsd/similarity-audit.ts`
- Create: `scripts/dsd/similarity-audit.spec.ts`
- Create: `scripts/dsd/lib/similarity.ts`
- Create: `scripts/dsd/lib/similarity.spec.ts`
- Modify: `package.json`

**Security boundary:**

- Require `LEGACY_AUDIT_DATABASE_URL` using the Task 2A
  `dsd_similarity_reader` role and `DSD_AUDIT_DATABASE_URL` using
  `dsd_auditor`.
- Refuse to run if the legacy account can write.
- Refuse to run if the legacy account can read any base table or if the DSD
  account can edit authored content.
- This is the only DSD command allowed to open both data sources.
- Store DSD entity ID and content hash, record type, normalization/algorithm
  versions, comparison-policy hash, component scores, match class, legacy
  digest, auditor decision/reason/evidence, reviewer, and timestamps. Do not
  store legacy text or row identity in DSD.
- Author-facing output reports only `clear`, `manual_review`, or `rewrite_required`; it does not reveal legacy wording.

**Algorithms for v1:**

- Exact normalized match.
- Token sequence match.
- Character and word n-gram similarity.
- Deterministic Jaccard/cosine thresholds loaded from the Task 8A versioned
  policy. English definitions and English examples use separate calibrated
  bands; one threshold cannot safely cover both lengths. Legacy Vietnamese is
  not exposed to or compared by this process.
- Semantic embeddings are deferred until a locally runnable, source-cleared model is approved.

**Release policy:**

- Exact match: block.
- High similarity: block until a compliance reviewer chooses
  `rewrite_required` or `independently_authored_cleared` with evidence.
- Medium similarity: manual review with the same hash-bound clearing path.
- Low similarity: record and continue.
- `independently_authored_cleared` is never available for exact matches in v1.
- Authors and linguistic reviewers do not see the matched legacy wording. A
  compliance reviewer who sees it may clear/reject the current DSD hash but may
  not rewrite that record.
- Editing DSD text or changing the normalization, algorithm, or policy hash
  invalidates the previous result and blocks publication until re-audited.

**Acceptance:**

- Tests prove normal authoring commands do not import legacy connectors.
- The audit never writes to legacy.
- Exact, unresolved high/medium, stale, or unknown-policy results block
  publication and release.

---

## Task 8A: Calibrate and freeze the v1 similarity policy (addresses F2)

**Files:**

- Create: `data/dsd/similarity/v1-calibration.jsonl`
- Create: `data/dsd/similarity/v1-policy.json`
- Create: `data/dsd/schemas/similarity-policy.schema.json`
- Create: `scripts/dsd/similarity-calibrate.ts`
- Create: `scripts/dsd/similarity-calibrate.spec.ts`
- Create: `docs/dsd-corpus/SIMILARITY-POLICY.md`
- Modify: `package.json`

**Calibration set:**

- Separate labeled fixtures for short English definitions and English examples.
- Positive controls include exact copies, punctuation/case changes, markup
  changes, small insertions/deletions, reordered clauses, and near-copy edits.
- Negative controls include independently authored valid descriptions that
  naturally share a headword, POS, or unavoidable short factual phrase.
- Fixtures contain synthetic or DSD-authored text only in Git. Real legacy text
  is read at calibration runtime through the restricted audit view and is never
  written to fixtures, logs, snapshots, or reports.

**Policy selection:**

- Exact normalized matches always classify as `exact`.
- Select high/medium thresholds separately by record type. The initial policy
  must catch 100% of exact controls and at least 95% of labeled near-copy
  controls while keeping negative-control manual-review rate at or below 10%.
  If no deterministic threshold meets both targets, improve the algorithm or
  narrow the supported record class; do not weaken the targets silently.
- Freeze normalization version, metric definitions, thresholds, benchmark
  hash, rationale, approvers, and effective date in `v1-policy.json`.
- Any policy change creates a new immutable policy version, invalidates results
  produced by the old policy for the affected record class, and re-audits all
  affected approved/published records before release.

**Decision states:**

```text
clear
manual_review
rewrite_required
independently_authored_cleared
```

Manual clearance requires current content/policy hashes, a compliance-reviewer
ID, reason code, free-text rationale, clean-room declaration ID, and timestamp.
The author only receives the state and DSD-specific rewrite instruction.

**Acceptance:**

- Schema and calibration tests are deterministic and pass the stated targets.
- Product owner, linguistic reviewer, and legal/compliance reviewer approve the
  frozen policy before Task 20 starts.
- Changing one character in cleared DSD text or changing the policy hash makes
  publication fail until the record is re-audited.
- Calibration reports contain scores, labels, aggregates, and digests but zero
  legacy wording or row IDs.

**Review checkpoint B:** Run the full workflow on synthetic fixtures before any real DSD content is authored.

---

# Phase C — IPA candidate and approval workflow

## Task 9: Add non-publishable IPA candidate storage

**Files:**

- Create: `src/dsd-corpus/entities/dsd-ipa-candidate.entity.ts`
- Create: `src/dsd-corpus/migrations/1785629000000-AddDsdIpaCandidates.ts`
- Create: `src/dsd-corpus/migrations/1785629000000-AddDsdIpaCandidates.spec.ts`
- Create: `data/dsd/tools/misaki.lock.json`
- Create: `data/dsd/tools/phonetic-matching.lock.json`

**Constraints:**

- Candidates cannot have `approved` or `published` status.
- Store input headword hash, tool revision, artifact hash, configuration, accent, candidate value, and generation timestamp.
- Candidate rows have no FK path that lets the API present them as pronunciation content.

**Acceptance:**

- The API has no repository for `dsd_ipa_candidates`.
- A database test proves candidates cannot satisfy a pronunciation release gate.

---

## Task 10: Implement IPA generation, comparison, and human approval

**Files:**

- Create: `scripts/dsd/ipa-candidates.py`
- Create: `scripts/dsd/ipa-candidates.spec.ts`
- Create: `scripts/dsd/ipa-review.ts`
- Create: `scripts/dsd/ipa-review.spec.ts`
- Create: `scripts/dsd/lib/ipa.ts`
- Create: `scripts/dsd/lib/ipa.spec.ts`
- Modify: `package.json`

**Implementation:**

- Run Misaki offline with American English and `fallback=None`.
- Pin Misaki revision and audit its packaged lexicons/data, transitive
  dependencies, notices, and output terms before enabling real runs. If any
  required artifact lacks acceptable provenance, Misaki remains disabled.
- Never install or enable eSpeak fallback in the IPA candidate environment.
- Attempt Microsoft PhoneticMatching as a comparison adapter in an isolated build. If its old native ABI cannot be supported, mark comparison unavailable and require two-person phonetic review; do not introduce an unapproved fallback.
- Normalize delimiters and Unicode but preserve stress marks.
- A human phonetic author independently checks/corrects a candidate, and a
  different human reviewer approves the final IPA. Provenance truthfully links
  every candidate tool that informed the decision; it does not erase tool
  involvement by relabeling copied output as human-only.
- Require `accent=en-US`, priority, author, reviewer, timestamps, review notes, and content hash.

**Commands:**

```text
dsd:ipa:candidates --batch <id> [--write]
dsd:ipa:review --file <json> [--write]
dsd:ipa:audit
```

**Acceptance:**

- Zero approved pronunciation rows use eSpeak, Wiktionary, legacy, or any
  unapproved artifact as a content source. Approved rows may reference an
  approved Misaki/PhoneticMatching candidate event as supporting provenance,
  while the final decision source remains the two-person DSD phonetic review.
- Every approved IPA has distinct author/reviewer identities.
- Homographs, abbreviations, names, and disagreements are forced into manual review.

**Review checkpoint C:** Product owner reviews a 50-headword IPA pilot before scale-up.

---

# Phase D — Approved audio voices and asset provenance

## Task 11: Replace Amy/Ryan with LJSpeech/Norman and lock the TTS stack

**Repositories:** `../tts-service`, this API, and `../english-learning-games`

**Files:**

- Modify: `app/main.py`
- Modify: `app/engines/piper.py`
- Modify: `install_piper.sh`
- Modify: `README.md`
- Modify: `tests/test_engines_piper.py`
- Modify: `tests/test_routes.py`
- Modify: `Dockerfile`
- Create: `models/piper-voices.lock.json`
- Create: `models/piper-runtime.lock.json`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `docs/DSD-VOICE-RIGHTS.md`
- Create: `tests/test_model_lock.py`
- Modify in API: `src/shared/tts/voice-catalog.ts` and its tests
- Modify in web app: English voice labels and tests in `SentenceSetup`,
  `SentenceLearning`, and verbal-mapping setup

**Voice mapping:**

```text
en-aria -> en_US-ljspeech-medium
en-guy  -> en_US-norman-medium
```

The IDs remain for API/local-storage compatibility, but labels become neutral
`DSD Female` / `DSD Male`. No UI, response, notice, or metadata says the output
is Amy, Ryan, LJSpeech, Norman, Aria, Guy, or a real person's live speech.

**Implementation:**

- Pin `rhasspy/piper` release `2023.11.14-2`, its platform-specific binary,
  `piper-phonemize` `2023.11.14-4`, eSpeak/ONNX runtime dependencies, the
  Hugging Face voice repository revision, and every downloaded artifact hash.
- Build one release-eligible Linux TTS container from a base image pinned by
  digest. Record the final image digest and an allowlisted inventory of OS
  packages, Python packages, Piper files, and dynamically linked libraries.
  Release audio may be generated only by this image. macOS/local host output is
  development-only unless it independently reproduces the locked runtime and
  passes the same inventory/hash checks.
- Do not silently upgrade to `OHF-Voice/piper1-gpl`, `piper-tts`, another voice
  repository, or a system eSpeak library. Any upgrade repeats dependency,
  notice, distribution, reproducibility, and rights review.
- Download each ONNX model, config, and `MODEL_CARD`.
- Record and verify SHA-256 before load.
- Fail startup on a missing/unlocked/mismatched artifact.
- Remove Amy/Ryan from defaults, tests, documentation, and installer comments.
- Correct claims that the complete Piper/phonemizer dependency tree or all
  voices are simply MIT. Generate `THIRD_PARTY_NOTICES.md` from the locked
  runtime/model inventory and document server-side-only status.
- Snapshot the Task 1 legal decision for model copyright, training recordings,
  performer/voice/personality rights, release territories, and generated-output
  use in `DSD-VOICE-RIGHTS.md`. A model card's public-domain dataset statement
  is evidence, not sufficient clearance by itself.
- Do not automatically delete existing model files. A separate quarantine task handles them.

**Tests:**

```bash
cd ../tts-service
pytest
```

**Acceptance:**

- Active defaults, mappings, installers, and UI contain zero Amy/Ryan model
  mappings or labels. Explicit blocklist tests, registry entries, notices, and
  historical documentation may retain the names to prove rejection.
- Real-model smoke tests synthesize valid WAV/MP3 for both approved voices.
- Startup fails after intentionally corrupting a copied fixture model hash.
- The runtime lock identifies every shipped/loaded binary and shared library;
  CI fails on an unlisted dependency or changed hash.
- A release-generation command refuses a host runtime or container image digest
  that differs from `piper-runtime.lock.json`.
- Public-release eligibility remains `blocked` until the Task 1 rights evidence
  is approved. Server-side technical tests may run while it is blocked.

---

## Task 12: Create DSD audio asset tables and batch generator

**Files:**

- Create: `src/dsd-corpus/entities/dsd-audio-asset.entity.ts`
- Create: `src/dsd-corpus/migrations/1785629100000-AddDsdAudioAssets.ts`
- Create: `src/dsd-corpus/migrations/1785629100000-AddDsdAudioAssets.spec.ts`
- Create: `scripts/dsd/audio-generate.ts`
- Create: `scripts/dsd/audio-generate.spec.ts`
- Create: `scripts/dsd/audio-review.ts`
- Create: `scripts/dsd/audio-review.spec.ts`
- Create: `scripts/dsd/audio-audit.ts`
- Create: `scripts/dsd/audio-audit.spec.ts`
- Modify: `package.json`

**Asset fields:**

```text
entry_id
input_kind
input_record_id
input_text_sha256
logical_asset_key
public_voice_id
engine_voice
engine_version
model_revision
model_sha256
model_license
training_dataset
training_dataset_status
storage_key
audio_sha256
media_type
format
duration_ms
sample_rate
generated_at
review_status
reviewed_by
reviewed_at
review_notes
generator_actor
```

**Implementation:**

- Generate v1 release audio only from approved DSD headwords. Example/sentence
  audio remains runtime-only and is not part of the corpus release under this
  plan.
- Require the locked LJSpeech or Norman model.
- Require the Task 11 release-eligible container digest; direct calls to an
  unpinned developer TTS service can create test candidates only, never
  reviewable/release assets.
- Derive `logical_asset_key` from canonical input text plus public/engine voice,
  runtime/model/encoder hashes, and generation configuration. Store bytes by
  their output hash under `dsd/audio/<voice>/<audio-sha256>.<format>`.
- Never overwrite an existing object whose hash differs.
- Record generation provenance before making the asset eligible for review.
- Audio QA checks decoding, silence, clipping, duration, sample rate, channel
  count, input mismatch, unexpected metadata, and duplicate anomalies.
- Add `dsd:audio:review` with a protected per-asset listening queue. Every asset
  must be played and receive an individual accept/reject decision from a human
  reviewer. Automated QA and batch sampling cannot populate `reviewed_by`.
- Pin the WAV-to-MP3 encoder/version/options, strip nondeterministic metadata,
  and record encoder hashes/notices. If deterministic MP3 cannot be achieved,
  retain a canonical WAV master and treat MP3 as a derived serving asset.

**Acceptance:**

- The generator refuses Amy/Ryan and any unlocked voice.
- Same canonical input and locked generation stack produce the same logical
  asset key and are expected to produce the same audio hash.
- A different audio byte hash at an existing logical key is quarantined and
  blocks review; it is never overwritten.
- Only assets with passing automated QA, approved voice-rights evidence, and an
  individual human listening decision can be returned or exported.

---

## Task 12A: Provision durable audio storage and recovery

**Files:**

- Create: `scripts/dsd/audio-storage-audit.ts`
- Create: `scripts/dsd/audio-storage-audit.spec.ts`
- Create: `docs/dsd-corpus/AUDIO-STORAGE.md`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**

```text
DSD_AUDIO_S3_URI
DSD_AUDIO_S3_REGION
DSD_AUDIO_KMS_KEY_ID
DSD_AUDIO_PUBLIC_BASE_URL
```

**Implementation:**

- Use a dedicated, versioned, encrypted object-store prefix. The generator has
  create-if-absent permission; the API has read-only serving permission; no
  application role has bucket-policy, lifecycle, or permanent-delete rights.
- Keep storage keys content-addressed. Database metadata and object bytes must
  agree on size and SHA-256 before an asset becomes reviewable.
- Block public bucket listing. Serve only approved hashes through the API/CDN
  path; never construct a response from an unreviewed object-store listing.
- Run a scheduled inventory that detects missing objects, unexpected objects,
  version drift, hash mismatch, blocked voice prefixes, and database/object
  orphans. Quarantine findings; do not auto-delete.
- The signed release package from Task 18 includes canonical audio bytes and is
  the independent recovery source. Document restore from a release package to
  an empty object-store prefix.

**Acceptance:**

- Permission tests prove generator, API, and operator roles have only their
  documented capabilities.
- Deleting or corrupting a test object causes the audit and release gate to
  fail; restore from a signed test package recreates the expected hash.
- No public release depends on the unbacked local Docker `uploads` volume.

---

## Task 13: Inventory and quarantine old audio/model artifacts

**Files:**

- Create: `scripts/dsd/audio-quarantine.ts`
- Create: `scripts/dsd/audio-quarantine.spec.ts`
- Create: `docs/dsd-corpus/AUDIO-QUARANTINE-RUNBOOK.md`

**Implementation:**

- Scan configured cache/object-store prefixes and metadata for Amy/Ryan.
- Dry-run produces a signed manifest with path/key, size, hash, detected voice, and proposed action.
- `--write` moves recoverable files to a non-serving quarantine prefix; it does not permanently delete them.
- Regenerate approved replacements before disabling an old serving key.

**Acceptance:**

- Zero serving assets reference Amy/Ryan.
- Quarantine report records counts and hashes.
- Recovery procedure is documented.

**Review checkpoint D:** Before bulk generation, product owner and audio
reviewer listen to a balanced 100-item sample from each voice. During bulk
production, every release asset still receives individual review under Task 12.

---

# Phase E — API integration and fail-closed commercial mode

## Task 14: Add DSD read repositories and response presenter

**Files:**

- Create: `src/dsd-corpus/dsd-query.service.ts`
- Create: `src/dsd-corpus/dsd-query.service.spec.ts`
- Create: `src/dsd-corpus/dsd-presenter.ts`
- Create: `src/dsd-corpus/dsd-presenter.spec.ts`
- Create: `src/dsd-corpus/dsd-corpus.controller.ts`
- Create: `src/dsd-corpus/dsd-corpus.controller.spec.ts`
- Create: `src/dsd-corpus/migrations/1785629400000-AddDsdServingViews.ts`
- Create: `src/dsd-corpus/migrations/1785629400000-AddDsdServingViews.spec.ts`
- Modify: `src/dsd-corpus/dsd-corpus.module.ts`

**Implementation:**

- Resolve by DSD UUID or normalized headword directly from `dsd_entries`.
- Query owner-defined serving views that expose published senses, approved
  Vietnamese, examples, IPA, and audio only. `dsd_app` receives `SELECT` on
  these views, not draft/provenance/base curation tables.
- Preserve existing public DTO field names where possible, but use DSD UUIDs as content identity.
- Never expose candidates, provenance notes, author identities, compliance scores, or quarantined assets publicly.
- No runtime generation in this service.

**Acceptance:**

- A DSD-only integration fixture renders without a legacy database connection.
- Missing translation/IPA/audio fails the complete-entry query.
- Permission tests prove the API role cannot query drafts, candidates,
  contributor IDs, similarity results, or provenance tables.

---

## Task 15: Route commercial-safe dictionary traffic exclusively to DSD

**Files:**

- Modify: `src/dictionary/dictionary.service.ts`
- Modify: `src/dictionary/dictionary.service.spec.ts`
- Modify: `src/category/category.service.ts`
- Modify: `src/category/category.service.spec.ts`
- Modify: `src/dsd-corpus/dsd-corpus.controller.ts`
- Modify: `src/dsd-corpus/dsd-corpus.controller.spec.ts`
- Modify: `src/config/configuration.ts`
- Modify: `src/app.module.ts`
- Modify: `.env.example`
- Modify: `deploy/compose.yml`

**Implementation:**

- Add `DSD_RELEASE_CHANNEL=off|internal|public` and
  `DSD_ACTIVE_RELEASE_ID`. A missing channel defaults to `off`; unknown values
  fail configuration validation. An active release ID is required for
  `internal`/`public` and ignored for `off`.
- `off`: public dictionary/search returns `404`/empty DSD results while user,
  authentication, and progress features remain available. Legacy/reference
  dictionary access is restricted to an explicitly authenticated internal
  route and is never presented as commercial-safe content.
- `internal`: only authorized DSD reviewers can query the active signed pilot;
  public requests behave as `off`.
- `public`: dictionary lookup/search uses `DsdQueryService` only and requires a
  signed release marked public-eligible by Task 17. The 500-entry pilot release
  ID is structurally ineligible; first eligibility is the signed 5,000-entry
  v1.
- When `COMMERCIAL_SAFE_MODE=true`, no public request can enable or reach the
  legacy/reference route regardless of release channel.
- Legacy repositories, `learner_*`, LLM generation, raw fallback, synonyms, categories, and pronunciations are not queried in commercial mode.
- Until DSD-native categories/relations exist, commercial category endpoints return only configured DSD data or an empty result; never legacy data.
- Non-commercial/reference mode keeps existing behavior.
- Cache keys include corpus/release ID so legacy responses cannot survive the mode switch.
- Activation is a two-step deploy: deploy code with channel `off`/`internal`,
  verify the release signature and smoke tests, then explicitly set `public`.
  A rollback sets the channel to `off`; it never falls back to legacy.

**Tests:**

- Spy assertions prove zero legacy repository calls in commercial mode.
- DSD miss returns `404` even when legacy has the word.
- Generated fallback remains disabled.
- Cache invalidation cannot mix legacy and DSD results.
- `internal` authentication and release-ID eligibility are tested; a pilot ID
  cannot activate `public` even through direct environment manipulation.

**Acceptance:**

```bash
npm test -- --runInBand
npm run build
```

---

## Task 16: Add DSD-native relations and optional learning metadata

**Files:**

- Create: `src/dsd-corpus/entities/dsd-relation.entity.ts`
- Create: `src/dsd-corpus/migrations/1785629200000-AddDsdRelations.ts`
- Create: `src/dsd-corpus/migrations/1785629200000-AddDsdRelations.spec.ts`
- Create: `scripts/dsd/relations.ts`
- Create: `scripts/dsd/relations.spec.ts`
- Modify: `src/dsd-corpus/dsd-query.service.ts`

**Policy:**

- Relations are DSD-authored factual assertions; do not import WordNet/Wiktionary relation sets.
- CEFR is omitted unless DSD adopts and documents an internal rubric.
- DSD priority/band is a product ordering value, not CEFR or external frequency rank.
- Every relation is reviewed and links two DSD UUIDs.

**Acceptance:**

- No relation references a missing or legacy word.
- Commercial responses contain only approved DSD relations.

---

# Phase F — Commercial audit, reproducible export, and release package

## Task 17: Implement the DSD release audit

**Files:**

- Create: `src/dsd-corpus/release/dsd-release-audit.ts`
- Create: `src/dsd-corpus/release/dsd-release-audit.spec.ts`
- Create: `scripts/dsd/release-audit.ts`
- Modify: `package.json`

**Commands:**

```text
dsd:release:audit --release <id> --channel internal|public --territories <file>
dsd:release:audit:prod --release <id> --channel internal|public --territories <file>
```

**Audit blockers:**

- No published entries.
- Any unknown/unapproved/blocked source or tool.
- Any legacy ID/source reference.
- Missing author/reviewer/hash/provenance event.
- Same author and reviewer.
- Missing approved Vietnamese or bilingual example.
- Missing approved en-US IPA.
- Missing either LJSpeech or Norman audio.
- Audio missing automated-QA proof, individual human listening decision, object
  hash, or approved voice-rights evidence.
- Amy/Ryan/Lessac evidence in a serving asset.
- Exact, unresolved, stale, or superseded-policy similarity result.
- Critical quality finding.
- Mutable or mismatched model/tool artifact.
- Generated candidate exposed as final content.
- Missing/invalid contributor-rights evidence, clean-room declaration, rights
  matrix approval, release-territory approval, or required legal sign-off.
- Missing/corrupt audio object or database/object hash mismatch.
- Latest verified two-database backup/restore proof is older than
  `DSD_RESTORE_MAX_AGE_HOURS`, lacks exact off-host version evidence for either
  database, or does not cover the release database migration version.
- Release ID/channel policy violation, including any attempt to mark the
  500-entry pilot public.
- Unknown configured signer key ID or missing/revoked public-key registry entry.

**Acceptance:**

- Synthetic clean corpus returns `GO`.
- One fixture for every blocker returns `NO-GO` and a specific reason.
- `GO` records the exact database snapshot, registry/tool/policy hashes,
  backup-proof ID, rights/sign-off evidence IDs, target territories, active
  signer key ID, and audit implementation version.

---

## Task 18: Build deterministic DSD export artifacts

**Files:**

- Create: `scripts/dsd/export.ts`
- Create: `scripts/dsd/export.spec.ts`
- Create: `scripts/dsd/verify-release.ts`
- Create: `scripts/dsd/verify-release.spec.ts`
- Create: `data/dsd/release-public-keys.json`
- Create: `src/dsd-corpus/entities/dsd-release-build.entity.ts`
- Create: `src/dsd-corpus/migrations/1785629300000-AddDsdReleaseBuilds.ts`
- Create: `src/dsd-corpus/migrations/1785629300000-AddDsdReleaseBuilds.spec.ts`
- Modify: `package.json`

**Commands:**

```text
dsd:export --release <id> --channel internal|public --territories <file>
dsd:release:verify --dir <release-directory>
```

**Output:**

```text
dist/dsd-corpus/<release-id>/
  dsd-corpus.sqlite
  00_manifest.json
  01_entries.csv
  02_senses.csv
  03_translations.csv
  04_examples.csv
  05_pronunciations.csv
  06_relations.csv
  07_audio-manifest.csv
  audio/
    <voice>/<audio-sha256>.<format>
  PROVENANCE.jsonl
  SOURCE-REGISTRY.json
  TOOL-REGISTRY.json
  DATA-PROVENANCE.md
  THIRD-PARTY-NOTICES.md
  DATA-LICENSE.md
  RELEASE-PUBLIC-KEY.pem
  00_manifest.sig
  checksums.sha256
```

**Implementation:**

- Run release audit before opening the output directory.
- Use a repeatable-read, read-only transaction and deterministic ordering.
- Require explicit release ID and `SOURCE_DATE_EPOCH`.
- Do not include candidate, rejected, draft, direct contributor PII, external
  evidence-store locations, or legacy data. `PROVENANCE.jsonl` uses a reviewed
  export schema with release-scoped contributor references sufficient to prove
  separation of duties without publishing the internal identity mapping; legal
  and privacy reviewers approve that schema for the target territories.
- Write output to a new directory and refuse overwrite.
- Copy every approved canonical audio byte referenced by the manifest, verify
  its object hash while streaming, and fail on missing/unexpected bytes.
- Build SQLite under the repository-pinned Node version installed by `npm ci`.
  Run an explicit `better-sqlite3` load smoke test before export so a native ABI
  mismatch fails early instead of producing a partial package.
- `THIRD-PARTY-NOTICES.md` covers software/tools/models and states whether each
  notice applies to tooling only or to a distributed artifact; it must not
  imply that third parties license DSD-authored text.
- `DATA-LICENSE.md` contains the counsel-approved DSD data terms and territory
  scope. It makes no exclusive claim over English words, bare linguistic facts,
  or public-domain material.
- Put the hashes of every content/data/audio artifact in `00_manifest.json`.
  Generate `checksums.sha256` as a convenience index from that manifest; neither
  the detached signature nor checksum index is recursively listed as a content
  artifact. Sign the canonical bytes of `00_manifest.json` with an Ed25519
  release key using Node's built-in `crypto` API; keep the private key in the
  release secret store, publish only the public key/key ID, and document
  rotation/revocation.
- The bundled public key is informational, not a trust root. Offline
  verification trusts the reviewed `data/dsd/release-public-keys.json` from a
  clean checkout and requires the bundled key/key ID to match it.
- Store the manifest hash, signature, signer key ID, source snapshot, policy
  hashes, release eligibility, exact canonical manifest bytes, and exact
  membership of every exported entry, sense, translation, example,
  pronunciation, relation, and audio asset in immutable release tables.
- Export corpus rows under a repeatable-read, read-only transaction. After the
  package and detached signature verify, append the release-build record in a
  separate short write transaction; never make the export transaction writable.
- The API reads through release-membership views for every record kind. Startup
  recomputes the manifest hash, verifies the Ed25519 signature against the
  reviewed public-key registry, checks manifest/channel/count metadata, and
  refuses an incomplete or untrusted active release. Search and detail queries
  are bound to the same signed membership; later-published rows cannot drift
  into an older release.

**Acceptance:**

- Two exports from the same database snapshot and source epoch are byte-identical.
- Export contains only DSD UUIDs and approved records.
- Manifest verification detects any changed byte.
- Signature verification works offline from a clean checkout and fails for a
  changed manifest, audio file, revoked key, or unknown key ID.
- Runtime activation fails for missing child membership, changed manifest
  bytes/signature, an untrusted signer, or release metadata mismatch.
- A clean `npm ci` on the CI Node version loads `better-sqlite3` and creates the
  deterministic SQLite artifact without skipped tests.

**Review checkpoint F:** Product owner and legal reviewer inspect the pilot release package before any public deployment.

---

# Phase G — Pilot content production

## Task 19: Produce and approve the independent 500-headword inventory

**Deliverables:**

- Create: `data/dsd/inventory/dsd-pilot-500.csv`
- Create: `docs/dsd-corpus/evidence/DSD-INVENTORY-500.md`

**Process:**

- Confirm Task 2B has an approved measurement protocol. Inventory may proceed
  without a committed second reviewer, but Task 20 remains blocked until the
  reviewer and contributor-rights evidence exist.
- Product/learning team creates the list from DSD product goals without viewing a legacy export.
- Record rationale, pseudonymous author ID, clean-room declaration ID, evidence
  ID, approval, and inventory-stage time under the measurement protocol.
- Validate and dry-run import.
- Product owner reviews the complete list before `--write`.

**Acceptance:**

- Exactly 500 unique normalized headwords.
- Zero legacy/source dictionary positions or content fields.
- Inventory evidence is approved.
- The batch contains no blocked-source or legacy identifiers/digests and its
  clean-room declaration resolves to an eligible contributor.

---

## Task 20: Author and review pilot definitions, translations, and examples

**Deliverables:**

- `data/dsd/curation/pilot-500/batch-*.json`
- Review decision packages in the protected review workflow.
- Batch manifests and provenance events.

**Process:**

- Prerequisites: Task 2B has eligible author/reviewer identities and Task 8A's
  v1 similarity policy is frozen and approved.
- Work in batches of at most 50 headwords.
- Author from blank templates in the Task 1 clean-room environment. Authors do
  not receive legacy text, similarity matches, existing dictionary wording, or
  machine-generated definitions/translations/examples.
- Review English, Vietnamese, and examples independently.
- Record authoring/review/rework time and reason codes under the pilot protocol.
- Run quality audits on all DSD content and legacy similarity audits on the
  English definitions/examples after each batch. The audit reader cannot access
  legacy Vietnamese; Vietnamese originality relies on the clean-room control,
  authorship evidence, human review, and legal spot review.
- Stop a batch on any unresolved high-similarity or provenance issue.

**Acceptance:**

- 500 entries have at least one approved sense.
- Every published sense has approved Vietnamese and an approved bilingual example.
- Zero critical quality, exact, unresolved/stale similarity, provenance, rights,
  or clean-room blockers.
- Every manual similarity clearance is current for the content/policy hash and
  contains an allowed reason and compliance-review evidence.

---

## Task 21: Produce and review pilot IPA and audio

**Process:**

- Generate IPA candidates after textual content is approved.
- Human-author and approve en-US IPA.
- Generate both LJSpeech and Norman audio.
- Run automated QA on all 1,000 assets and individually listen to all 1,000;
  rejected assets are regenerated or the entry remains incomplete. The
  checkpoint samples below are additional product review, not approval of the
  remaining assets.
- Record all hashes and model revisions.
- Record IPA author/reviewer time, audio generation/review time, rejection
  reason, and rework under the pilot measurement protocol.

**Acceptance:**

- 500 entries have approved en-US IPA.
- 1,000 approved headword audio assets: 500 LJSpeech and 500 Norman.
- Zero Amy/Ryan assets.
- All 1,000 assets have passing automated QA, current rights evidence, and an
  individual human listening decision.
- Product owner signs the 50-headword IPA and 100-per-voice listening checkpoints.

---

## Task 22: Execute the pilot release drill

**Run:**

```bash
npm run dsd:quality:audit
npm run dsd:ipa:audit
npm run dsd:audio:audit
npm run dsd:release:audit -- --release dsd-pilot-0.1 --channel internal --territories <approved-file>
SOURCE_DATE_EPOCH=<approved-epoch> npm run dsd:export -- --release dsd-pilot-0.1 --channel internal --territories <approved-file>
npm run dsd:release:verify -- --dir dist/dsd-corpus/dsd-pilot-0.1
npm test -- --runInBand
npm run test:scripts -- --runInBand
npm run build
cd ../tts-service && pytest
```

**Deliverables:**

- Release package.
- Audit report.
- Similarity report summary.
- Audio QA report.
- Known-issues register.
- Product-owner, linguistic, data, and legal sign-off records.

**Acceptance:**

- Release audit prints `GO`.
- Commercial-safe dictionary tests pass while every legacy dictionary repository is configured to throw on access. The main application database may remain available for users and progress data.
- Release package checksum verification passes.
- Manifest signature verifies offline, database restore proof is current, and
  all audio bytes can be restored to an empty test prefix.
- `DSD_RELEASE_CHANNEL=internal` allows only authorized reviewers to query the
  pilot; `DSD_RELEASE_CHANNEL=public` rejects `dsd-pilot-0.1`.
- Pilot metrics re-derive the 5,000/20,000 staffing and calendar estimates
  before v1 scheduling.

---

# Phase H — Scale to commercial v1 and extended corpus

## Task 23: Scale from 500 to 5,000 headwords

- Freeze tooling changes during each content batch.
- Work in batches of at most 100 headwords.
- Run all per-batch gates used in the pilot.
- Sample at least 10% for secondary linguistic QA; all automated failures receive full review.
- Publish only complete entries; incomplete entries remain non-serving.
- Create `DSD Corpus v1.0` only after the full release audit, current backup
  restore, rights/territory clearance, signature verification, and sign-offs.
- Keep the public channel `off` while v1 is built. Activate `public` only after
  the signed v1 smoke test succeeds in `internal`; rollback always returns to
  `off`, never legacy.

**Acceptance:**

- 5,000 complete entries.
- 10,000 approved headword audio assets.
- Zero release blockers.
- Reproducible v1.0 export.
- Every v1 contributor and voice has current rights evidence for all target
  territories, and the signed release is the exact `DSD_ACTIVE_RELEASE_ID`.

---

## Task 24: Extend from 5,000 to 20,000 headwords

- Prioritize from DSD product demand and search analytics that DSD is permitted to use.
- Do not loosen review or provenance requirements for throughput.
- Version registry/tool changes separately from content batches.
- Re-run legal review whenever a new source, tool, model, or contractor class is introduced.
- Release incremental signed manifests rather than mutating v1.0.
- Recalibrate and version the similarity policy when measured pilot/production
  data shows a material drift; re-audit affected records before release.

**Acceptance:**

- 20,000 complete entries under the same gates.
- Each release remains independently reproducible and auditable.

---

## Test matrix

| Layer | Required verification |
| --- | --- |
| Registry | Schema, aliases, scopes, approval evidence, blocked-source fixtures |
| Rights/governance | Pseudonymous register, contributor-evidence eligibility, rights matrix, territory/sign-off blockers |
| Database | Migrations up/down in rehearsal, constraints, scoped roles, serving views, no legacy FKs/IDs |
| Operations | Two-database backup, snapshot manifest, remote encrypted copy, guarded restore, split-migration runbook |
| Inventory | Normalization, clean-room evidence, duplicate detection, prohibited fields, idempotency |
| Curation | JSON schema, hashes, contributor eligibility, transaction rollback, no auto-approval |
| Review | State machine, stale hash, self-review, append-only events |
| Quality | English/Vietnamese/markup/CJK/duplicate/encoding fixtures |
| Similarity | Labeled calibration targets, policy/hash invalidation, narrow legacy view, no wording/ID copy |
| IPA | Locked tools, no fallback, Unicode/stress, candidate/final separation |
| Audio | Locked runtime/voices, rights evidence, per-asset listening, object-store integrity/recovery, blocked voices |
| API | Serving-view permissions, DSD-only commercial mode, release-channel eligibility, 404 on miss, cache separation |
| Release | One test per blocker, native SQLite smoke test, deterministic export, audio bytes, offline signature/checksum verification |

---

## Explicit non-goals for DSD v1

- Rebuilding all 475,153 legacy headwords.
- Recovering or backfilling legacy provenance.
- Cleaning legacy content further for commercial publication.
- Importing OEWN, NGSL, Wiktionary, CMUdict, or the `tudien` archive into DSD.
- Automatically generating publishable content with an LLM.
- British IPA/audio in the first release.
- Bundling or distributing Piper/eSpeak binaries, libraries, models, installers,
  containers, or the TTS service in any customer client/package.
- Publishing the 500-headword pilot or presenting it as a complete dictionary.
- Treating a public-domain recording label as blanket clearance of performer,
  personality, voice-synthesis, biometric, or worldwide-territory rights.
- Guaranteeing that legal review is unnecessary; the plan creates evidence and
  release gates but does not replace counsel.
- Claiming exclusive ownership of English words, linguistic facts, or public-domain source material.

---

## Definition of done

The implementation is complete when:

- `dsd_corpus_db` can be built from empty with DSD migrations only.
- Scoped production roles pass their allowlist/denylist tests; no normal service
  authenticates as database owner.
- Both production databases have snapshot-bound, encrypted off-host backups and
  a current successful restore proof before migration/release.
- Commercial-safe dictionary lookup operates while access to all legacy dictionary repositories is denied.
- DSD authoring/import/review tools cannot read legacy content.
- The compliance-only audit has a documented, read-only exception.
- The frozen similarity policy meets its benchmark targets, manual clearances
  are current/hash-bound, and no legacy text or row ID is persisted in DSD.
- The pilot and v1 release gates enforce authorship, independent review, provenance, similarity clearance, IPA approval, and both audio voices.
- Amy, Ryan, Lessac, OEWN, NGSL, Wiktionary, `tudien`, and legacy content are absent from serving/exported DSD data.
- LJSpeech and Norman artifacts are pinned and verified.
- Every release audio asset has automated QA, individual human listening
  approval, current rights evidence, and a verified object/package hash.
- The public channel cannot activate a pilot or unsigned/ineligible release and
  never falls back to legacy on rollback.
- A release can be reproduced byte-for-byte, includes canonical audio bytes,
  and verifies offline with SHA-256 plus its Ed25519 signature.
- The final package has contributor-rights, clean-room, territory, voice/model,
  product-owner, linguistic, data, and legal sign-off evidence.
