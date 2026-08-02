# Commercial release checklist

The automated result is authoritative for technical release gating:

```sh
COMMERCIAL_SAFE_MODE=true \
COMMERCIAL_ALLOW_GENERATED_CONTENT=false \
npm run commercial:audit
```

Deploy or export data only when the command prints `Commercial release audit:
GO` and exits zero.

## One-time legal and ownership evidence

- Counsel has reviewed the intended API, application, export and jurisdiction.
- Every approved source is listed as `commercial_status: approved` in
  `data/commercial-source-registry.json`.
- Signed author/contractor IP assignments exist for original bilingual content;
  only agreement IDs and batch digests are recorded in
  `docs/commercial-content-authorship.md`.
- The product has a public link to `/serious/dictionary/attribution`.
- Privacy/provider review is complete before generated content is enabled.

## Every release

- Production uses `COMMERCIAL_SAFE_MODE=true`.
- Production uses `COMMERCIAL_ALLOW_GENERATED_CONTENT=false` unless separately
  approved.
- All migrations are applied.
- Full tests and build pass.
- `npm run commercial:audit` returns `GO`.
- Any distributed data was generated only by `npm run commercial:export`.
- The commercial export contains `DATA-LICENSES.md`, the source registry,
  third-party notices, the OEWN licence and the Princeton WordNet licence.
- The legacy full-corpus export is not shipped, sold, or exposed publicly.

## Current status on 2026-08-02

`NO-GO`: there are zero published learner entries. The legacy corpus is sealed
from commercial runtime paths, but commercially approved content must still be
authored/reviewed and imported into the learner overlay.
