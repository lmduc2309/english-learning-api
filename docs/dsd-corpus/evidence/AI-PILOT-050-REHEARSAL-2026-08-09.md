# AI Pilot 050 — Local Rehearsal Evidence

- Batch: `DSD-AI-PILOT-050-B001`
- Databases: `dsd_corpus_ai_rehearsal` and
  `dsd_corpus_ai_final_rehearsal` (local, isolated from the legacy database)
- Rehearsal date: `2026-08-09`
- Release state: draft only; not approved and not published

The rehearsal created a fresh empty DSD database, ran all nine DSD migrations,
imported the explicit 50-entry inventory, and imported the AI curation package.
No legacy row or identifier was imported.

## Final result

| Object | Count |
| --- | ---: |
| entries | 50 |
| senses | 50 |
| Vietnamese translations | 50 |
| bilingual examples | 50 |
| provenance events | 350 |

The provenance split was:

| Event | Actor | Tool | Count |
| --- | --- | --- | ---: |
| `generated` | `DSD-G-001` | `openai-codex-text-generation` | 150 |
| `imported` | `DSD-G-001` | — | 150 |
| `imported` | `DSD-O-001` | — | 50 |

All 150 generated events carried the inventory input SHA-256
`02a9fbfca3112a7178ea8e379266ec910e46c2110cf0cd5179dd07c94572552e`;
the bad-or-missing-input-hash count was zero.

The first rehearsal exposed six entries needing clearer learner wording
(`begin`, `give`, `pay`, `remember`, `share`, and `take`); the committed package
was regenerated. The final package SHA-256 is
`f7daf9ee5641b544666d1152f720fb2dd00cef9963e3fe1daa0825c60fc77d9c`.

A second empty database then repeated all nine migrations and both imports with
the final package. The final deterministic audit reported 50 definitions, 50
translations, 50 examples and no findings. Its 150 generated provenance events
all carried the expected input hash, tool ID and output-rights evidence; the
mismatch count was zero.

This local rehearsal is pipeline evidence, not human approval evidence. The
records remain drafts until the owner reads and decides their exact hashes.
