# Remove CJK (Chinese) Content from Vietnamese Fields — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Project:** english-learning-api (dictionary data-build pipeline)

## 1. Purpose

Some dictionary rows have **Chinese (CJK) text in their Vietnamese fields** — e.g. `amberjack` → `definition_vi` = "…(Mỹ,俚语,幽默)一种大型食用和猎物黄尾鱼…", `ambivore` → "(主要在_, 生物学)一种动物以两种食物为食". Vietnamese uses only Latin letters + diacritics and never CJK characters, so any CJK codepoint in a Vietnamese field is bad data. This feature adds a one-off pipeline cleanup script that scans the Vietnamese fields and nulls out values containing CJK.

## 2. Root cause (investigated)

The Chinese content did **not** come from the tudien StarDict enrichment:

- The tudien dataset contains **0 CJK characters across all 228,613 entries** (verified by scanning the source).
- The affected words (`amberjack`, `ambivore`, `amblypygid`, `ambophily`) are **not present in tudien** at all.
- The one on-screen word tudien *does* cover, `amazon`, has correct Vietnamese ("sông A-ma-zôn (Nam-Mỹ)").

The Chinese therefore **pre-existed** in the DB from an earlier step (most likely an LLM/machine-translation pass, or an import that occasionally emitted Chinese). Consequently **no change to `import-tudien.ts` is needed** — it neither introduced nor would reintroduce Chinese. Preventing recurrence at the translation source is a separate follow-up (see §9), out of scope here.

## 3. Scope

**In scope (v1):**
- Scan `definitions.definition_vi` and `examples.example_vi` for CJK characters.
- Set those columns to `NULL` for every row whose value contains any CJK codepoint (the English definition, part of speech, and word are untouched — only the bad translation is removed; it can be re-translated later).
- Additionally **scan and report** (no writes) CJK occurrences in `definitions.definition_en` and `examples.example_en`, so the operator is aware if English fields are affected (`definition_en`/`example_en` are NOT NULL and represent a different problem).
- `--dry-run` mode: report counts and sample rows, write nothing.

**Out of scope (v1):**
- Adding a CJK guard to the translation scripts (`translate-*`, `ai-translate`) — separate follow-up.
- Any change to `import-tudien.ts` or runtime API/service code.
- Stripping/repairing partial strings or re-translating the removed values.
- Scanning columns other than the four named above.

## 4. CJK detection

A value "contains CJK" if it has at least one codepoint in any of these Unicode ranges:

- CJK Unified Ideographs: U+4E00–U+9FFF
- CJK Unified Ideographs Extension A: U+3400–U+4DBF
- CJK Compatibility Ideographs: U+F900–U+FAFF
- CJK Symbols and Punctuation: U+3000–U+303F
- Halfwidth/Fullwidth Forms: U+FF00–U+FFEF

Implemented as a single regex. This is safe for Vietnamese: Vietnamese text is Latin script with combining diacritics (all < U+3000), so there are no false positives. (Japanese kana / Korean hangul are out of the observed problem but would also be non-Vietnamese; the ranges above focus on the Chinese content actually seen — kana/hangul ranges can be added later if they ever appear.)

## 5. Component

A single standalone script `scripts/clean-cjk.ts` + npm aliases, following existing pipeline-script conventions (inline TypeORM `DataSource` copied from the sibling scripts, repository updates, `dotenv` for DB config).

Flow:
```
connect DataSource
for each target VN column (definition_vi on definitions, example_vi on examples):
  select rows where the column IS NOT NULL and matches the CJK regex
     (regex applied in JS after fetching candidates, or via a SQL ~ '[CJK]' prefilter)
  report count + up to N sample rows (id, word/definition_en, offending value)
  unless --dry-run: UPDATE column = NULL for those row ids, batched, in a transaction
report-only scan of definition_en and example_en for CJK → print counts + samples (never modified)
print summary totals
```

Idempotent: after a real run, `definition_vi`/`example_vi` no longer contain CJK, so a re-run reports 0 to clean.

## 6. Flags & configuration

- `--dry-run` — scan and report counts + samples; write nothing.
- `--limit N` — cap sample rows printed per column (default e.g. 20).
- DB connection via `.env` (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`), matching the other pipeline scripts.
- npm aliases: `clean-cjk` → `ts-node scripts/clean-cjk.ts`; `clean-cjk:dry` → `ts-node scripts/clean-cjk.ts --dry-run`.

## 7. Error handling & edge cases

| Situation | Behavior |
|-----------|----------|
| DB unreachable | Fail fast with the connection error. |
| No CJK rows found | Report 0; exit cleanly (success). |
| CJK found in `definition_en`/`example_en` | Report count + samples only; do NOT modify (NOT NULL columns; different problem). |
| Value is mixed Vietnamese + CJK | Still nulled (the gloss is a bad translation; partial keep is not attempted). |
| Very large candidate set | Batch the UPDATEs (e.g. 500 ids per statement) within one transaction. |

## 8. Verification

The pipeline has no automated test suite for scripts; the CJK-detection predicate is the one piece of pure logic and should be unit-tested (jest, via the existing `test:tudien`-style config or a `test:scripts` config): assert it flags Chinese strings (`"一种动物"`, the amberjack/ambivore samples, fullwidth punctuation) and does NOT flag Vietnamese (`"sông A-ma-zôn (Nam-Mỹ)"`, `"cái tụ điện"`, diacritics) or plain English.

End-to-end verification (operator, against the DB):
1. `npm run clean-cjk:dry` → prints non-zero counts for `definition_vi`/`example_vi` and sample rows including `amberjack`/`ambivore`.
2. `npm run clean-cjk` → performs the nulling; prints totals cleaned.
3. `npm run clean-cjk:dry` again → reports 0 rows to clean (idempotent).
4. Spot-check in the app / psql: `amberjack`'s `definition_vi` is now `NULL`; `amazon`'s Vietnamese is unchanged.

## 9. Follow-up (not in this spec)

To prevent recurrence, add the same CJK predicate as a guard in the translation scripts (`translate-*`, `ai-translate`) so an LLM/translation result containing CJK is rejected/skipped rather than written. Tracked separately.

## 10. Open questions

None outstanding. Remove action (null the field), target columns (`definition_vi` + `example_vi`; English fields report-only), detection (CJK Unicode ranges), and script form are confirmed.
