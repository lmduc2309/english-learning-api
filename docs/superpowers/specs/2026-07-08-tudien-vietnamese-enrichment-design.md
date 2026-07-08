# tudien Vietnamese Enrichment — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Project:** english-learning-api (dictionary data-build pipeline)

## 1. Purpose

Enrich the dictionary database's Vietnamese content using the **tudien** StarDict English→Vietnamese dataset (human-curated, ~235k entries, higher quality than the current machine translations). A standalone pipeline script reads the tudien StarDict files and, for words that already exist in the `words` table, writes tudien's Vietnamese meanings into `definitions.definition_vi` and Vietnamese example translations into `examples.example_vi`.

The script is a new source in the existing data-build pipeline; no backend/runtime code changes.

## 2. Source data

- **Origin:** `redphx/tudien` GitHub release `v20260411`, asset `tudien-stardict-en-vi-20260411.zip` (~16 MB).
- **Format:** StarDict 3.0.0, three files: `.ifo` (metadata), `.idx` (index), `.dict` (definitions; shipped dictzip-compressed `.dict.dz`, gzip-compatible).
  - `.ifo`: `sametypesequence=h` (definitions are HTML), `wordcount=235561`.
  - `.idx`: repeated records of `word` (UTF-8, `\0`-terminated) + 4-byte big-endian offset + 4-byte big-endian size into `.dict`.
  - `.dict`: HTML blob per entry at `[offset, offset+size)`.
- **Entry HTML shape** (observed): headword in `<b style="font-size:130%">` (with syllable dots, e.g. `cap·aci·tor`); pronunciation `[UK] /…/ [US] /…/` or `/…/`; optional `<b>CEFR:</b> A1`; then repeated POS blocks — `<b style="font-size:110%">■ <vnPos></b>` (e.g. `danh từ`, `động từ`), followed by sense lines (`text-indent:12px`, `<b>N.&nbsp;&nbsp;</b>` + Vietnamese gloss) and example lines (`text-indent:24px`, `‣ <i>EN</i> ↔ VI`); a synonym block (`đồng nghĩa/liên quan`); a footer (`sachxy.com • v<version>`).
- **Inflected forms** (e.g. `remembered`) are separate `.idx` keys pointing to the base word's HTML. The script indexes tudien by `.idx` key and looks up per DB word, so no dedup is required.

**Licensing note:** tudien ships no explicit license and aggregates proprietary dictionaries (Lạc Việt, TFlat, DictBox, Babylon, Laban). Using this data is an accepted risk for this internal enrichment; recorded here for awareness.

## 3. Scope

**In scope (v1):**
- Enrich `definition_vi` on **existing** definitions from tudien Vietnamese senses.
- Enrich `example_vi` on **existing** examples from tudien EN↔VI example pairs.
- **Overwrite by default** (tudien replaces existing Vietnamese); `--fill-only` restricts to `NULL`s.
- Standalone script + npm alias, following existing pipeline conventions.

**Out of scope (v1):**
- Adding brand-new words not already in the DB (`definitions.definition_en` is NOT NULL; tudien has no English definition, so new rows would need a placeholder — deferred to a separate project).
- IPA/pronunciation enrichment and CEFR `level` — deferred to a later phase.
- Synonyms/word-forms from tudien.
- Any change to runtime API/service code.

## 4. Approach

A **focused sibling script** `scripts/import-tudien.ts` + npm aliases, rather than a new branch inside `scripts/import-vietnamese-meanings.ts` (already large and multi-source). This follows the codebase convention where each source script is self-contained with its own inline TypeORM `DataSource`, keeps the StarDict-specific parsing isolated, and reuses the *same match-and-fill pattern* as `import-vi` (lowercased-headword batch matching, POS-then-order sense assignment, repository `update`).

## 5. Components

1. **StarDict reader**
   - Parse `.ifo`; assert `sametypesequence=h` (fail fast otherwise).
   - Read `.idx` fully into memory (~4.7 MB) → list of `{ word, offset, size }`.
   - Decompress `.dict.dz` → `.dict` if the plain `.dict` is absent (gzip-compatible), then read definition HTML by offset via random-access `fs` reads (do not load the ~108 MB blob whole).
   - Build `Map<lowercasedHeadword, rawHtml>` (last-wins on duplicate keys).

2. **HTML → structured parser** — `parseEntry(html) → { perPos: Array<{ vnPos, senses: string[], examples: Array<{ en, vi }> }> }`
   - Split into POS blocks on the `■ <vnPos>` markers.
   - Per block: extract ordered Vietnamese sense glosses (strip all tags, decode `&nbsp;`/`&bull;`/`&amp;` etc., trim), and example pairs from `‣ <i>EN</i> ↔ VI` lines.
   - Strip syllable dots from any headword text; drop the synonym block and footer.

