# Legacy corpus aggregate count — 2026-08-09

This evidence fixes the scalar size target for the independent DSD corpus. It
does not export a legacy headword, row identifier, definition, translation,
example, pronunciation, ordering, or frequency signal.

## Production observation

- Observed at: `2026-08-09T06:54:18Z`
- Workflow commit: `a7a8a8e96af67af26d10be1582d5413a453ae15c`
- Workflow run:
  `https://github.com/lmduc2309/english-learning-api/actions/runs/31299912350`
- Operation: `legacy-counts-only`
- Access mode: read-only aggregate SQL executed inside the production
  PostgreSQL container; only metric names and integer counts were printed.

## Results

| Metric | Count |
| --- | ---: |
| All legacy word rows | 475,153 |
| English word rows | 475,153 |
| Unique stored normalized English headwords | 475,153 |
| Duplicate normalized rows | 0 |
| Duplicate normalized groups | 0 |
| Empty/null normalized headwords | 0 |
| English words with at least one definition | 475,153 |
| English words with at least one pronunciation | 69,768 |
| English words with both definition and pronunciation | 69,768 |

## DSD target decision

The parity target is exactly **475,153 unique normalized English DSD entries**.
The legacy count is used only as a scalar stopping condition. It does not
authorize copying the legacy inventory, selecting the same words, preserving
legacy order, or exposing legacy content to an AI generation process.

The target is met only when the DSD database contains 475,153 distinct active
`(language = 'en', headword_normalized)` entries. Draft child content, rejected
or quarantined candidates, superseded entries, duplicate candidates, and empty
headwords do not count.
