# NGSL 1.2 source pipeline

This project uses the New General Service List (NGSL) 1.2 to prioritize core-vocabulary review. NGSL rank is a learning-frequency priority, not a CEFR level.

## Official inputs

- Source page: <https://www.newgeneralservicelist.com/new-general-service-list>
- Ranked core: <https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv>
- Unranked supplement: <https://www.newgeneralservicelist.com/s/SUP_lemmatized.csv>

The official page describes NGSL 1.2 as 2,809 ranked words. Its separate supplementary file contains 52 days, months, and number words that belong to NGSL but have no frequency rank.

## Reproducible workflow

No command contacts the source server unless `--write` is explicit:

```sh
npm run ngsl:fetch -- --write
npm run ngsl:validate
```

`ngsl:fetch` downloads both official files into the ignored, version-specific directory `data/learner-core/vendor/ngsl/1.2/`. Existing raw bytes in that path are immutable: if upstream changes either file, the command fails instead of overwriting it. Review the change and introduce a new version/path deliberately.

The fetch command validates both files before writing derived data. It then creates:

- `ngsl-source-lock.json`, recording each requested and effective URL, retrieval time in UTC, SHA-256, byte size, validation facts, license, and attribution.
- `ngsl-candidates.csv`, the authoritative 2,859-row curation table with explicit priority order, normalized word, nullable learner rank, source memberships, original source lemmas, and fixed rank source/version/URL/license fields.
- `candidate-words.txt`, a compatibility projection containing the same normalized words in the same order for queue tools that need only headwords.

Never infer `learner_rank` from a line number or `priority_order`. Read it from the CSV column. Ranked-core rows carry their explicit SFI rank; supplement-only rows have an empty CSV value, parsed as `null`.

All 2,861 source rows and their original casing remain unchanged in the checksum-locked raw files. Exact source lemmas are unique and the two source files are exactly disjoint. Curation headwords are separately normalized with Unicode NFC, trimmed, and lowercased using the English locale, then deduplicated case-insensitively.

The official supplement contains the proper names `March` and `May`, while the ranked core contains the lowercase homographs `march` and `may`. The CSV and lock record these two deliberate merges, their original source lemmas, and both source memberships. The normalized candidate keeps its ranked-core priority, while its supplementary membership has `null` rank. Any different case-fold collision fails validation until it is reviewed and explicitly acknowledged in code. The supplement's source rank `0` always means “unranked”; it must never sort ahead of rank 1 or be treated as a CEFR label.

`ngsl:validate` is offline. It revalidates the exact source and candidate-table headers, row counts, priority continuity, explicit nullable ranks, fixed provenance fields, exact lemma uniqueness and disjointness, acknowledged case-fold collisions, rank continuity, raw checksums, and both derived files against the lock.

## NGSL Graded Reader status

NGSL-GR is not part of this pipeline yet. Its downloadable header and row semantics remain pending manual verification. Do not guess its schema, download it through this script, or use its bands until a human has inspected the official artifact and recorded its version, license, immutable bytes, checksum, and exact validation rules.
