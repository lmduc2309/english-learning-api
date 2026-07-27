# Missing-Vietnamese Audit + Fill — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Project:** english-learning-api (dictionary data-build pipeline)

## 1. Purpose

Quantify how many dictionary definitions/examples lack a Vietnamese meaning, make the "blank but not NULL" rows fillable, and prescribe how to fill the gap using the existing translation pipeline. Delivers: a read-only **audit** script, a **normalize** step (`''`/whitespace → `NULL`), and a documented **fill runbook** that reuses existing scripts. No new translation code.

## 2. The problem this fixes

Every existing filler selects rows with `definition_vi IS NULL` (and `definition_en IS NOT NULL`), and every `--stats` mode counts `definition_vi IS NOT NULL` as "done". Therefore a **blank-string (`''` or whitespace-only) Vietnamese value is invisible**: it is never reported as missing and never selected for filling, yet displays as empty to users. An honest audit must treat missing as `col IS NULL OR btrim(col) = ''`, and blanks must be converted to `NULL` so the existing fillers will pick them up.

The just-built `clean-cjk` script nulls Chinese glosses to `NULL` (not `''`), so its cleared rows are already fillable and will show up in this audit as missing — the two features compose cleanly.

## 3. Scope

**In scope (v1):**
- Audit `definitions.definition_vi` and `examples.example_vi` (rows where the English source column is non-NULL).
- Report totals, has-VN, missing (NULL + blank as one first-class number), % coverage, and a separate blank-string count.
- Frequency-band breakdown for definitions, plus a sample of the highest-frequency missing words.
- A `--normalize-empty` mode that converts blank/whitespace `definition_vi`/`example_vi` to `NULL`.
- A documented fill runbook using existing scripts (`clean-cjk`, `import-vi`, `ai-translate`).

**Out of scope (v1):**
- New translation/fill code or a chained fill orchestrator (reuse existing scripts).
- Columns other than `definition_vi` / `example_vi`.
- Changing the existing fillers' `IS NULL` predicate (the normalize step makes that unnecessary).
- Any runtime API/service code.

## 4. Definitions of "missing"

- **Missing (fillable):** `col IS NULL OR btrim(col) = ''` — includes NULL, empty string, and whitespace-only. (`btrim` = Postgres trim of leading/trailing whitespace.)
- **Blank (the invisible subset):** `col IS NOT NULL AND btrim(col) = ''` — reported separately because these are exactly the rows the existing fillers silently skip.
- Only rows whose English source is present count toward "fillable": `definition_en IS NOT NULL` (resp. `example_en IS NOT NULL`) — matching what the fillers can actually translate.

## 5. Components

1. **Pure helper** `scripts/lib/missing-vi.ts`
   - `isMissingVi(value: string | null | undefined): boolean` → true for `null`/`undefined`/`''`/whitespace-only; false otherwise. Unit-tested.
   - `MISSING_VI_SQL` — the reusable SQL fragment `"(%COL% IS NULL OR btrim(%COL%) = '')"` (or a small builder `missingSql(col: string): string`) so the audit's report and normalize queries share one definition.

2. **Audit script** `scripts/audit-vietnamese.ts` (+ npm alias `audit-vi`) — read-only by default.
   - For definitions and examples, print: total (with EN source present), has-VN, missing (NULL+blank), % coverage, and blank-only count.
   - Frequency-band breakdown for definitions by `words.frequency_rank`: `1–1000`, `1001–5000`, `5001–20000`, `20001+`, `no rank` — each with missing/total and %.
   - Print the top-N (default 20) highest-frequency missing words (word + POS).
   - `--normalize-empty`: within one transaction, `UPDATE definitions SET definition_vi = NULL WHERE btrim(definition_vi) = ''` and the analogous `examples` update (batched). Only this flag writes; default run writes nothing.
   - `--limit N`: cap the number of sample words printed (default 20).

## 6. Data flow

```
connect DataSource (copied from a sibling script)
report(definitions, definition_vi, definition_en, join words for freq + sample)
report(examples, example_vi, example_en)
if --normalize-empty:
  transaction:
    UPDATE definitions SET definition_vi = NULL WHERE definition_vi IS NOT NULL AND btrim(definition_vi) = ''
    UPDATE examples    SET example_vi    = NULL WHERE example_vi    IS NOT NULL AND btrim(example_vi)    = ''
  print how many were normalized
print summary
```

## 7. Fill runbook (documented; existing scripts)

1. `npm run clean-cjk` — remove Chinese glosses (nulls them). *(already implemented)*
2. `npm run audit-vi` — baseline gap + breakdown.
3. `npm run audit-vi -- --normalize-empty` — convert blanks to `NULL` so they become fillable.
4. `npm run import-vi` — offline dictionary fill (free, exact) for `definition_vi` + `example_vi`.
5. `npm run ai-translate:defs` then `npm run ai-translate:examples` — OpenRouter LLM fills the remainder, frequency-first, resumable (requires `OPENROUTER_API_KEY`; rate-limited).
6. `npm run audit-vi` — confirm the gap shrank; repeat step 5 until coverage is acceptable.

## 8. Error handling & edge cases

| Situation | Behavior |
|-----------|----------|
| DB unreachable | Fail fast with the connection error. |
| No missing rows | Report 0 / 100% coverage; exit cleanly. |
| Whitespace-only VN | Counted as missing; normalized to NULL by `--normalize-empty`. |
| `definition_en` NULL | Excluded from "fillable" totals (nothing to translate from). |
| `--normalize-empty` scope | Only touches `definition_vi`/`example_vi`; never English columns; never deletes rows. |
| Large result sets | Counts via SQL aggregates (not row loads); sample query is `LIMIT`-ed; normalize UPDATEs are set-based/batched. |

## 9. Testing & verification

- **Unit (jest, existing `scripts/` config):** `isMissingVi` returns true for `null`, `undefined`, `''`, `'   '`, `'\t\n'`; false for `'sông A-ma-zôn'`, `'cái tụ điện'`, `'a fish'`.
- **Manual (operator, against the DB):**
  1. `npm run audit-vi` → coverage %, missing counts, frequency breakdown, and blank-only count print with plausible values.
  2. `npm run audit-vi -- --normalize-empty` → prints N normalized; re-running `audit-vi` shows blank-only count = 0 and the NULL portion of "missing" increased by N (blanks moved to NULL, total missing unchanged).
  3. After running the fill runbook, `audit-vi` shows the missing count dropped.

## 10. Files

- Create: `scripts/lib/missing-vi.ts`, `scripts/lib/missing-vi.spec.ts`, `scripts/audit-vietnamese.ts`
- Modify: `package.json` (add `audit-vi` and `audit-vi:normalize` aliases)

## 11. Open questions

None outstanding. Deliverable (audit + normalize + documented fill), fill source (`import-vi` → `ai-translate`), columns (`definition_vi` + `example_vi`), and audit-read-only-with-`--normalize-empty`-write are confirmed.