3. **VN→EN POS map** — a constant object:
   `danh từ`→`noun`, `động từ`→`verb`, `tính từ`→`adjective`, `trạng từ`→`adverb`, `giới từ`→`preposition`, `đại từ`→`pronoun`, `mạo từ`→`determiner`, `liên từ`→`conjunction`, `thán từ`→`interjection`, `số từ`→`numeral`. Unmapped VN POS → `null` (handled by the primary-definition fallback).

4. **Enricher** — iterates DB words in batches (mirroring `import-vietnamese-meanings.ts`), looks each up in the tudien map, assigns senses/examples to existing rows per the merge rules, and applies updates in a transaction.

## 6. Data flow

```
Parse .ifo/.idx/.dict → Map<headword, html>
Query definitions (join word, join examples), batched by LOWER(word) IN (...):
  for each DB word present in the map:
    parsed = parseEntry(map[word])
    group DB definitions by part_of_speech
    for each parsed POS block:
      enPos = VN_POS_MAP[vnPos]
      targets = DB definitions whose part_of_speech == enPos, ordered by definition_order
      if targets: assign parsed.senses to targets in order
                  (surplus senses appended/joined onto the last target)
      else:       assign parsed.senses[0] to the word's primary (order 1) definition
      set definition_vi (overwrite unless --fill-only && current value non-null)
      for each target definition: set example_vi on its examples
        (match by normalized example_en == parsed example en; else by order),
        overwrite unless --fill-only && current value non-null
  flush batch updates in one transaction
```

## 7. Matching & merge rules

- **Word match:** `LOWER(words.word)` equals the lowercased tudien `.idx` key.
- **Sense → definition:** group the word's DB definitions by `part_of_speech`; assign a tudien POS block's ordered Vietnamese senses to the DB definitions of the mapped English POS, by `definition_order`. Surplus tudien senses are joined onto the last matching definition. A tudien POS block with no matching DB POS contributes its first sense to the word's primary (lowest `definition_order`) definition.
- **Example → example:** within a target definition, set `example_vi` on the example whose normalized `example_en` equals a tudien example's English; otherwise assign remaining tudien example translations by order. Normalization: lowercase, collapse whitespace, strip trailing punctuation.
- **Overwrite policy:** default writes tudien's value whenever tudien provides one; `--fill-only` writes only when the target column is `NULL`.
- **Idempotency:** re-running produces identical values (overwrite mode) or zero further changes (`--fill-only`).

## 8. Error handling & edge cases

| Situation | Behavior |
|-----------|----------|
| StarDict files missing/renamed | Fail fast with a message naming the expected path. |
| `.ifo` `sametypesequence` ≠ `h` | Fail fast (parser assumes HTML). |
| `.dict.dz` present, `.dict` absent | Decompress once, then proceed. |
| tudien word not in DB | Skip; count logged (no inserts in v1). |
| DB word not in tudien | Left unchanged. |
| Malformed/unparseable entry HTML | Skip that entry, log, continue. |
| tudien POS unmapped | First sense → primary definition (fallback). |
| Encoding artifacts (ZWJ in IPA, `&nbsp;`, `&bull;`) | Stripped/decoded during HTML cleaning. |

## 9. Flags & configuration

- `--dry-run` — parse + match, report counts (words matched, definitions and examples that would change), write nothing.
- `--fill-only` — only fill `NULL`s (default overwrites).
- `--word <w>` — process a single word end-to-end (spot-check).
- `--limit N` — cap the number of DB words processed.
- DB connection via `.env` (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`), matching other pipeline scripts.

## 10. Verification

The pipeline has no automated test suite; verify by running the script against a populated DB:

1. `--dry-run` on the full dataset → matched/changed counts are plausible (non-zero, not absurd).
2. `--word capacitor` then `--word happy` → query the DB and confirm `definition_vi` matches tudien's Vietnamese gloss and `example_vi` is populated for matched examples.
3. Full run → then a second run: overwrite mode reports the same values (idempotent); `--fill-only` reports ~0 changes.
4. Spot-check a word with multiple POS (e.g. `run`) to confirm senses land on the correct part-of-speech definitions.

## 11. Files

- Create: `scripts/import-tudien.ts`
- Modify: `package.json` (add `import-tudien`, `import-tudien:dry` script aliases)
- Data (gitignored; download documented in the script header): `data/vietnamese-sources/tudien/tudien-stardict-en-vi-<version>.{ifo,idx,dict}` (from the release `.zip`).

## 12. Open questions

None outstanding. Scope (definition_vi + example_vi, existing words only, overwrite-by-default with `--fill-only`), approach (sibling script), and POS+order sense assignment are confirmed.
