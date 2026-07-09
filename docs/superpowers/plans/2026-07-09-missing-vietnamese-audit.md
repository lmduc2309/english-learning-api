# Missing-Vietnamese Audit + Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only audit script that honestly quantifies definitions/examples missing a Vietnamese meaning (counting NULL and blank), plus a `--normalize-empty` mode that converts blank values to NULL so the existing fillers pick them up — no new translation code.

**Architecture:** A pure, unit-tested predicate + SQL-fragment helper (`scripts/lib/missing-vi.ts`) shared by an orchestrator (`scripts/audit-vietnamese.ts`) that reports via SQL aggregates and performs the normalize UPDATEs in one transaction. Follows existing pipeline-script conventions. The fill itself reuses existing scripts, documented as a runbook.

**Tech Stack:** TypeScript, ts-node (script execution), jest + ts-jest (predicate unit tests), TypeORM + Postgres.

## Global Constraints

- "Missing" = `col IS NULL OR btrim(col) = ''` (NULL, empty, or whitespace-only). "Blank" (the invisible subset) = `col IS NOT NULL AND btrim(col) = ''`.
- Audit columns: `definitions.definition_vi` and `examples.example_vi`; "fillable" totals restrict to rows whose English source is non-NULL (`definition_en IS NOT NULL` / `example_en IS NOT NULL`).
- Audit is READ-ONLY by default. `--normalize-empty` is the only writing mode; it sets blank `definition_vi`/`example_vi` to NULL and touches no other column and no English column, and never deletes rows.
- Frequency bands for definitions (by `words.frequency_rank`): `1-1000`, `1001-5000`, `5001-20000`, `20001+`, `no rank`.
- `--limit N` caps the sample word list (default 20).
- Do NOT add new translation/fill code, do NOT change the existing fillers' predicate, do NOT modify runtime `src/` code or `import-tudien.ts`/`clean-cjk.ts`.
- Follow existing script conventions: inline TypeORM `DataSource` copied from a sibling script, `dotenv` DB config via `.env` (`DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`).
- Column/table names (verbatim): `definitions` (`definition_vi`, `definition_en`, `word_id`, `part_of_speech`); `examples` (`example_vi`, `example_en`); `words` (`id`, `word`, `frequency_rank`).
- Existing `npm test` (jest rootDir: src) stays untouched; predicate tests run via `test:scripts` (`jest.scripts.config.js`, already present).

---

## File Structure

```
english-learning-api/
  scripts/
    lib/missing-vi.ts        # isMissingVi + missingViSql/blankViSql (pure, unit-tested)
    lib/missing-vi.spec.ts
    audit-vietnamese.ts      # report (SQL aggregates) + --normalize-empty (DB; manual verify)
  package.json               # add audit-vi, audit-vi:normalize aliases
```

---

## Task 1: Missing-VN predicate + SQL helpers

**Files:**
- Create: `scripts/lib/missing-vi.ts`
- Create: `scripts/lib/missing-vi.spec.ts`

**Interfaces:**
- Produces: `isMissingVi(value: string | null | undefined): boolean`; `missingViSql(col: string): string`; `blankViSql(col: string): string`.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/missing-vi.spec.ts`:
```typescript
import { isMissingVi, missingViSql, blankViSql } from './missing-vi';

describe('isMissingVi', () => {
  it('treats null, undefined, empty, and whitespace-only as missing', () => {
    expect(isMissingVi(null)).toBe(true);
    expect(isMissingVi(undefined)).toBe(true);
    expect(isMissingVi('')).toBe(true);
    expect(isMissingVi('   ')).toBe(true);
    expect(isMissingVi('\t\n')).toBe(true);
  });

  it('treats real Vietnamese / English text as present', () => {
    expect(isMissingVi('sông A-ma-zôn (Nam-Mỹ)')).toBe(false);
    expect(isMissingVi('cái tụ điện')).toBe(false);
    expect(isMissingVi('a fish')).toBe(false);
  });
});

