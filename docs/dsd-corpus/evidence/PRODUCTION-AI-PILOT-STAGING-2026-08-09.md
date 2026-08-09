# Production AI Pilot Staging — 2026-08-09

## Scope

This record covers the first 50-entry AI-generated DSD text batch. It records a
production **staging** operation, not a public release and not human approval.
The operation provisioned the separate `dsd_corpus_db`, ran the DSD migrations,
and imported drafts while `DSD_RELEASE_CHANNEL=off`.

No long-running service was rebuilt or restarted. The production API repository
remained on `main` at `9d33565df04e44f9a6aee1778d0887d242d6756a`.

## Required pre-import backup

- Database: `english_learning_db`
- Created: `2026-08-09T05:37:02Z`
- File: `/var/www/sites/dsd-english/backups/manual-pre-import/english_learning_db-20260809T053702Z.dump`
- Bytes: `123227992`
- SHA-256: `b3a9ef918a4ef0b58e52154335d65dcfc83dcea07bf986363e94c1cd7919a895`
- Workflow: <https://github.com/lmduc2309/english-learning-api/actions/runs/31297067293>

The staging workflow refused to run unless this exact dump existed and matched
the pinned digest.

## Import evidence

- Content commit: `bfc1e5a` (`feat: add clean-room AI corpus pilot`)
- Final operations commit: `a3363dc58a4c46d145eb61d3513c23117a7bb48d`
- Initial successful staging run:
  <https://github.com/lmduc2309/english-learning-api/actions/runs/31298716968>
- Idempotent verification run:
  <https://github.com/lmduc2309/english-learning-api/actions/runs/31299010650>

The first run applied all nine DSD migrations and inserted the inventory and
content. The second run reported no migrations, 50 unchanged inventory rows,
50 unchanged senses, zero inserts and zero updates. This proves that rerunning
the same signed input did not duplicate content or provenance events.

| Production object | Count |
| --- | ---: |
| entries | 50 |
| senses | 50 |
| Vietnamese translations | 50 |
| bilingual examples | 50 |
| `generated` provenance events | 150 |

The quality audit reported no findings. The count of generated events with a
missing/wrong inventory input hash, tool ID or output-rights evidence was zero.
All text records remain `draft`; nothing is approved or published.

## Verified post-import backup

- Database: `dsd_corpus_db`
- File: `/var/www/sites/dsd-english/backups/manual-pre-import/dsd_corpus_db-20260809T063221Z.dump`
- SHA-256: `423cba6160204f132239cd93bb1f431dc611c064ab242559bd4d724fce26a268`

`pg_restore --list` successfully read the custom-format archive before it was
renamed from its partial path and checksummed.

## Final read-only preflight

Workflow: <https://github.com/lmduc2309/english-learning-api/actions/runs/31299133647>

Confirmed:

- production API worktree clean;
- `dsd_corpus_db` present;
- every DSD, similarity-reader and backup role present;
- all eight scoped database URLs configured;
- `COMMERCIAL_SAFE_MODE=true`;
- legacy pre-import backup still verifies.

The preflight remains `NO-GO` for a full deployment/public release with exactly
four infrastructure blockers: `DSD_BACKUP_S3_URI`, `DSD_BACKUP_KMS_KEY_ID`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. This same-host staging dump is
valid change-window protection but does not satisfy the off-host disaster-
recovery gate.

Content gates also remain: the human owner has not recorded per-record review
decisions, the 500-entry pilot is incomplete, and IPA/audio/release artifacts
have not been produced. Therefore this evidence must not be read as commercial
release approval.
