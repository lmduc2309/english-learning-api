# Corpus Enhancement Programme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the cleaned legacy corpus from "no longer corrupt" to "has a licensed, provenance-tracked learner overlay ready for human review", and clear the residual quality debt that the cleanup left behind.

**Architecture:** Three independent phases. Phase A is mechanical corpus hygiene — migrations only, no external dependencies. Phase B establishes the provenance contract and imports the two licensed sources already on disk (NGSL, OEWN 2025) as *draft* learner rows. Phase C is translation work behind a paid API and needs per-run approval. Nothing in this plan publishes learner content: every generated row lands as `draft` and requires independent human bilingual approval.

**Tech Stack:** PostgreSQL 15.15 (Docker `dictionary-postgres`), NestJS 10 + TypeORM, ts-node scripts, Jest, OpenRouter (paid tier).

## Global Constraints

- Database `english_learning_db`, user `dictionary_user`, via `docker exec dictionary-postgres`. No host `psql`.
- **Run everything under Node 24**: `/opt/homebrew/opt/node@24/bin`. The default shell Node is v22.14.0 (ABI 127) and `better-sqlite3` is built for ABI 137, so any script touching the progress tracker fails with `ERR_DLOPEN_FAILED` under Node 22.
- Migrations are the source of truth. `TYPEORM_SYNCHRONIZE` stays `false`. Register every migration in **both** `src/migrations/runner.ts` and `scripts/migrations.ts` — there is no `src/migrations/index.ts`.
- New migration timestamps must exceed `1721402400000` and be unique. This plan allocates `1721403000000`, `1721403100000`, `1721403200000`, `1721403300000`, `1721403400000`, `1721403500000`.
- Snapshot discipline (unchanged from the cleanup plan): a `to_regclass` guard that raises, then unconditional `CREATE TABLE`, then unconditional `INSERT`. `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING` are forbidden on `cleanup_backup_*`. Call `assertSnapshotSafety(sql)` in every migration test.
- **Any migration that rewrites `example_vi` or `example_en` must drop `UQ_examples_definition_digest` first and recreate it after.** The index covers `(definition_id, md5(example_en), md5(coalesce(example_vi,'')))`, so text rewrites collide. This bit Task 5 of the previous plan twice.
- Every regex embedded in SQL must use `String.raw`. A plain template literal strips backslashes silently.
- `quality_flags` and `words.part_of_speech` are `text[]`. Use array operators, never `LIKE`.
- Never set `is_learner_visible = true` on a legacy row. The legacy layer stays reference-only.
- **No task in this plan may write a `published` learner row.** Everything is `draft` pending human review.
- Rehearse every migration on `english_learning_rehearsal` via `zsh scripts/db-rehearsal.sh create`, and verify rollback with ordered content digests, not row counts.

## Baseline (live-verified 2026-08-02, after the cleanup programme)

| Metric | Value |
| --- | --- |
| `words` / `definitions` / `examples` / `pronunciations` | 475,153 / 696,437 / 358,505 / 104,973 |
| all seven `learner_*` tables | **0** |
| `word_forms` / `synonyms` | 0 / 0 |
| Definition flags | `empty_definition` 35,953 · `vi_contains_cjk` 8,570 · `vi_equals_en` 3,204 |
| Example flags | `example_too_long` 32,704 · `vi_contains_cjk` 12,478 · `raw_markup` 2,403 · `vi_equals_en` 664 · `missing_vi` 380 · `empty_definition` 224 |
| `cleanup_review_example_vi_conflicts` | 1,126 groups |
| `cleanup_backup_cjk_translations` | 21,048 rows (8,570 + 12,478) |
| Applied migrations | 14 of 14 |

**Shape of the debt, measured not assumed:**

- All 35,953 `empty_definition` rows are label-only wrecks — `(archaic)`, `(medicine) .`, `( )` — where the Wiktionary body was lost at parse time. All 35,953 carry Vietnamese, but it is the translated *label*, not a definition. 8,448 have examples attached; **19,614 are the only definition for their word**. They are already invisible: `dictionary-presenter.ts:87` drops any definition flagged `empty_definition`.
- The 2,403 `raw_markup` examples are **2,345 HTML entities**, 43 brace pairs, 16 pipe-parens, 1 `thumb|`. Task 4 of the cleanup plan normalized `definition_en` only and never touched `example_en`.
- The 3,204 definition echoes decompose into 1,987 genuine untranslated English, 993 label-only (subsumed by the empty-definition deletion), 142 symbol-only, 82 single capitalised words. All 664 example echoes are genuine.
- Licensed source data on disk: OEWN 2025 vendor bytes (11 MB, checksum-locked) and NGSL 1.2 (2,809 ranked words). **`data/raw/cmu-dict` and `data/raw/wordnet` are empty** — legacy pronunciation and synonym sources are gone; OEWN is the replacement.

## Decisions taken (2026-08-02)

1. **Empty definitions: delete.** They are already suppressed, so nothing user-facing changes. Re-parsing the 12 GB Wiktionary dump to recover bodies is explicitly a separate future project.
2. **Learner overlay: build the pipeline and review worksheets, not the content.** Rows land as `draft`; a human bilingual reviewer approves before anything publishes.
3. **Translation: paid OpenRouter model.** Each run still needs explicit approval before it sends data.
4. **Frequency: NGSL only.** 2,809 words get a rank; the rest stay null. No new data acquisition.

---

# Phase A — Corpus hygiene (no external dependencies)

### Task A1: Delete the 35,953 label-only definitions

**Files:**
- Create: `src/migrations/1721403000000-RemoveEmptyDefinitions.ts`
- Create: `src/migrations/1721403000000-RemoveEmptyDefinitions.spec.ts`
- Modify: `src/migrations/runner.ts`, `scripts/migrations.ts`

**Interfaces:**
- Produces: `cleanup_backup_empty_definitions` (full rows) and `cleanup_backup_empty_definition_examples` (full rows), both restorable by `down()`.
- Consumed by A3: removing these also clears 993 of the 3,204 definition echoes, so A3 must measure after A1 runs.