describe('SQL fragment builders', () => {
  it('missingViSql matches NULL or blank', () => {
    expect(missingViSql('definition_vi')).toBe(
      "(definition_vi IS NULL OR btrim(definition_vi) = '')",
    );
  });

  it('blankViSql matches non-NULL blank only', () => {
    expect(blankViSql('example_vi')).toBe(
      "(example_vi IS NOT NULL AND btrim(example_vi) = '')",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:scripts -- scripts/lib/missing-vi.spec.ts`
Expected: FAIL — cannot find module `./missing-vi`.

- [ ] **Step 3: Implement `scripts/lib/missing-vi.ts`**

```typescript
// A Vietnamese value is "missing" if it is null/undefined, empty, or
// whitespace-only. The existing fillers only match IS NULL, so blank strings
// are invisible to them — this predicate (and its SQL forms) treat blanks as
// missing so the audit is honest and the normalize step can fix them.
export function isMissingVi(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

// SQL predicate for "missing" on a controlled column identifier (NULL or blank).
export function missingViSql(col: string): string {
  return `(${col} IS NULL OR btrim(${col}) = '')`;
}

// SQL predicate for "blank but not NULL" — the subset the fillers silently skip.
export function blankViSql(col: string): string {
  return `(${col} IS NOT NULL AND btrim(${col}) = '')`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:scripts -- scripts/lib/missing-vi.spec.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Confirm the default suite is unaffected**

Run: `npm test -- --listTests 2>/dev/null | grep -c "scripts/lib/missing-vi"`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/missing-vi.ts scripts/lib/missing-vi.spec.ts
git commit -m "feat(audit-vi): missing-Vietnamese predicate + SQL helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: audit-vietnamese orchestrator + npm aliases

**Files:**
- Create: `scripts/audit-vietnamese.ts`
- Modify: `package.json` (add `audit-vi`, `audit-vi:normalize` aliases)

**Interfaces:**
- Consumes: `missingViSql`, `blankViSql` from `./lib/missing-vi`.
- Produces: an executable pipeline script (no exported API).

**Note on the DataSource block:** open `scripts/import-vietnamese-meanings.ts` and copy its `new DataSource({...})` construction (env vars, entity list, options) and entity import paths VERBATIM, replacing the template block below. Do not invent DB config.

- [ ] **Step 1: Read the sibling script for the DataSource pattern**

Run: `sed -n '1,12p;330,348p' scripts/import-vietnamese-meanings.ts`
Expected: shows the entity imports and the inline `new DataSource({...})` block. Copy both for use below.

- [ ] **Step 2: Implement `scripts/audit-vietnamese.ts`**

Create `scripts/audit-vietnamese.ts` (replace the `DataSource` block + entity imports with the exact ones copied in Step 1):
```typescript
/**
 * Audit missing Vietnamese meanings + normalize blank values.
 *
 * Reports how many definitions/examples lack a Vietnamese value (NULL or blank),
 * with a frequency breakdown and a sample of the most-common missing words.
 * `--normalize-empty` converts blank ('' / whitespace) definition_vi/example_vi
 * to NULL so the existing fillers will pick them up.
 *
 * USAGE:
 *   npm run audit-vi                    # report only (no writes)
 *   npm run audit-vi -- --normalize-empty
 *   npm run audit-vi -- --limit 50
 *
 * FILL RUNBOOK (uses existing scripts; run in order):
 *   1. npm run clean-cjk                 # remove Chinese glosses (nulls them)
 *   2. npm run audit-vi                  # baseline gap
 *   3. npm run audit-vi -- --normalize-empty   # blanks -> NULL (fillable)
 *   4. npm run import-vi                 # offline dict fill (free, exact)
 *   5. npm run ai-translate:defs && npm run ai-translate:examples   # OpenRouter LLM (needs OPENROUTER_API_KEY)
 *   6. npm run audit-vi                  # confirm gap shrank; repeat step 5 as needed
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import { missingViSql, blankViSql } from './lib/missing-vi';

dotenv.config();

const FREQ_BANDS = ['1-1000', '1001-5000', '5001-20000', '20001+', 'no rank'];

interface Args {
  normalizeEmpty: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const parsed = i !== -1 && i + 1 < argv.length ? parseInt(argv[i + 1], 10) : NaN;
  return {
    normalizeEmpty: argv.includes('--normalize-empty'),
    limit: Number.isFinite(parsed) ? parsed : 20,
  };
}

// Replace with the exact DataSource config copied from
// scripts/import-vietnamese-meanings.ts (Step 1).
function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    synchronize: false,
    logging: false,
  });
}

async function scalar(ds: DataSource, sql: string, params: unknown[] = []): Promise<number> {
  const rows = await ds.query(sql, params);
  return Number(rows[0].c);
}

function pct(part: number, total: number): string {
  return total === 0 ? '100.0' : ((part / total) * 100).toFixed(1);
}

async function reportColumn(
  ds: DataSource,
  table: string,
  viCol: string,
  enCol: string,
) {
  const base = `FROM ${table} WHERE ${enCol} IS NOT NULL`;
  const total = await scalar(ds, `SELECT count(*)::int c ${base}`);
  const missing = await scalar(ds, `SELECT count(*)::int c ${base} AND ${missingViSql(viCol)}`);
  const blank = await scalar(ds, `SELECT count(*)::int c ${base} AND ${blankViSql(viCol)}`);
  const has = total - missing;
  console.log(`\n${table}.${viCol} (rows with ${enCol}):`);
  console.log(`  total=${total}  has-VN=${has} (${pct(has, total)}%)  missing=${missing} (${pct(missing, total)}%)  [of which blank='': ${blank}]`);
}

async function reportFrequencyBands(ds: DataSource) {
  const rows: Array<{ band: string; total: number; missing: number }> = await ds.query(
    `SELECT
       CASE WHEN w.frequency_rank IS NULL THEN 'no rank'
            WHEN w.frequency_rank <= 1000 THEN '1-1000'
            WHEN w.frequency_rank <= 5000 THEN '1001-5000'
            WHEN w.frequency_rank <= 20000 THEN '5001-20000'
            ELSE '20001+' END AS band,
       count(*)::int AS total,
       count(*) FILTER (WHERE ${missingViSql('d.definition_vi')})::int AS missing
     FROM definitions d JOIN words w ON w.id = d.word_id
     WHERE d.definition_en IS NOT NULL
     GROUP BY band`,
  );
  const byBand = new Map(rows.map((r) => [r.band, r]));
  console.log(`\ndefinition_vi missing by word frequency:`);
  for (const band of FREQ_BANDS) {
    const r = byBand.get(band) || { total: 0, missing: 0 };
    console.log(`  ${band.padEnd(12)} missing ${r.missing}/${r.total} (${pct(r.missing, r.total)}%)`);
  }
}

async function reportSamples(ds: DataSource, limit: number) {
  const rows: Array<{ word: string; pos: string }> = await ds.query(
    `SELECT w.word, d.part_of_speech AS pos
     FROM definitions d JOIN words w ON w.id = d.word_id
     WHERE d.definition_en IS NOT NULL AND ${missingViSql('d.definition_vi')}
     ORDER BY w.frequency_rank ASC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  console.log(`\nTop ${limit} most-frequent missing words:`);
  for (const r of rows) console.log(`  ${r.word} (${r.pos})`);
  if (rows.length === 0) console.log('  (none)');
}

async function normalizeEmpty(ds: DataSource) {
  const defBlank = await scalar(ds, `SELECT count(*)::int c FROM definitions WHERE ${blankViSql('definition_vi')}`);
  const exBlank = await scalar(ds, `SELECT count(*)::int c FROM examples WHERE ${blankViSql('example_vi')}`);
  await ds.transaction(async (m) => {
    await m.query(`UPDATE definitions SET definition_vi = NULL WHERE ${blankViSql('definition_vi')}`);
    await m.query(`UPDATE examples SET example_vi = NULL WHERE ${blankViSql('example_vi')}`);
  });
  console.log(`\nNormalized blanks -> NULL: definition_vi=${defBlank}, example_vi=${exBlank}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ds = createDataSource();
  await ds.initialize();

  console.log(`Vietnamese coverage audit${args.normalizeEmpty ? ' (with --normalize-empty)' : ''}`);
  await reportColumn(ds, 'definitions', 'definition_vi', 'definition_en');
  await reportColumn(ds, 'examples', 'example_vi', 'example_en');
  await reportFrequencyBands(ds);
  await reportSamples(ds, args.limit);

  if (args.normalizeEmpty) await normalizeEmpty(ds);

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add npm aliases**

In `package.json` `"scripts"`, add:
```json
    "audit-vi": "ts-node scripts/audit-vietnamese.ts",
    "audit-vi:normalize": "ts-node scripts/audit-vietnamese.ts --normalize-empty",
```

- [ ] **Step 4: Verify — unit suite green + TypeScript compiles**

Run: `npm run test:scripts`
Expected: PASS — all `scripts/` specs green (includes `missing-vi.spec.ts`).

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i audit-vietnamese || echo "no type errors in audit-vietnamese"`
Expected: `no type errors in audit-vietnamese`.

- [ ] **Step 5: Verify — manual DB run (requires the populated Postgres)**

1. `npm run audit-vi`
   Expected: prints coverage for `definition_vi` and `example_vi` (total / has-VN / missing / blank), a frequency-band table for definitions, and a sample of the most-frequent missing words. Nothing written.
2. `npm run audit-vi -- --normalize-empty`
   Expected: prints "Normalized blanks -> NULL: definition_vi=N, example_vi=M".
3. `npm run audit-vi` again
   Expected: the blank='' count is now 0 for both columns; the overall missing count is unchanged from step 1 (blanks moved into the NULL portion, not removed).
4. Spot-check in psql: `SELECT count(*) FROM definitions WHERE btrim(definition_vi) = '';` → `0` after normalize.

- [ ] **Step 6: Commit**

```bash
git add scripts/audit-vietnamese.ts package.json
git commit -m "feat(audit-vi): missing-Vietnamese audit + blank normalization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** honest missing predicate (NULL + blank) → Task 1 `missingViSql`/`isMissingVi`; blank-only callout → `blankViSql` + report line. Read-only report with `--normalize-empty` write → Task 2. Frequency bands → `reportFrequencyBands`. Sample high-frequency missing words → `reportSamples`. Fill runbook → script header block (mirrors spec §7). Predicate unit test → Task 1. Script conventions (DataSource, `.env`) → Task 2 sibling-copy. Columns restricted to fillable (`*_en IS NOT NULL`) → the `base` clause and band/sample queries.
- **Placeholder scan:** none — all code concrete; DataSource block is an explicit copy-from-sibling instruction (the risk called out).
- **Type/name consistency:** `missingViSql`/`blankViSql`/`isMissingVi` defined in Task 1, imported/used identically in Task 2; column/table names match the constraints; `FREQ_BANDS` labels match the CASE expression labels exactly.
- **Predicate parity:** the report, band-filter, sample, and normalize queries all build their "missing"/"blank" clauses from the same `missingViSql`/`blankViSql` helpers as the unit-tested predicate — one source of truth, so SQL and JS cannot drift.
- **Safety:** the only writes are two `UPDATE … = NULL` statements guarded behind `--normalize-empty`, inside one transaction, touching only `definition_vi`/`example_vi` blank rows; no deletes; English columns never written.
- **Assumption to watch during execution:** the `DataSource` config/entity import paths must be copied from `import-vietnamese-meanings.ts` (Task 2 Step 1); the shown block is a best-guess template.
