# Remove CJK Content from Vietnamese Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-off pipeline script that scans `definitions.definition_vi` and `examples.example_vi` for Chinese (CJK) characters and sets those values to `NULL`, while reporting (not modifying) any CJK found in the English columns.

**Architecture:** A pure, unit-tested CJK-detection predicate (`scripts/lib/cjk.ts`) plus a standalone orchestrator (`scripts/clean-cjk.ts`) that connects via TypeORM, uses a Postgres regex to prefilter candidate rows, confirms with the predicate, and batch-nulls the Vietnamese columns inside one transaction. Follows the existing pipeline-script conventions.

**Tech Stack:** TypeScript, ts-node (script execution), jest + ts-jest (unit tests for the predicate), TypeORM + Postgres.

## Global Constraints

- Clean columns: `definitions.definition_vi` and `examples.example_vi` — set to `NULL` when the value contains any CJK codepoint.
- Report-only columns: `definitions.definition_en` and `examples.example_en` — count + samples, never modified (they are NOT NULL).
- CJK detection ranges (verbatim): U+3000–U+303F, U+3400–U+4DBF, U+4E00–U+9FFF, U+F900–U+FAFF, U+FF00–U+FFEF. No false positives on Vietnamese (Latin + diacritics, all < U+3000).
- `--dry-run` reports counts + samples and writes nothing; default performs the nulling. `--limit N` caps samples printed per column (default 20).
- Idempotent: after a real run, a re-run reports 0 rows to clean.
- Do NOT modify `import-tudien.ts` or any runtime API/service code (the Chinese did not come from tudien).
- Follow existing script conventions: inline TypeORM `DataSource` copied from a sibling script, `dotenv` for DB config, DB connection via `.env` (`DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`).
- Entity/column names (verbatim): table `definitions` cols `definition_vi`/`definition_en`, FK `word_id`; table `examples` cols `example_vi`/`example_en`; table `words` col `word`, PK `id`.

---

## File Structure

```
english-learning-api/
  jest.scripts.config.js        # jest config for scripts/ tests (already exists; create if missing)
  scripts/
    lib/cjk.ts                  # containsCjk + CJK_REGEX (pure, unit-tested)
    lib/cjk.spec.ts
    clean-cjk.ts                # orchestrator: scan + null VN cols, report EN cols (DB; manual verify)
  package.json                  # add test:scripts, clean-cjk, clean-cjk:dry aliases
```

---

## Task 1: CJK detection predicate

**Files:**
- Create: `scripts/lib/cjk.ts`
- Create: `scripts/lib/cjk.spec.ts`
- Modify: `package.json` (add `test:scripts` alias)
- Create (only if missing): `jest.scripts.config.js`

**Interfaces:**
- Produces: `CJK_REGEX: RegExp`, `containsCjk(value: string | null | undefined): boolean`.

- [ ] **Step 1: Ensure the scripts jest config exists**

Run: `test -f jest.scripts.config.js && echo EXISTS || echo MISSING`

If it prints `MISSING`, create `jest.scripts.config.js`:
```javascript
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/scripts'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```
If it prints `EXISTS`, leave it unchanged.

- [ ] **Step 2: Add the `test:scripts` npm alias**

In `package.json`, inside `"scripts"`, add (if not already present):
```json
    "test:scripts": "jest --config jest.scripts.config.js",
```

- [ ] **Step 3: Write the failing test**

Create `scripts/lib/cjk.spec.ts`:
```typescript
import { containsCjk } from './cjk';

describe('containsCjk', () => {
  it('flags Chinese ideographs', () => {
    expect(containsCjk('一种动物以两种食物为食')).toBe(true);
  });

  it('flags mixed Vietnamese + Chinese glosses (real bad rows)', () => {
    expect(containsCjk('(Mỹ,俚语,幽默)一种大型食用和猎物黄尾鱼')).toBe(true);
    expect(containsCjk('(主要在_, 生物学)一种动物以两种食物为食')).toBe(true);
  });

  it('flags fullwidth CJK punctuation', () => {
    expect(containsCjk('例子，测试')).toBe(true);
  });

  it('does NOT flag valid Vietnamese', () => {
    expect(containsCjk('sông A-ma-zôn (Nam-Mỹ)')).toBe(false);
    expect(containsCjk('cái tụ điện')).toBe(false);
    expect(containsCjk('(tên khoa học của loài côn trùng lớp)')).toBe(false);
  });

  it('does NOT flag plain English', () => {
    expect(containsCjk('a large edible game fish')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(containsCjk(null)).toBe(false);
    expect(containsCjk(undefined)).toBe(false);
    expect(containsCjk('')).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test:scripts -- scripts/lib/cjk.spec.ts`
Expected: FAIL — cannot find module `./cjk`.

- [ ] **Step 5: Implement `scripts/lib/cjk.ts`**

