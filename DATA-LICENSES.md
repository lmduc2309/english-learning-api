# Data licences and commercial distribution boundary

The MIT licence in `README.md` applies to project software only. It does not
relicense dictionary data.

## Commercially approved sources

- Open English WordNet 2025: CC BY 4.0. Preserve attribution, the source URL,
  the `2025` version, and the pinned artifact digest recorded in
  `data/learner-core/oewn-source-lock.json`. The artifact also carries the
  bundled Princeton WordNet notice.
- New General Service List 1.2 ranking: CC BY-SA 4.0. Preserve attribution,
  modification notices, source URL and share-alike terms recorded in
  `data/learner-core/NOTICE.md`.
- Original or commissioned DSD English bilingual content: commercial use is
  allowed only after a signed authorship/IP-assignment agreement is recorded
  as described in `docs/commercial-content-authorship.md`.

The machine-readable allowlist is `data/commercial-source-registry.json`.

## Prohibited commercial sources

The legacy `definitions`, `examples`, `pronunciations`, `word_forms` and
`synonyms` tables have incomplete or absent row-level provenance. They may not
be exposed by a commercial build or included in a commercial export. This
includes content derived from or potentially mixed with Wiktionary, `tudien`,
Cambridge, Lạc Việt, VNEDICT, Free Dictionary API, third-party audio, or prior
machine-translation passes.

Deleting the source files or removing attribution does not clear derived data.
Only the published learner overlay may cross the commercial boundary.

## Required notices

Every distributed commercial dataset must include this file, the source
registry, `data/learner-core/NOTICE.md`, the OEWN licence, and the Princeton
WordNet database licence. Product UI/API documentation must provide a durable
link to the same attribution material.

Operational release requirements are in
`docs/commercial-release-checklist.md`.
