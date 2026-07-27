# Open English WordNet 2025 source pipeline

This project uses the **core Open English WordNet (OEWN) 2025 Edition** as licensed source evidence for stable English senses, definitions, and examples. It does not use the separate **2025+ Edition**. The core edition contains common nouns, verbs, adjectives, and adverbs; OEWN 2025+ additionally contains a curated proper-noun section from Open English Namenet.

OEWN is a general lexical network, not a learner dictionary. Its source records are inputs to human curation and are never sufficient by themselves to publish a bilingual learner sense.

## Pinned official release

| Field | Pinned value |
| --- | --- |
| Release | Open English Wordnet 2025 |
| Published | 2025-12-31T07:29:46Z |
| Release page | <https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition> |
| Git tag | `2025-edition` |
| Git commit | `dc343f2683279ecbb13fab4e2fd778d7b162d287` |
| Artifact | `english-wordnet-2025.xml.gz` (core 2025 GWA XML) |
| Acquisition URL | <https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz> |
| Publisher alias | <https://en-word.net/static/english-wordnet-2025.xml.gz> |
| Compressed size | `11,363,503` bytes |
| SHA-256 | `9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe` |
| XML format | Global WordNet Association WN-LMF 1.3 |

The format version is not inferred from the filename: the decompressed XML declares `WN-LMF-1.3.dtd` in its `DOCTYPE`, and the lexicon element identifies version `2025`. The byte size, gzip integrity, and SHA-256 above were verified from a complete download on 2026-07-20. Because the official URL is versioned but not content-addressed, the local lock and checksum—not the URL alone—define the accepted artifact.

## License and attribution

OEWN's tagged license states that the resource is derived from Princeton WordNet under the WordNet License and further developed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/). Redistribution and adapted data must preserve attribution to **both Princeton WordNet and the Open English WordNet team** and comply with both applicable notices.

Exact copies from the immutable `2025-edition` tag are retained here:

- [OEWN and CC BY 4.0 license](./licenses/oewn-2025/LICENSE.md)
- [Princeton WordNet database license](./licenses/oewn-2025/WNDB_License.txt)

Canonical tagged files:

- <https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md>
- <https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt>

Both bundled files are byte-for-byte copies of that tag. The upstream `WNDB_License.txt` still names “Open English Wordnet 2023” in its own copyright line; this project preserves the official tagged text verbatim instead of silently correcting it.

When derived content is shown or redistributed, keep the source name, version, source URL, license identifier, and modification notice with it. Do not imply endorsement by Princeton University or the OEWN team.

## Reproducible workflow

The intended commands are:

```sh
npm run oewn:fetch -- --write --limit 100
npm run oewn:validate -- --limit 100
npm run oewn:candidates -- --limit 100
```

- `oewn:fetch -- --write --limit 100` retrieves the official core XML gzip, verifies its pinned size, SHA-256, gzip integrity, WN-LMF declaration, lexicon identity, and license metadata, then stores the immutable raw bytes under the version-specific vendor directory and prepares the requested candidate scope. The explicit `--write` guard is required. A byte change must fail closed; it must not silently overwrite the pinned 2025 source.
- `oewn:validate -- --limit 100` performs the same source and provenance checks offline against the local raw artifact and lock record, then verifies the requested candidate scope.
- `oewn:candidates -- --limit 100` joins the first 100 prioritized NGSL headwords to OEWN lemmas and exports source sense candidates for review. It must preserve OEWN sense and synset identifiers, source order, part of speech, definitions, examples, and ambiguity or no-match flags. It must not silently choose a learner sense or fabricate missing fields.

The fetch step is the only intended network operation. Validation and candidate generation must operate on the checksum-locked local artifact.

The first locked batch is represented by `oewn-ngsl-first-100-candidates.json`, `oewn-ngsl-first-100-headwords.csv`, and `oewn-ngsl-first-100-senses.csv`; `oewn-source-lock.json` binds those derived bytes to the OEWN and NGSL source checksums. These are review artifacts, not curation-import records.

The locked first-100 result contains 100 headword rows, 72 headwords with one or more exact case-sensitive OEWN lexical entries, 28 without an exact entry, 152 exact lexical entries, and 863 unreviewed source senses. Sixty-four exact-entry rows have multiple source-sense candidates (63 ordinary matches plus the merged `may`/`May` row). Thirteen rows also have case-fold-only entries; these are diagnostic and never candidates unless the exact source casing independently matches.

These are spelling-coverage counts, not semantic-coverage counts. Several exact matches are demonstrably the wrong meaning for the NGSL function word: `a` is the letter, `he` is a Hebrew letter, `at` is a Lao unit, and `I` contains iodine/number/letter senses. The uppercase-only entries for `it`, `or`, and `who` are acronyms and are excluded. NGSL's merged `may`/`May` row yields a plant and a month, not the modal verb. This is why every headword has `semantic_alignment_status=unreviewed` and every sense requires human selection.

## Draft-only boundary

Every automatically extracted OEWN record remains **draft source evidence**:

- OEWN ordering is not accepted as learner-frequency or sense-frequency order.
- A headword can map to multiple lemmas, parts of speech, and senses. Export all relevant matches and flag ambiguity for a reviewer; do not automatically publish a “first” sense.
- OEWN definitions and examples may be retained with provenance for review, but they are not automatically short, simple, current, culturally suitable, or appropriate for an English learner.
- OEWN does not supply the project's Vietnamese meanings, Vietnamese example translations, CEFR decisions, or pronunciation review. Those fields must never be invented or inferred from this source.
- Machine transformations may normalize transport and representation only. They do not constitute linguistic approval.
- Candidate generation must not set `approved` or `published`, invent a reviewer, create a review timestamp, or make content learner-visible.

Before publication, a human bilingual reviewer must verify the exact headword, part of speech, OEWN sense/synset identity, intended learner sense, English wording, natural Vietnamese meaning, and bilingual examples. CEFR and pronunciation require their own cited evidence and review. Only the normal curation workflow may promote that reviewed content into the learner overlay.

## Attribution template

Use a notice equivalent to:

> English lexical sense data is derived from Open English WordNet 2025 by the Open English WordNet team, licensed under CC BY 4.0, and incorporates Princeton WordNet data under the Princeton WordNet license. This project may modify the representation and learner-facing wording.

Keep the full bundled license texts available wherever the derived dataset is distributed.