`examples.definition_id` is `ON DELETE CASCADE`. 8,448 of these definitions carry examples, so those examples must be backed up before the parent delete or they vanish unrecoverably.

- [ ] **Step 1: Write the failing test**

```typescript
// src/migrations/1721403000000-RemoveEmptyDefinitions.spec.ts
import { RemoveEmptyDefinitions1721403000000 } from './1721403000000-RemoveEmptyDefinitions';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: RemoveEmptyDefinitions1721403000000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new RemoveEmptyDefinitions1721403000000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return { sql: statements.join('\n'), at: (re: RegExp) => statements.findIndex((s) => re.test(s)) };
  });
}

describe('RemoveEmptyDefinitions1721403000000', () => {
  it('backs up cascading examples before deleting their parent', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));
    assertSnapshotSafety(sql);
    expect(at(/INSERT INTO "cleanup_backup_empty_definition_examples"/))
      .toBeLessThan(at(/DELETE FROM "definitions"/));
    expect(at(/INSERT INTO "cleanup_backup_empty_definitions"/))
      .toBeLessThan(at(/DELETE FROM "definitions"/));
    // Selection must be by flag, not by re-deriving the regex.
    expect(sql).toContain(`'empty_definition' = ANY("quality_flags")`);
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);
  });

  it('restores definitions before examples on rollback and resets sequences', async () => {
    const { sql, at } = await collect((m, r) => m.down(r));
    expect(at(/INSERT INTO "definitions"/)).toBeLessThan(at(/INSERT INTO "examples"/));
    for (const t of ['definitions', 'examples']) {
      expect(sql).toContain(`setval(pg_get_serial_sequence('${t}','id')`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migrations/1721403000000-RemoveEmptyDefinitions.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the migration**

```typescript
// src/migrations/1721403000000-RemoveEmptyDefinitions.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deletes the 35,953 definitions whose English body was lost at parse time,
 * leaving only a Wiktionary label: `(archaic)`, `(medicine) .`, `( )`.
 *
 * Their Vietnamese is the translated label, not a definition, so there is
 * nothing to salvage in the database. dictionary-presenter.ts already drops
 * every one of them, so no client output changes — this makes the stored data
 * agree with what the API has always served.
 *
 * 19,614 words lose their only definition and become explicitly undefined.
 * That is the honest state; they were already undefined in practice.
 *
 * Recovering the lost bodies means re-parsing the 12 GB Wiktionary dump and is
 * deliberately out of scope.
 */
export class RemoveEmptyDefinitions1721403000000 implements MigrationInterface {
  name = 'RemoveEmptyDefinitions1721403000000';

  private static readonly SNAPSHOTS = [
    'cleanup_backup_empty_definitions',
    'cleanup_backup_empty_definition_examples',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of RemoveEmptyDefinitions1721403000000.SNAPSHOTS) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_empty_definitions" (LIKE "definitions" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_empty_definitions"
      SELECT d.* FROM "definitions" d
       WHERE 'empty_definition' = ANY(d."quality_flags")`);

    // examples.definition_id is ON DELETE CASCADE: 8,448 of these definitions
    // carry examples that would disappear unrecoverably with the parent.
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_empty_definition_examples" (LIKE "examples" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_empty_definition_examples"
      SELECT e.* FROM "examples" e
       WHERE e."definition_id" IN (
         SELECT "id" FROM "cleanup_backup_empty_definitions")`);

    await queryRunner.query(`
      DELETE FROM "definitions"
       WHERE "id" IN (SELECT "id" FROM "cleanup_backup_empty_definitions")`);

    // Fail closed: nothing flagged empty_definition may survive.
    await queryRunner.query(`
      DO $$
      DECLARE remaining bigint;
      BEGIN
        SELECT count(*) INTO remaining FROM "definitions"
         WHERE 'empty_definition' = ANY("quality_flags");
        IF remaining > 0 THEN
          RAISE EXCEPTION '% empty definition(s) survived the delete', remaining;
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "definitions" SELECT * FROM "cleanup_backup_empty_definitions"`);
    await queryRunner.query(`
      INSERT INTO "examples" SELECT * FROM "cleanup_backup_empty_definition_examples"`);
    for (const table of ['definitions', 'examples']) {
      await queryRunner.query(`
        SELECT setval(pg_get_serial_sequence('${table}','id'),
                      (SELECT max("id") FROM "${table}"), true)`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_empty_definition_examples"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_empty_definitions"`);
  }
}
```

Register in `src/migrations/runner.ts` and `scripts/migrations.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/migrations/1721403000000-RemoveEmptyDefinitions.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Rehearse, verify, roll back**

```bash
zsh scripts/db-rehearsal.sh create
DB_DATABASE=english_learning_rehearsal npm run migration:run
```

```sql
-- expect 660484 (696437 - 35953)
select count(*) from definitions;
-- expect 0
select count(*) from definitions where 'empty_definition' = any(quality_flags);
-- expect 35953 and 15285
select count(*) from cleanup_backup_empty_definitions;
select count(*) from cleanup_backup_empty_definition_examples;
-- expect 0: no example may be orphaned
select count(*) from examples e left join definitions d on d.id = e.definition_id where d.id is null;
-- expect 21336 words now with no definition at all
select count(*) from words w where not exists (select 1 from definitions d where d.word_id = w.id);
```

Two figures in the baseline above were mis-derived and are corrected here from
the rehearsal: **15,285 examples** hang off those 8,448 definitions (8,448 is
the count of definitions carrying examples, not the count of examples), and
**21,336 words** end up undefined, not 19,614 — some words had several
definitions and every one of them was a label-only wreck.

Then `migration:revert` and compare ordered digests of `definitions` and `examples` against pre-run values. Both must be identical.

- [ ] **Step 6: Apply to production, ANALYZE, commit**

```bash
npm run migration:run
docker exec -e PGPASSWORD="$PW" -i dictionary-postgres psql -U dictionary_user \
  -d english_learning_db -c "ANALYZE definitions, examples;"
git add src/migrations/1721403000000-RemoveEmptyDefinitions.ts \
        src/migrations/1721403000000-RemoveEmptyDefinitions.spec.ts \
        src/migrations/runner.ts scripts/migrations.ts
git commit -m "fix(data): delete 35953 label-only definitions

Wiktionary bodies lost at parse time; only the label survived. Already
suppressed by dictionary-presenter, so no client output changes. 19614 words
become explicitly undefined rather than silently so. Cascading examples are
backed up before the parent delete."
```

---

### Task A2: Normalize markup in the 2,403 examples

**Files:**
- Create: `src/migrations/1721403100000-NormalizeExampleMarkup.ts`
- Create: `src/migrations/1721403100000-NormalizeExampleMarkup.spec.ts`
- Modify: `src/migrations/runner.ts`, `scripts/migrations.ts`

**Interfaces:**
- Consumes: nothing from A1, but run it after A1 so the 224 `empty_definition` examples are already gone from the working set.
- Produces: `cleanup_backup_examples_markup_text` holding `(id, example_en, quality_flags)`.

Composition is 2,345 HTML entities, 43 brace pairs, 16 pipe-parens, 1 `thumb|` — the same defect Task 4 of the cleanup plan fixed for definitions, on the column it never touched.

- [ ] **Step 1: Write the failing test**

```typescript
// src/migrations/1721403100000-NormalizeExampleMarkup.spec.ts
import { NormalizeExampleMarkup1721403100000 } from './1721403100000-NormalizeExampleMarkup';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: NormalizeExampleMarkup1721403100000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new NormalizeExampleMarkup1721403100000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return { sql: statements.join('\n'), at: (re: RegExp) => statements.findIndex((s) => re.test(s)) };
  });
}

