import { MigrationInterface, QueryRunner } from 'typeorm';

// Mirrors RAW_MARKUP_RE in src/dictionary/dictionary-quality.ts. MUST be
// String.raw — a plain template literal strips the backslashes and the regex
// silently changes meaning while still parsing.
const PG_RAW_MARKUP =
  String.raw`(\([^)]*\|[^)]*\)|thumb\||<[^>]+>|&(nbsp|emsp|ensp|lt|gt|amp|quot);|\{\{|\}\})`;

/**
 * Applies the definition-side markup normalizer to example_en.
 *
 * NormalizeRawMarkupDefinitions cleaned definition_en and never touched
 * examples, leaving 2,281 rows flagged raw_markup: 2,224 HTML entities, 42
 * brace pairs, 16 pipe-parens, 1 `thumb|`.
 *
 * dictionary-presenter.ts drops any example carrying raw_markup, so clearing
 * the flag makes these examples visible to clients for the first time.
 */
export class NormalizeExampleMarkup1721403100000 implements MigrationInterface {
  name = 'NormalizeExampleMarkup1721403100000';

  private static readonly SNAPSHOTS = [
    'cleanup_backup_examples_markup_text',
    'cleanup_backup_examples_markup_deleted',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of NormalizeExampleMarkup1721403100000.SNAPSHOTS) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

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
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_examples_markup_deleted" (LIKE "examples" INCLUDING ALL)`);

    // Rewriting example_en changes md5(example_en), which the unique index
    // covers. Release it for the rewrite, collapse anything that becomes a
    // duplicate, then restore it.
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
      INSERT INTO "cleanup_backup_examples_markup_deleted"
      SELECT e.* FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_example_markup_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`
      DELETE FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_example_markup_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`DROP TABLE "cleanup_example_markup_keep"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    await queryRunner.query(`
      UPDATE "examples"
         SET "quality_flags" = array_remove("quality_flags", 'raw_markup')
       WHERE 'raw_markup' = ANY("quality_flags")
         AND "example_en" !~ '${PG_RAW_MARKUP}'`);

    // The example set may have changed, so the derived report must be rebuilt.
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

    // Collapsed rows were snapshotted after the rewrite, so they carry
    // normalized English. Re-insert them BEFORE restoring text, or the restore
    // skips them and the index rebuild hits the original collision.
    await queryRunner.query(`
      INSERT INTO "examples" SELECT * FROM "cleanup_backup_examples_markup_deleted"`);
    await queryRunner.query(`
      SELECT setval(pg_get_serial_sequence('examples','id'),
                    (SELECT max("id") FROM "examples"), true)`);

    await queryRunner.query(`
      UPDATE "examples" e
         SET "example_en" = b."example_en", "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_examples_markup_text" b
       WHERE e."id" = b."id"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    await queryRunner.query(`DELETE FROM "cleanup_review_example_vi_conflicts"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_review_example_vi_conflicts"
        ("definition_id", "example_en_digest", "example_ids", "variant_count")
      SELECT "definition_id", md5("example_en"), array_agg("id" ORDER BY "id"), count(*)
        FROM "examples"
       GROUP BY "definition_id", md5("example_en")
      HAVING count(*) > 1`);

    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_examples_markup_deleted"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_examples_markup_text"`);
  }
}
