import { MigrationInterface, QueryRunner } from 'typeorm';

// Mirrors RAW_MARKUP_RE in src/dictionary/dictionary-quality.ts. MUST be
// String.raw — a plain template literal strips the backslashes and the regex
// silently changes meaning while still parsing.
const PG_RAW_MARKUP =
  String.raw`(\([^)]*\|[^)]*\)|thumb\||<[^>]+>|&(nbsp|emsp|ensp|lt|gt|amp|quot);|\{\{|\}\})`;

/**
 * Expands Wiktionary pipe labels in definition_en: `(transitive|archaic)`
 * becomes `(transitive, archaic)`. 92,864 rows carry the flag after Task 3.
 *
 * definition_en cannot be updated in place while UQ_definitions_word_text
 * exists, because two different markup strings for the same word can normalize
 * to the same text and PostgreSQL enforces the index during the statement. The
 * transformation is therefore computed into a stage table, collisions resolved,
 * and only then written with the index dropped.
 *
 * On the live corpus the normalization produces zero collisions, so the remap
 * and delete phases are no-ops there. They are retained because that is a
 * property of the current data, not of the transformation.
 *
 * dictionary-presenter.ts drops any definition carrying raw_markup, so clearing
 * the flag makes roughly 13% of the corpus visible to clients for the first
 * time. That is intended.
 */
export class NormalizeRawMarkupDefinitions1721402100000 implements MigrationInterface {
  name = 'NormalizeRawMarkupDefinitions1721402100000';

  private static readonly SNAPSHOTS = [
    'cleanup_definition_markup_stage',
    'cleanup_definition_markup_keep',
    'cleanup_backup_definitions_markup',
    'cleanup_backup_definitions_markup_deleted',
    'cleanup_backup_examples_markup',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 0. Refuse to run on top of a stale snapshot.
    for (const table of NormalizeRawMarkupDefinitions1721402100000.SNAPSHOTS) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

    // 1. Normalizer as a session-local function, so the loop is expressed once.
    await queryRunner.query(String.raw`
      CREATE FUNCTION pg_temp.cleanup_normalize_markup(src text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE out text := src; prev text;
      BEGIN
        -- One pass clears one pipe per parenthesised group; groups hold up to
        -- 18 pipes, so iterate until the text stops changing.
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

    // 2. Stage the normalized text. Nothing in definitions changes yet.
    await queryRunner.query(`
      CREATE TABLE "cleanup_definition_markup_stage" AS
      SELECT d."id", d."word_id", d."definition_en" AS original_en,
             pg_temp.cleanup_normalize_markup(d."definition_en") AS normalized_en
        FROM "definitions" d
       WHERE d."definition_en" ~ '${PG_RAW_MARKUP}'`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_definition_markup_stage" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_definition_markup_stage"`);

    // 3. Resolve collisions across ALL definitions of every affected word — a
    //    normalized string can collide with an already-clean sibling, not just
    //    with another staged row.
    await queryRunner.query(`
      CREATE TABLE "cleanup_definition_markup_keep" AS
      WITH final AS (
        SELECT d."id", d."word_id",
               COALESCE(s.normalized_en, d."definition_en") AS final_en
          FROM "definitions" d
          LEFT JOIN "cleanup_definition_markup_stage" s ON s."id" = d."id"
         WHERE d."word_id" IN (SELECT "word_id" FROM "cleanup_definition_markup_stage")
      )
      SELECT "id" AS old_id,
             min("id") OVER (PARTITION BY "word_id", final_en) AS keep_id
        FROM final`);
    await queryRunner.query(`
      DELETE FROM "cleanup_definition_markup_keep" WHERE old_id = keep_id`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_definition_markup_keep" ADD PRIMARY KEY (old_id)`);
    await queryRunner.query(`ANALYZE "cleanup_definition_markup_keep"`);

    // 4. Back up every definition whose text changes, every definition that
    //    will be deleted, and every example attached to either side of a
    //    collision.
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_definitions_markup" AS
      SELECT "id", "definition_en", "quality_flags"
        FROM "definitions"
       WHERE "id" IN (SELECT "id" FROM "cleanup_definition_markup_stage")`);
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_definitions_markup_deleted"
        (LIKE "definitions" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_definitions_markup_deleted"
      SELECT d.* FROM "definitions" d
       WHERE d."id" IN (SELECT old_id FROM "cleanup_definition_markup_keep")`);
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_examples_markup" (LIKE "examples" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_examples_markup"
      SELECT e.* FROM "examples" e
       WHERE e."definition_id" IN (SELECT old_id FROM "cleanup_definition_markup_keep")
          OR e."definition_id" IN (SELECT keep_id FROM "cleanup_definition_markup_keep")`);

    // 5. Release both constraints for the rewrite window.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_definitions_word_text"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);

    // 6. Cascade-safe: move examples off doomed definitions BEFORE deleting.
    await queryRunner.query(`
      UPDATE "examples" e
         SET "definition_id" = k.keep_id
        FROM "cleanup_definition_markup_keep" k
       WHERE e."definition_id" = k.old_id`);

    // 7. Remove examples that are now exact duplicates in BOTH languages.
    //    Task 3 already enforced this key, so the only duplicates possible here
    //    are the ones the remap above just created. NOT IN against a large
    //    subquery is pathological at this scale; use a keyed anti-join.
    await queryRunner.query(`
      CREATE TABLE "cleanup_example_keep_markup" AS
      SELECT min("id") AS "id" FROM "examples"
       GROUP BY "definition_id", md5("example_en"), md5(COALESCE("example_vi", ''))`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_example_keep_markup" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_example_keep_markup"`);
    // Top up the backup with anything about to be deleted that is not already
    // captured, so down() cannot silently restore a short table.
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_examples_markup"
      SELECT e.* FROM "examples" e
       WHERE NOT EXISTS (
             SELECT 1 FROM "cleanup_example_keep_markup" k WHERE k."id" = e."id")
         AND NOT EXISTS (
             SELECT 1 FROM "cleanup_backup_examples_markup" b WHERE b."id" = e."id")`);
    await queryRunner.query(`
      DELETE FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_example_keep_markup" k WHERE k."id" = e."id")`);
    await queryRunner.query(`DROP TABLE "cleanup_example_keep_markup"`);