```typescript
// CJK (Chinese) content must never appear in Vietnamese fields — Vietnamese is
// Latin script with combining diacritics (all codepoints < U+3000). Any match
// here is bad data. Ranges: CJK punctuation, Ext-A, Unified, Compatibility,
// and Halfwidth/Fullwidth forms.
export const CJK_REGEX = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

export function containsCjk(value: string | null | undefined): boolean {
  if (!value) return false;
  return CJK_REGEX.test(value);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:scripts -- scripts/lib/cjk.spec.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 7: Confirm the default suite is unaffected**

Run: `npm test -- --listTests 2>/dev/null | grep -c "scripts/lib/cjk"`
Expected: `0` (default `npm test` has `rootDir: src`, so it never picks up `scripts/` tests).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/cjk.ts scripts/lib/cjk.spec.ts package.json jest.scripts.config.js
git commit -m "feat(clean-cjk): CJK detection predicate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(If `jest.scripts.config.js` already existed and was unchanged, git simply won't stage it — that is fine.)

---

## Task 2: clean-cjk orchestrator + npm aliases

**Files:**
- Create: `scripts/clean-cjk.ts`
- Modify: `package.json` (add `clean-cjk`, `clean-cjk:dry` aliases)

**Interfaces:**
- Consumes: `containsCjk` from `./lib/cjk`.
- Produces: an executable pipeline script (no exported API).

**Note on the DataSource block:** open the sibling `scripts/import-vietnamese-meanings.ts` and copy its `new DataSource({...})` construction (env vars, entity list, options) and its entity import paths VERBATIM into `scripts/clean-cjk.ts`, replacing the template block below. Do not invent DB config — a wrong default could point at the wrong database.

- [ ] **Step 1: Read the sibling script for the DataSource pattern**

Run: `sed -n '1,12p;330,348p' scripts/import-vietnamese-meanings.ts`
Expected: shows the entity imports and the inline `new DataSource({...})` block. Copy both for use below.

- [ ] **Step 2: Implement `scripts/clean-cjk.ts`**

Create `scripts/clean-cjk.ts` (replace the `DataSource` block + entity imports with the exact ones copied in Step 1):
```typescript
/**
 * Remove CJK (Chinese) content from Vietnamese fields.
 *
 * Cleans definitions.definition_vi and examples.example_vi (sets them to NULL
 * when they contain CJK characters). Reports — but never modifies — CJK found
 * in definition_en / example_en.
 *
 * USAGE:
 *   npm run clean-cjk:dry     # report counts + samples, write nothing
 *   npm run clean-cjk         # perform the nulling
 *   npm run clean-cjk -- --limit 50
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
import { containsCjk } from './lib/cjk';

dotenv.config();

// Postgres POSIX-regex character class matching the CJK ranges (literal BMP
// boundary chars). Used only to PREFILTER candidate rows; containsCjk is the
// authoritative check applied in JS afterwards.
const PG_CJK = '[　-〿㐀-䶿一-鿿豈-﫿＀-￯]';

interface Args {
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const limit = i !== -1 && i + 1 < argv.length ? parseInt(argv[i + 1], 10) : 20;
  return { dryRun: argv.includes('--dry-run'), limit };
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

function printSamples(rows: Array<{ id: string; label: string; val: string }>, limit: number) {
  for (const r of rows.slice(0, limit)) {
    const val = r.val.length > 80 ? r.val.slice(0, 80) + '…' : r.val;
    console.log(`    #${r.id} ${r.label}: ${val}`);
  }
  if (rows.length > limit) console.log(`    …and ${rows.length - limit} more`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`clean-cjk — ${args.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);

  const ds = createDataSource();
  await ds.initialize();

  // --- definitions.definition_vi (CLEAN) ---
  const defRows: Array<{ id: string; word: string; val: string }> = await ds.query(
    `SELECT d.id::text AS id, w.word, d.definition_vi AS val
       FROM definitions d JOIN words w ON w.id = d.word_id
      WHERE d.definition_vi ~ $1`,
    [PG_CJK],
  );
  const defHits = defRows.filter((r) => containsCjk(r.val));
  console.log(`\ndefinitions.definition_vi: ${defHits.length} rows contain CJK`);
  printSamples(defHits.map((r) => ({ id: r.id, label: r.word, val: r.val })), args.limit);

  // --- examples.example_vi (CLEAN) ---
  const exRows: Array<{ id: string; val: string }> = await ds.query(
    `SELECT e.id::text AS id, e.example_vi AS val FROM examples e WHERE e.example_vi ~ $1`,
    [PG_CJK],
  );
  const exHits = exRows.filter((r) => containsCjk(r.val));
  console.log(`examples.example_vi: ${exHits.length} rows contain CJK`);
  printSamples(exHits.map((r) => ({ id: r.id, label: 'ex', val: r.val })), args.limit);

  // --- Apply nulling in one transaction ---
  if (!args.dryRun && (defHits.length || exHits.length)) {
    await ds.transaction(async (m) => {
      const chunk = <T>(a: T[], n: number) =>
        Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));
      for (const ids of chunk(defHits.map((r) => r.id), 500)) {
        await m.query(`UPDATE definitions SET definition_vi = NULL WHERE id = ANY($1::bigint[])`, [ids]);
      }
      for (const ids of chunk(exHits.map((r) => r.id), 500)) {
        await m.query(`UPDATE examples SET example_vi = NULL WHERE id = ANY($1::bigint[])`, [ids]);
      }
    });
    console.log(`\nCleaned: definition_vi=${defHits.length}, example_vi=${exHits.length}`);
  }

  // --- English columns: REPORT ONLY (never modified) ---
  const defEn: Array<{ id: string; word: string; val: string }> = await ds.query(
    `SELECT d.id::text AS id, w.word, d.definition_en AS val
       FROM definitions d JOIN words w ON w.id = d.word_id
      WHERE d.definition_en ~ $1`,
    [PG_CJK],
  );
  const defEnHits = defEn.filter((r) => containsCjk(r.val));
  console.log(`\n[report-only] definitions.definition_en: ${defEnHits.length} rows contain CJK`);
  printSamples(defEnHits.map((r) => ({ id: r.id, label: r.word, val: r.val })), args.limit);

  const exEn: Array<{ id: string; val: string }> = await ds.query(
    `SELECT e.id::text AS id, e.example_en AS val FROM examples e WHERE e.example_en ~ $1`,
    [PG_CJK],
  );
  const exEnHits = exEn.filter((r) => containsCjk(r.val));
  console.log(`[report-only] examples.example_en: ${exEnHits.length} rows contain CJK`);
  printSamples(exEnHits.map((r) => ({ id: r.id, label: 'ex', val: r.val })), args.limit);

  console.log(
    `\nSummary — VN ${args.dryRun ? 'would clean' : 'cleaned'}: definition_vi=${defHits.length}, ` +
      `example_vi=${exHits.length}; EN report-only: definition_en=${defEnHits.length}, example_en=${exEnHits.length}.`,
  );

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
    "clean-cjk": "ts-node scripts/clean-cjk.ts",
    "clean-cjk:dry": "ts-node scripts/clean-cjk.ts --dry-run",
```

- [ ] **Step 4: Verify — unit suite green + TypeScript compiles**

Run: `npm run test:scripts`
Expected: PASS — all `scripts/` specs green (includes `cjk.spec.ts`).

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i clean-cjk || echo "no type errors in clean-cjk"`
Expected: `no type errors in clean-cjk`.

- [ ] **Step 5: Verify — manual DB run (requires the populated Postgres)**

1. `npm run clean-cjk:dry`
   Expected: non-zero counts for `definition_vi` (samples should include `amberjack`, `ambivore`); `example_vi` count; report-only counts for the English columns; nothing written.
2. `npm run clean-cjk`
   Expected: prints "Cleaned: definition_vi=N, example_vi=M".
3. `npm run clean-cjk:dry` again
   Expected: `definition_vi: 0 rows contain CJK` and `example_vi: 0 rows contain CJK` (idempotent).
4. Spot-check in psql:
   `SELECT definition_vi FROM definitions d JOIN words w ON w.id=d.word_id WHERE w.word='amberjack';` → `NULL`.
   `SELECT definition_vi FROM definitions d JOIN words w ON w.id=d.word_id WHERE w.word='amazon';` → unchanged Vietnamese.

- [ ] **Step 6: Commit**

```bash
git add scripts/clean-cjk.ts package.json
git commit -m "feat(clean-cjk): scan and null CJK content in Vietnamese fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Purpose/root-cause (no tudien change) → honored (only new files; `import-tudien.ts` untouched). Clean `definition_vi`/`example_vi` → Task 2 clean passes. Report-only `definition_en`/`example_en` → Task 2 report passes. Detection ranges → Task 1 `CJK_REGEX` (verbatim). `--dry-run`/`--limit`, idempotency → Task 2 flags + verification steps. Predicate unit test → Task 1. Script conventions (DataSource, `.env`) → Task 2 with sibling-copy instruction. Follow-up (translation guard) → intentionally omitted, noted in spec §9.
- **Placeholder scan:** none — all code is concrete; the DataSource block is an explicit copy-from-sibling instruction (the risk flagged in the tudien work, so called out).
- **Type/name consistency:** `containsCjk`/`CJK_REGEX` defined in Task 1 and imported in Task 2; column/table names (`definition_vi`, `example_vi`, `definition_en`, `example_en`, `word_id`, `words.word`) used consistently; `PG_CJK` is only a prefilter, with `containsCjk` authoritative.
- **Prefilter safety:** the Postgres `~` prefilter and the JS `containsCjk` use the same ranges; re-filtering in JS means any prefilter imprecision can only reduce candidates that JS would reject anyway — a row is nulled only if `containsCjk` returns true. All ranges are BMP (no surrogate-pair concerns).
- **Assumption to watch during execution:** the `DataSource` config/entity paths must be copied from `import-vietnamese-meanings.ts` (Task 2 Step 1); the shown block is a best-guess template.