describe('NormalizeExampleMarkup1721403100000', () => {
  it('releases the digest index around the rewrite', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));
    assertSnapshotSafety(sql);
    // UQ_examples_definition_digest covers md5(example_en); rewriting the
    // English collides exactly as the CJK punctuation migration did.
    expect(at(/DROP INDEX IF EXISTS "UQ_examples_definition_digest"/))
      .toBeLessThan(at(/SET "example_en"/));
    expect(at(/SET "example_en"/))
      .toBeLessThan(at(/CREATE UNIQUE INDEX "UQ_examples_definition_digest"/));
    expect(sql).toMatch(/LOOP/i);
    expect(sql).toContain('EXIT WHEN out = prev');
    expect(sql).toContain('&nbsp;');
    expect(sql).toContain(`array_remove("quality_flags", 'raw_markup')`);
  });

  it('restores original text on rollback', async () => {
    const { sql } = await collect((m, r) => m.down(r));
    expect(sql).toContain('cleanup_backup_examples_markup_text');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"examples"/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migrations/1721403100000-NormalizeExampleMarkup.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the migration**

Reuse the exact normalizer from `1721402100000-NormalizeRawMarkupDefinitions.ts`, applied to `example_en`:

```typescript
// src/migrations/1721403100000-NormalizeExampleMarkup.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const PG_RAW_MARKUP =
  String.raw`(\([^)]*\|[^)]*\)|thumb\||<[^>]+>|&(nbsp|emsp|ensp|lt|gt|amp|quot);|\{\{|\}\})`;

export class NormalizeExampleMarkup1721403100000 implements MigrationInterface {
  name = 'NormalizeExampleMarkup1721403100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cleanup_backup_examples_markup_text') IS NOT NULL THEN
          RAISE EXCEPTION 'stale snapshot cleanup_backup_examples_markup_text exists; review and drop it before re-running';
        END IF;
      END $$;`);

    await queryRunner.query(String.raw`
      CREATE FUNCTION pg_temp.cleanup_normalize_markup(src text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE out text := src; prev text;
      BEGIN
        LOOP
          prev := out;
          out := regexp_replace(out, '\(([^)|]*)\|', '(\1, ', 'g');
          EXIT WHEN out = prev;
        END LOOP;
        out := replace(replace(replace(replace(replace(replace(replace(
                 out,'&nbsp;',' '),'&emsp;',' '),'&ensp;',' '),
                 '&lt;','<'),'&gt;','>'),'&quot;','"'),'&amp;','&');
        out := replace(replace(replace(out,'thumb|',''),'{{',''),'}}','');
        RETURN btrim(out);
      END $fn$;`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_examples_markup_text" AS
      SELECT "id", "example_en", "quality_flags" FROM "examples"
       WHERE 'raw_markup' = ANY("quality_flags")`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_backup_examples_markup_text" ADD PRIMARY KEY ("id")`);

    // Rewriting example_en changes md5(example_en), which the unique index
    // covers. Release it, rewrite, collapse any new duplicate, restore it.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);

    await queryRunner.query(`
      UPDATE "examples" e
         SET "example_en" = pg_temp.cleanup_normalize_markup(e."example_en")
       WHERE 'raw_markup' = ANY(e."quality_flags")`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_example_markup_keep" AS
      SELECT min("id") AS "id" FROM "examples"
       GROUP BY "definition_id", md5("example_en"), md5(COALESCE("example_vi", ''))`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_example_markup_keep" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_example_markup_keep"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_examples_markup_text"
      SELECT e."id", e."example_en", e."quality_flags" FROM "examples" e
       WHERE NOT EXISTS (SELECT 1 FROM "cleanup_example_markup_keep" k WHERE k."id" = e."id")
         AND NOT EXISTS (SELECT 1 FROM "cleanup_backup_examples_markup_text" b WHERE b."id" = e."id")`);
    await queryRunner.query(`
      DELETE FROM "examples" e
       WHERE NOT EXISTS (SELECT 1 FROM "cleanup_example_markup_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`DROP TABLE "cleanup_example_markup_keep"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    await queryRunner.query(`
      UPDATE "examples"
         SET "quality_flags" = array_remove("quality_flags", 'raw_markup')
       WHERE 'raw_markup' = ANY("quality_flags")
         AND "example_en" !~ '${PG_RAW_MARKUP}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);
    await queryRunner.query(`
      UPDATE "examples" e
         SET "example_en" = b."example_en", "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_examples_markup_text" b
       WHERE e."id" = b."id"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_examples_markup_text"`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/migrations/1721403100000-NormalizeExampleMarkup.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Rehearse and verify**

```sql
-- expect 0
select count(*) from examples where 'raw_markup' = any(quality_flags);
-- expect 0
select count(*) from examples where example_en ~ '&(nbsp|emsp|ensp|lt|gt|amp|quot);';
-- record: rows collapsed as duplicates after the rewrite
select count(*) from cleanup_backup_examples_markup_text;
```

Revert and compare the ordered `examples` digest. Must be identical.

- [ ] **Step 6: Apply to production and commit**

```bash
npm run migration:run
git add src/migrations/1721403100000-NormalizeExampleMarkup.ts \
        src/migrations/1721403100000-NormalizeExampleMarkup.spec.ts \
        src/migrations/runner.ts scripts/migrations.ts
git commit -m "fix(data): normalize markup in 2403 examples

Mostly HTML entities (2345). The definition-side migration never touched
example_en. Releases UQ_examples_definition_digest for the rewrite because
the index covers md5(example_en)."
```

---

### Task A3: Classify the echoes and resolve the non-translation ones

**Files:**
- Create: `src/migrations/1721403200000-ClassifyVietnameseEchoes.ts`
- Create: `src/migrations/1721403200000-ClassifyVietnameseEchoes.spec.ts`
- Modify: `src/migrations/runner.ts`, `scripts/migrations.ts`

**Interfaces:**
- Consumes: A1 must run first — it removes 993 of the 3,204 definition echoes.
- Produces: `cleanup_review_vi_echoes(table_name, row_id, kind, english, vietnamese)` — a retained report, not a rollback snapshot, listing every echo with its classification. `kind` is one of `symbol_only`, `proper_noun_candidate`, `needs_translation`.

An echo is not one defect. Symbol-only entries (`' + '`) and single capitalised words (`Acclivous`) may legitimately be identical in both languages; those are not translation failures and must not be queued for the paid API. Only `needs_translation` rows go to Phase C.

- [ ] **Step 1: Write the failing test**

```typescript
// src/migrations/1721403200000-ClassifyVietnameseEchoes.spec.ts
import { ClassifyVietnameseEchoes1721403200000 } from './1721403200000-ClassifyVietnameseEchoes';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

describe('ClassifyVietnameseEchoes1721403200000', () => {
  it('classifies without mutating any corpus text', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ClassifyVietnameseEchoes1721403200000().up({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');

    assertSnapshotSafety(sql);
    expect(sql).toContain('cleanup_review_vi_echoes');
    for (const kind of ['symbol_only', 'proper_noun_candidate', 'needs_translation']) {
      expect(sql).toContain(kind);
    }
    // Classification is a report. It must not touch definition_vi/example_vi.
    expect(sql).not.toMatch(/UPDATE\s+"definitions"\s+SET\s+"definition_vi"/i);
    expect(sql).not.toMatch(/UPDATE\s+"examples"\s+SET\s+"example_vi"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"(definitions|examples)"/i);
  });

  it('drops only its own report on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ClassifyVietnameseEchoes1721403200000().down({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "cleanup_review_vi_echoes"');
    expect(sql).not.toMatch(/UPDATE|DELETE FROM "(definitions|examples)"/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migrations/1721403200000-ClassifyVietnameseEchoes.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the migration**

```typescript
// src/migrations/1721403200000-ClassifyVietnameseEchoes.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sorts vi_equals_en rows into what they actually are, so that only genuine
 * translation failures reach the paid API.
 *
 * Symbol-only entries and single capitalised words are frequently identical in
 * both languages by design; queueing them for re-translation wastes quota and
 * invites the model to invent Vietnamese for a proper noun.
 */
export class ClassifyVietnameseEchoes1721403200000 implements MigrationInterface {
  name = 'ClassifyVietnameseEchoes1721403200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cleanup_review_vi_echoes') IS NOT NULL THEN
          RAISE EXCEPTION 'stale snapshot cleanup_review_vi_echoes exists; review and drop it before re-running';
        END IF;
      END $$;`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_review_vi_echoes" (
        "table_name" text NOT NULL,
        "row_id" bigint NOT NULL,
        "kind" text NOT NULL
          CHECK ("kind" IN ('symbol_only','proper_noun_candidate','needs_translation')),
        "english" text,
        "vietnamese" text,
        PRIMARY KEY ("table_name", "row_id"))`);

    await queryRunner.query(String.raw`
      INSERT INTO "cleanup_review_vi_echoes"
      SELECT 'definitions', "id",
             CASE
               WHEN "definition_en" !~ '[a-zA-Z]' THEN 'symbol_only'
               WHEN btrim("definition_en") ~ '^[A-Z][a-z]+$' THEN 'proper_noun_candidate'
               ELSE 'needs_translation'
             END,
             "definition_en", "definition_vi"
        FROM "definitions"
       WHERE 'vi_equals_en' = ANY("quality_flags")`);

    await queryRunner.query(String.raw`
      INSERT INTO "cleanup_review_vi_echoes"
      SELECT 'examples', "id",
             CASE
               WHEN "example_en" !~ '[a-zA-Z]' THEN 'symbol_only'
               WHEN btrim("example_en") ~ '^[A-Z][a-z]+$' THEN 'proper_noun_candidate'
               ELSE 'needs_translation'
             END,
             "example_en", "example_vi"
        FROM "examples"
       WHERE 'vi_equals_en' = ANY("quality_flags")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_review_vi_echoes"`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/migrations/1721403200000-ClassifyVietnameseEchoes.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Rehearse and record the split**

```sql
select kind, table_name, count(*) from cleanup_review_vi_echoes group by 1,2 order by 1,2;
-- corpus text must be untouched
select count(*) from definitions where 'vi_equals_en' = any(quality_flags);
select count(*) from examples where 'vi_equals_en' = any(quality_flags);
```

Record the `needs_translation` total — that is the Phase C work item, and it will be smaller than 3,868 because A1 removed the label-only echoes.

- [ ] **Step 6: Apply to production and commit**

```bash
npm run migration:run
git add src/migrations/1721403200000-ClassifyVietnameseEchoes.ts \
        src/migrations/1721403200000-ClassifyVietnameseEchoes.spec.ts \
        src/migrations/runner.ts scripts/migrations.ts
git commit -m "chore(data): classify Vietnamese echoes for triage

Symbol-only entries and proper-noun candidates are not translation failures
and must not consume paid API quota."
```

---

### Task A4: Export the 1,126 conflict groups for human review

**Files:**
- Create: `scripts/export-review-queues.ts`
- Create: `scripts/export-review-queues.spec.ts`
- Modify: `package.json` (add `export-review-queues` script)

**Interfaces:**
- Consumes: `cleanup_review_example_vi_conflicts` (A-phase prerequisite: exists from the cleanup programme) and `cleanup_review_vi_echoes` from A3.
- Produces: `reports/review-queues-<date>/example-vi-conflicts.csv` and `vi-echoes.csv`, UTF-8 with BOM, formula-injection guarded, mirroring `scripts/export-word-data.ts` conventions.

This task produces no database change. Its output is what a human reviewer actually works from.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/export-review-queues.spec.ts
import { toCsvCell, buildConflictRows } from './export-review-queues';

describe('export-review-queues', () => {
  it('guards against spreadsheet formula injection', () => {
    expect(toCsvCell('=cmd|/c calc')).toBe(`"'=cmd|/c calc"`);
    expect(toCsvCell('+1')).toBe(`"'+1"`);
    expect(toCsvCell('safe')).toBe('"safe"');
  });

  it('escapes embedded quotes', () => {
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('emits one row per variant with a shared group key', () => {
    const rows = buildConflictRows([
      { definition_id: 7, example_en_digest: 'abc', example_ids: [1, 2], variant_count: 2 },
    ], new Map([
      [1, { example_en: 'A dog.', example_vi: 'Một con chó.' }],
      [2, { example_en: 'A dog.', example_vi: 'Con chó.' }],
    ]));
    expect(rows).toHaveLength(2);
    expect(rows[0].group_key).toBe(rows[1].group_key);
    expect(rows.map((r) => r.example_vi)).toEqual(['Một con chó.', 'Con chó.']);
    // A reviewer needs somewhere to record the decision.
    expect(rows[0]).toHaveProperty('reviewer_decision', '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.scripts.config.js scripts/export-review-queues.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the exporter**

Export `toCsvCell(value: string): string` and
`buildConflictRows(groups, examplesById): Array<{ group_key: string; example_id: number; example_en: string; example_vi: string; reviewer_decision: string }>`.
`toCsvCell` wraps every value in quotes, doubles internal quotes, and prefixes `'` when the value starts with `=`, `+`, `-` or `@`. `buildConflictRows` uses `${definition_id}:${example_en_digest}` as `group_key` and emits one row per id in `example_ids`, in the given order, with `reviewer_decision` empty.

`main()` connects with the same `DataSource` entity list as `scripts/ai-translate/db-connector.ts` — **including the five learner entities**, or TypeORM fails with `Entity metadata for Word#learnerEntry was not found` — writes both CSVs into `reports/review-queues-<YYYY-MM-DD>/`, and prints row counts.

Add to `package.json`:

```json
"export-review-queues": "ts-node scripts/export-review-queues.ts"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS including the 3 new tests.

- [ ] **Step 5: Generate and eyeball the real export**

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run export-review-queues
```

Expected: `example-vi-conflicts.csv` with 1,126 group keys and ~2,300 rows, `vi-echoes.csv` with the A3 counts. Open the first ten conflict groups and confirm the paired Vietnamese variants are genuinely different.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-review-queues.ts scripts/export-review-queues.spec.ts package.json
git commit -m "feat(scripts): export conflict and echo review queues as CSV"
```

---

# Phase B — Provenance, licensing and licensed sources

### Task B1: Write the provenance and licensing policy, and enforce it

**Files:**
- Create: `docs/provenance-and-licensing.md`
- Create: `src/migrations/1721403300000-EnforceLearnerProvenance.ts`
- Create: `src/migrations/1721403300000-EnforceLearnerProvenance.spec.ts`
- Modify: `src/migrations/runner.ts`, `scripts/migrations.ts`

**Interfaces:**
- Produces: `CHK_learner_sense_publish_requires_provenance` and `CHK_learner_translation_publish_requires_provenance` — constraints that make an under-documented `published` row impossible.

The policy document states the rules; the constraints make them unbreakable. Both are needed: a document alone has already failed once, since 100% of legacy rows carry no `source`, `translation_method` or `translation_confidence`.

The document must record, at minimum: that legacy `tudien` Vietnamese has no established reusable licence and stays reference-only pending clearance; that OEWN 2025 is CC BY 4.0 and requires attribution; that NGSL is CC BY-SA 4.0; that every published learner sense needs `definition_source`, `definition_source_url`, `definition_source_license`, `definition_source_version` and `definition_source_artifact_sha256`; that machine output is a review hint and never a source; and that AI-generated Vietnamese may only ever surface as an explicitly labelled `generated_fallback`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/migrations/1721403300000-EnforceLearnerProvenance.spec.ts
import { EnforceLearnerProvenance1721403300000 } from './1721403300000-EnforceLearnerProvenance';

describe('EnforceLearnerProvenance1721403300000', () => {
  it('constrains published rows only, and validates without rewriting data', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new EnforceLearnerProvenance1721403300000().up({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');

    expect(sql).toContain('CHK_learner_sense_publish_requires_provenance');
    expect(sql).toContain('CHK_learner_translation_publish_requires_provenance');
    // Draft rows must stay unconstrained so curation can proceed.
    expect(sql).toMatch(/status\s*<>\s*'published'/i);
    expect(sql).toContain('definition_source_artifact_sha256');
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    // Constraints only — never fabricate provenance for existing rows.
    expect(sql).not.toMatch(/UPDATE\s+"learner_/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"learner_/i);
  });

  it('drops only the constraints on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new EnforceLearnerProvenance1721403300000().down({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "CHK_learner_sense_publish_requires_provenance"');
    expect(sql).not.toMatch(/DELETE|UPDATE/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migrations/1721403300000-EnforceLearnerProvenance.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the policy document and the migration**

The migration adds, to `learner_senses`:

```sql
ALTER TABLE "learner_senses"
  ADD CONSTRAINT "CHK_learner_sense_publish_requires_provenance" CHECK (
    "status" <> 'published' OR (
      "definition_source" IS NOT NULL AND
      "definition_source_url" IS NOT NULL AND
      "definition_source_license" IS NOT NULL AND
      "definition_source_version" IS NOT NULL AND
      "definition_source_artifact_sha256" ~ '^[0-9a-f]{64}$' AND
      "reviewed_by" IS NOT NULL AND
      "reviewed_at" IS NOT NULL
    )
  );
```

and the equivalent on `learner_sense_translations`, requiring `source`, `source_license`, `reviewed_by`, `reviewed_at` and `review_status = 'approved'` whenever the parent sense publishes. Both tables are empty, so no `NOT VALID` dance is required — but state that explicitly in a comment so a future reader does not assume the constraints were retrofitted onto data.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/migrations/1721403300000-EnforceLearnerProvenance.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the constraint bites**

On the rehearsal database, attempt to insert a `published` sense with no provenance and confirm it is rejected; then insert the same row as `draft` and confirm it succeeds. Delete both afterwards.

- [ ] **Step 6: Apply and commit**

```bash
npm run migration:run
git add docs/provenance-and-licensing.md \
        src/migrations/1721403300000-EnforceLearnerProvenance.ts \
        src/migrations/1721403300000-EnforceLearnerProvenance.spec.ts \
        src/migrations/runner.ts scripts/migrations.ts
git commit -m "feat(data): enforce provenance on published learner rows

A policy document alone has already failed: 100% of legacy rows carry no
source or translation method. These constraints make an under-documented
published row impossible while leaving draft curation unconstrained."
```

---

### Task B2: Import NGSL frequency rank for the learner subset

**Files:**
- Create: `src/migrations/1721403400000-AddNgslFrequencyRank.ts`
- Create: `src/migrations/1721403400000-AddNgslFrequencyRank.spec.ts`
- Create: `scripts/import-ngsl-rank.ts`
- Modify: `src/migrations/runner.ts`, `scripts/migrations.ts`, `package.json`

**Interfaces:**
- Consumes: `data/learner-core/ngsl-candidates.csv` (2,809 ranked rows) and `ngsl-source-lock.json` (checksum).
- Produces: `words.ngsl_rank integer NULL` plus `IDX_words_ngsl_rank`, and a populated rank for the NGSL words only.

Do **not** overwrite the existing `frequency_rank` column. It is null on all 475,153 rows and its provenance is unknown; adding a separately named, separately sourced column keeps NGSL's licence and version attributable. Note in the migration comment that `ai-translate` orders by `word.frequencyRank`, which stays inert — switching it to `ngsl_rank` is a deliberate follow-up, not a side effect of this task.

- [ ] **Step 1: Write the failing test**

```typescript
// src/migrations/1721403400000-AddNgslFrequencyRank.spec.ts
import { AddNgslFrequencyRank1721403400000 } from './1721403400000-AddNgslFrequencyRank';

describe('AddNgslFrequencyRank1721403400000', () => {
  it('adds a separately sourced column without touching frequency_rank', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNgslFrequencyRank1721403400000().up({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');

    expect(sql).toContain('"ngsl_rank" integer');
    expect(sql).toContain('IDX_words_ngsl_rank');
    // frequency_rank has unknown provenance; leave it alone.
    expect(sql).not.toMatch(/"frequency_rank"/);
    // The migration adds structure only; the import script fills it.
    expect(sql).not.toMatch(/UPDATE\s+"words"\s+SET\s+"ngsl_rank"/i);
  });

  it('drops the column and index on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNgslFrequencyRank1721403400000().down({ query } as any);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_words_ngsl_rank"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "ngsl_rank"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/migrations/1721403400000-AddNgslFrequencyRank.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the migration and the import script**

Migration: `ALTER TABLE "words" ADD COLUMN IF NOT EXISTS "ngsl_rank" integer`, then `CREATE INDEX "IDX_words_ngsl_rank" ON "words" ("ngsl_rank") WHERE "ngsl_rank" IS NOT NULL`.

`scripts/import-ngsl-rank.ts` must: verify `ngsl-candidates.csv` against the SHA-256 in `ngsl-source-lock.json` and abort on mismatch; default to dry-run and require `--write`; match on `words.word` exactly (case-sensitive — NGSL merges `march/March` and `may/May` deliberately, so report unmatched rows rather than lower-casing to force a match); and print matched/unmatched counts. Add `"ngsl:rank": "ts-node scripts/import-ngsl-rank.ts"` to `package.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/migrations/1721403400000-AddNgslFrequencyRank.spec.ts && npm run test:scripts`
Expected: PASS.

- [ ] **Step 5: Rehearse the import**

```bash
DB_DATABASE=english_learning_rehearsal npm run ngsl:rank
DB_DATABASE=english_learning_rehearsal npm run ngsl:rank -- --write
```

```sql
-- expect close to 2809; record the exact figure and the unmatched list
select count(*) from words where ngsl_rank is not null;
-- ranks must be unique and dense from 1
select min(ngsl_rank), max(ngsl_rank), count(distinct ngsl_rank) from words where ngsl_rank is not null;
```

- [ ] **Step 6: Apply, import, commit**

```bash
npm run migration:run
npm run ngsl:rank -- --write
git add src/migrations/1721403400000-AddNgslFrequencyRank.ts \
        src/migrations/1721403400000-AddNgslFrequencyRank.spec.ts \
        scripts/import-ngsl-rank.ts src/migrations/runner.ts scripts/migrations.ts package.json
git commit -m "feat(data): add NGSL-sourced frequency rank for the learner subset

Separate column from frequency_rank, whose provenance is unknown and which is
null on all 475153 rows. Checksum-verified against ngsl-source-lock.json."
```

---

### Task B3: Build the learner-overlay candidate set and review worksheets

**Files:**
- Create: `scripts/learner-overlay/select-candidates.ts`
- Create: `scripts/learner-overlay/select-candidates.spec.ts`
- Create: `scripts/learner-overlay/build-worksheets.ts`
- Create: `scripts/learner-overlay/build-worksheets.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `words.ngsl_rank` from B2, the OEWN artifacts under `data/learner-core/`, and `oewn-source-lock.json`.
- Produces: `selectCandidates(limit: number): Promise<Candidate[]>` where `Candidate = { word: string; wordId: number; ngslRank: number | null; oewnSenseCount: number; hasPronunciation: boolean }`, and worksheet CSVs under `data/learner-core/worksheets-<date>/`.

This is the pipeline, not the content. Every worksheet row is a *proposal* with source evidence attached and empty reviewer columns. Nothing is written to `learner_*` by this task.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/learner-overlay/select-candidates.spec.ts
import { rankCandidates } from './select-candidates';

describe('rankCandidates', () => {
  it('orders by NGSL rank first, then by OEWN sense availability', () => {
    const ranked = rankCandidates([
      { word: 'zebra', wordId: 3, ngslRank: null, oewnSenseCount: 5, hasPronunciation: true },
      { word: 'the', wordId: 1, ngslRank: 1, oewnSenseCount: 3, hasPronunciation: true },
      { word: 'quixotic', wordId: 2, ngslRank: null, oewnSenseCount: 1, hasPronunciation: false },
    ]);
    expect(ranked.map((c) => c.word)).toEqual(['the', 'zebra', 'quixotic']);
  });

  it('excludes words with no OEWN sense evidence', () => {
    const ranked = rankCandidates([
      { word: 'the', wordId: 1, ngslRank: 1, oewnSenseCount: 0, hasPronunciation: true },
    ]);
    expect(ranked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.scripts.config.js scripts/learner-overlay/select-candidates.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement selection and worksheet generation**

`rankCandidates` sorts NGSL-ranked words ascending by rank, then unranked words descending by `oewnSenseCount`, and drops any candidate with `oewnSenseCount === 0` — a word with no licensed sense evidence cannot be curated from OEWN and would only invite invention.

`build-worksheets.ts` emits, per candidate, one row per OEWN source sense with: `word`, `ngsl_rank`, `oewn_sense_id`, `oewn_definition_en`, `oewn_pronunciation_ipa`, `source_version` (from the lock file), `source_sha256`, and the empty reviewer columns `include_yn`, `vietnamese_meaning`, `cefr_level`, `example_en`, `example_vi`, `reviewer`, `notes`. Reuse `toCsvCell` from `scripts/export-review-queues.ts` (Task A4) so formula-injection guarding is identical.

Add `"overlay:candidates"` and `"overlay:worksheets"` to `package.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS.

- [ ] **Step 5: Generate the first 3,000-word batch**

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run overlay:worksheets -- --limit 3000
```

Confirm every emitted row carries a non-empty `source_version` and a 64-character `source_sha256`, and that all reviewer columns are empty. Spot-read twenty rows for sense quality.

- [ ] **Step 6: Commit**

```bash
git add scripts/learner-overlay package.json
git commit -m "feat(overlay): candidate selection and reviewer worksheets

Pipeline only. Every row is a proposal carrying OEWN source evidence and
empty reviewer columns; nothing is written to learner_* and nothing is
publishable without independent human bilingual approval."
```

---

### Task B4: Import OEWN pronunciations, forms and synonyms as draft learner rows

**Files:**
- Create: `scripts/learner-overlay/import-oewn-enrichment.ts`
- Create: `scripts/learner-overlay/import-oewn-enrichment.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Candidate[]` from B3 and the locked OEWN artifact.
- Produces: draft rows in `learner_pronunciations` only.

`data/raw/cmu-dict` and `data/raw/wordnet` are empty, so the legacy `word_forms` and `synonyms` tables cannot be repopulated from their original sources and stay at 0 — that is now a documented permanent state, not a gap to fill. OEWN supplies 43,534 pronunciations, 4,473 explicit forms and 355,064 relations, but only pronunciations map cleanly onto an existing learner table. Forms and synonyms need schema that does not exist yet; adding it is out of scope here and noted in Known Non-Goals.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/learner-overlay/import-oewn-enrichment.spec.ts
import { buildPronunciationRows } from './import-oewn-enrichment';

describe('buildPronunciationRows', () => {
  it('emits draft rows carrying full provenance', () => {
    const rows = buildPronunciationRows(
      [{ word: 'study', wordId: 42, ipa: '/ˈstʌdi/', accent: 'GB' }],
      { version: '2025-edition', sha256: 'a'.repeat(64) },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wordId: 42,
      ipa: '/ˈstʌdi/',
      accent: 'GB',
      reviewStatus: 'draft',
      source: 'oewn',
      sourceVersion: '2025-edition',
    });
    // Nothing may arrive pre-approved.
    expect(rows[0].reviewedBy).toBeNull();
    expect(rows[0].reviewedAt).toBeNull();
  });

  it('refuses to emit rows when the artifact digest is malformed', () => {
    expect(() =>
      buildPronunciationRows([{ word: 'study', wordId: 42, ipa: '/x/', accent: 'GB' }],
        { version: '2025-edition', sha256: 'not-a-digest' }),
    ).toThrow(/sha256/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.scripts.config.js scripts/learner-overlay/import-oewn-enrichment.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the importer**

`buildPronunciationRows(entries, artifact)` validates `artifact.sha256` against `/^[0-9a-f]{64}$/` and throws otherwise, then returns rows with `reviewStatus: 'draft'`, `reviewedBy: null`, `reviewedAt: null`, and the artifact version and digest attached. `main()` defaults to dry-run and requires `--write`, printing counts by accent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:scripts`
Expected: PASS.

- [ ] **Step 5: Rehearse, then import for the 3,000-word batch**

```sql
-- every imported row must be draft and unreviewed
select review_status, count(*) from learner_pronunciations group by 1;
select count(*) from learner_pronunciations where reviewed_by is not null; -- expect 0
```

- [ ] **Step 6: Commit**

```bash
git add scripts/learner-overlay/import-oewn-enrichment.ts \
        scripts/learner-overlay/import-oewn-enrichment.spec.ts package.json
git commit -m "feat(overlay): import OEWN pronunciations as draft learner rows"
```

---

# Phase C — Translation (paid API, per-run approval required)

**Nothing in this phase runs without explicit per-run approval.** Each run transmits English text to OpenRouter. No Vietnamese is ever transmitted: `prompts.ts` sends only `{id, word, pos, en}` for definitions and `{id, word, en}` for examples, so the unlicensed `tudien` Vietnamese never leaves the machine.

### Task C1: Switch to the paid model and rehearse

**Files:**
- Modify: `.env` (`OPENROUTER_MODEL`)
- Modify: `docs/provenance-and-licensing.md` (record the model and its data policy)

- [ ] **Step 1: Choose and record the model**

Set `OPENROUTER_MODEL` to a paid route and record in the policy document which model, its price per million tokens, and whether its data policy permits prompt retention. The current `nvidia/nemotron-3-super-120b-a12b:free` is the suspected origin of the CJK contamination and its free tier permits training on prompts.

- [ ] **Step 2: 50-row dry run, read every output**

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
  npx ts-node scripts/ai-translate/index.ts --type definitions --target cjk --dry-run --limit 50
```

Expected: 50 previews, no writes, and a rejection count near zero. A high rejection rate means the model is wrong for the job — change it before spending further.

- [ ] **Step 3: 200-row rehearsal write**

```bash
AI_TRANSLATE_PROGRESS_DB=/tmp/ai-translate-rehearsal.db \
DB_DATABASE=english_learning_rehearsal \
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
  npx ts-node scripts/ai-translate/index.ts --type definitions --target cjk --limit 200
```

```sql
-- the candidate count MUST fall by the number accepted, or the atomic flag
-- recompute is broken and the run can never terminate
select count(*) from definitions where 'vi_contains_cjk' = any(quality_flags);
select count(*) from definitions where is_learner_visible;  -- expect 0
```

Run the pilot twice with the same limit; the second run must select different rows.

### Task C2: Re-translate the 21,048 quarantined rows

- [ ] **Step 1: Confirm the backup still covers every flagged row**

```sql
select (select count(*) from definitions d where 'vi_contains_cjk'=any(d.quality_flags)
          and not exists (select 1 from cleanup_backup_cjk_translations b
                           where b.table_name='definitions' and b.row_id=d.id)) uncovered_defs,
       (select count(*) from examples e where 'vi_contains_cjk'=any(e.quality_flags)
          and not exists (select 1 from cleanup_backup_cjk_translations b
                           where b.table_name='examples' and b.row_id=e.id)) uncovered_ex;
```

Both must be 0 before any production write.

- [ ] **Step 2: Run definitions to completion, then examples**

Daily passes until each candidate count reaches 0. After each pass record the count and the per-reason rejection breakdown.

- [ ] **Step 3: Retry rejections once, then quarantine the residue**

```bash
npm run ai-translate -- --reset
```

Rows still flagged after a second pass are genuine model failures. Leave them flagged; do not null them and do not hand-edit them. Record the residual count.

### Task C3: Fill the 380 missing example translations and resolve the genuine echoes

- [ ] **Step 1: Extend the fetchers**

Add `fetchMissingVietnameseExamples` selecting `'missing_vi' = ANY(quality_flags)`, and `fetchEchoRows` joining `cleanup_review_vi_echoes` on `kind = 'needs_translation'`. Both mirror the existing CJK fetchers, including the `collect` helper and `--target` dispatch (`missing_vi`, `echo`).

- [ ] **Step 2: Run each target, verifying the flag falls**

The atomic recompute in `db-connector.ts` already clears `missing_vi` and `vi_equals_en` when the replacement text is clean, so both counts must fall as rows are repaired. If a count does not move, stop.

---

## Final verification (after any phase)

```sql
select 'definitions' t, count(*) from definitions
union all select 'examples', count(*) from examples
union all select 'empty_definition', count(*) from definitions where 'empty_definition'=any(quality_flags)
union all select 'example raw_markup', count(*) from examples where 'raw_markup'=any(quality_flags)
union all select 'cjk defs', count(*) from definitions where 'vi_contains_cjk'=any(quality_flags)
union all select 'cjk examples', count(*) from examples where 'vi_contains_cjk'=any(quality_flags)
union all select 'echo defs', count(*) from definitions where 'vi_equals_en'=any(quality_flags)
union all select 'missing_vi', count(*) from examples where 'missing_vi'=any(quality_flags)
union all select 'learner senses published', count(*) from learner_senses where status='published'
union all select 'ngsl ranked words', count(*) from words where ngsl_rank is not null
order by 1;
```

`learner senses published` must remain **0** until a human bilingual reviewer has approved content. Every other figure moves only in the direction its task predicts.

Also re-run the flag-independent CJK check, which does not trust `quality_flags`:

```sql
select count(*) from definitions
 where definition_vi ~ ('['||chr(12288)||'-'||chr(12351)||chr(13312)||'-'||chr(19903)
                        ||chr(19968)||'-'||chr(40959)||chr(63744)||'-'||chr(64255)
                        ||chr(65280)||'-'||chr(65519)||']')
   and not ('vi_contains_cjk' = any(quality_flags));
```

Must be 0.

## Known Non-Goals

- **Re-parsing the 12 GB Wiktionary dump** to recover the 35,953 lost definition bodies. Explicitly deferred; the raw XML remains on disk.
- **Repopulating legacy `word_forms` and `synonyms`.** `data/raw/cmu-dict` and `data/raw/wordnet` are empty and the sources are gone. OEWN carries forms and relations, but mapping them needs learner-side schema that does not exist; that is a separate design task.
- **Publishing any learner content.** This plan produces drafts and worksheets only.
- **Backfilling legacy `source` / `translation_method` / `translation_confidence`.** Still deferred; B1 constrains new published rows rather than inventing history for old ones.
- **Broadening frequency beyond NGSL's 2,809 words.** Needs a licensed corpus and a pinned checksum first.
- **Switching `ai-translate`'s ordering from `frequency_rank` to `ngsl_rank`.** Deliberate follow-up.
- **`example_too_long` (32,704 rows).** A presentation filter over legitimately long quotations, not corruption.