    // 8. The doomed definitions now carry no examples.
    await queryRunner.query(`
      DELETE FROM "definitions"
       WHERE "id" IN (SELECT old_id FROM "cleanup_definition_markup_keep")`);

    // 9. Write the normalized text to the retained rows.
    await queryRunner.query(`
      UPDATE "definitions" d
         SET "definition_en" = s.normalized_en
        FROM "cleanup_definition_markup_stage" s
       WHERE d."id" = s."id" AND d."definition_en" <> s.normalized_en`);

    // 10. Restore both constraints. These fail loudly if any step above left a
    //     collision behind, which is the desired outcome.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_definitions_word_text"
        ON "definitions" ("word_id", "definition_en")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    // 11. Clear the flag only where no markup pattern survives.
    await queryRunner.query(`
      UPDATE "definitions"
         SET "quality_flags" = array_remove("quality_flags", 'raw_markup')
       WHERE 'raw_markup' = ANY("quality_flags")
         AND "definition_en" !~ '${PG_RAW_MARKUP}'`);

    // 12. Rebuild the derived review report. Do not append: remapping and
    //     deletion can make Task 3's stored example_ids and counts stale.
    await queryRunner.query(`DELETE FROM "cleanup_review_example_vi_conflicts"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_review_example_vi_conflicts"
        ("definition_id", "example_en_digest", "example_ids", "variant_count")
      SELECT "definition_id", md5("example_en"), array_agg("id" ORDER BY "id"), count(*)
        FROM "examples"
       GROUP BY "definition_id", md5("example_en")
      HAVING count(*) > 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_definitions_word_text"`);

    // Restore text and flags on rows that were edited.
    await queryRunner.query(`
      UPDATE "definitions" d
         SET "definition_en" = b."definition_en",
             "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_definitions_markup" b
       WHERE d."id" = b."id"`);

    // Re-insert deleted definitions before their examples, to satisfy the FK.
    await queryRunner.query(`
      INSERT INTO "definitions"
      SELECT * FROM "cleanup_backup_definitions_markup_deleted"`);

    // Replace the whole affected example set rather than patching it.
    await queryRunner.query(`
      DELETE FROM "examples"
       WHERE "id" IN (SELECT "id" FROM "cleanup_backup_examples_markup")`);
    await queryRunner.query(`
      INSERT INTO "examples" SELECT * FROM "cleanup_backup_examples_markup"`);

    // Explicit ids were inserted, so the sequences must be advanced.
    for (const table of ['definitions', 'examples']) {
      await queryRunner.query(`
        SELECT setval(pg_get_serial_sequence('${table}','id'),
                      (SELECT max("id") FROM "${table}"), true)`);
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_definitions_word_text"
        ON "definitions" ("word_id", "definition_en")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    // The report is derived; rebuild it from the restored data.
    await queryRunner.query(`DELETE FROM "cleanup_review_example_vi_conflicts"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_review_example_vi_conflicts"
        ("definition_id", "example_en_digest", "example_ids", "variant_count")
      SELECT "definition_id", md5("example_en"), array_agg("id" ORDER BY "id"), count(*)
        FROM "examples"
       GROUP BY "definition_id", md5("example_en")
      HAVING count(*) > 1`);

    for (const table of [
      'cleanup_definition_markup_keep',
      'cleanup_definition_markup_stage',
      'cleanup_backup_examples_markup',
      'cleanup_backup_definitions_markup_deleted',
      'cleanup_backup_definitions_markup',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
