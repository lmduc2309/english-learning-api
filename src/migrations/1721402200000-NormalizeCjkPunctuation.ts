import { MigrationInterface, QueryRunner } from 'typeorm';

// Ideograph ranges only (U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF). Built from
// chr() rather than literal boundary characters, matching the convention in
// ExpandDictionaryCjkQuality and scripts/clean-cjk.ts. Used to SELECT rows.
const PG_IDEOGRAPHS =
  `('[' || chr(13312) || '-' || chr(19903) || chr(19968) || '-' || chr(40959) ||` +
  ` chr(63744) || '-' || chr(64255) || ']')`;

// The FULL flag range, identical to CJK_RE in dictionary-quality.ts and to the
// pgCjk in ExpandDictionaryCjkQuality: CJK punctuation, extensions, unified and
// compatibility ideographs, and halfwidth/fullwidth forms. The flag may only be
// cleared when the POST-translation value fails to match this.
const PG_CJK_FULL =
  `('[' || chr(12288) || '-' || chr(12351) || chr(13312) || '-' || chr(19903) ||` +
  ` chr(19968) || '-' || chr(40959) || chr(63744) || '-' || chr(64255) ||` +
  ` chr(65280) || '-' || chr(65519) || ']')`;

// Characters translated to their ASCII equivalents. The first eight are the
// common sentence punctuation; the remaining six were found by scanning the
// actual punctuation-only rows and are the only other flag-range characters
// present in them:
//   U+3002 。  U+3001 、  U+FF0C ，  U+FF01 ！  U+FF1F ？  U+FF1A ：
//   U+FF1B ；  U+3000 ideographic space
//   U+FF0A ＊  U+FF08 （  U+FF09 ）  U+FF03 ＃  U+300C 「  U+300D 」
// This list does NOT have to be exhaustive - the conditional flag clear below
// is what guarantees correctness. Anything missed keeps its flag and flows to
// the re-translation task instead of being silently mislabelled as clean.
const FROM_CHARS =
  `chr(12290) || chr(12289) || chr(65292) || chr(65281) || chr(65311) || chr(65306) ||` +
  ` chr(65307) || chr(12288) || chr(65290) || chr(65288) || chr(65289) || chr(65283) ||` +
  ` chr(12300) || chr(12301)`;
const TO_CHARS = `'.,,!?:; *()#""'`;

/**
 * Replaces CJK punctuation with ASCII in Vietnamese that is otherwise clean.
 *
 * `npm run clean-cjk` would NULL these fields instead, destroying good
 * Vietnamese whose only offence is an ideographic full stop.
 */
export class NormalizeCjkPunctuation1721402200000 implements MigrationInterface {
  name = 'NormalizeCjkPunctuation1721402200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Refuse to run on top of a stale snapshot. A partial backup left by a
    // failed run must never be silently reused as the rollback source.
    for (const table of [
      'cleanup_backup_cjk_punctuation',
      'cleanup_backup_cjk_punct_examples_deleted',
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_cjk_punctuation" (
        "table_name" text NOT NULL,
        "row_id" bigint NOT NULL,
        "text_value" text,
        "quality_flags" text[],
        PRIMARY KEY ("table_name", "row_id"))`);
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_cjk_punct_examples_deleted"
        (LIKE "examples" INCLUDING ALL)`);

    await queryRunner.query(`
      INSERT INTO "cleanup_backup_cjk_punctuation"
      SELECT 'definitions', "id", "definition_vi", "quality_flags"
        FROM "definitions"
       WHERE 'vi_contains_cjk' = ANY("quality_flags")
         AND "definition_vi" !~ ${PG_IDEOGRAPHS}`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_cjk_punctuation"
      SELECT 'examples', "id", "example_vi", "quality_flags"
        FROM "examples"
       WHERE 'vi_contains_cjk' = ANY("quality_flags")
         AND "example_vi" !~ ${PG_IDEOGRAPHS}`);

    // Normalizing example_vi can make two rows identical under
    // UQ_examples_definition_digest, which includes md5(example_vi). Seven such
    // pairs exist: same English, Vietnamese differing only by CJK versus ASCII
    // punctuation. They were always duplicates; Task 3 could not see it because
    // the punctuation differed. Release the index for the rewrite, collapse
    // them, and restore it.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);

    // Clear the flag ONLY when the post-translation value is genuinely free of
    // every flag-range character. Both SET expressions read the pre-UPDATE row,
    // so the CASE evaluates the same normalized text that is being written.
    // Rows that still contain something in range keep vi_contains_cjk and are
    // picked up by the re-translation task rather than mislabelled as clean.
    await queryRunner.query(`
      UPDATE "definitions"
         SET "definition_vi" = btrim(translate("definition_vi", ${FROM_CHARS}, ${TO_CHARS})),
             "quality_flags" = CASE
               WHEN btrim(translate("definition_vi", ${FROM_CHARS}, ${TO_CHARS})) ~ ${PG_CJK_FULL}
                 THEN "quality_flags"
               ELSE array_remove("quality_flags", 'vi_contains_cjk')
             END
       WHERE 'vi_contains_cjk' = ANY("quality_flags")
         AND "definition_vi" !~ ${PG_IDEOGRAPHS}`);
    await queryRunner.query(`
      UPDATE "examples"
         SET "example_vi" = btrim(translate("example_vi", ${FROM_CHARS}, ${TO_CHARS})),
             "quality_flags" = CASE
               WHEN btrim(translate("example_vi", ${FROM_CHARS}, ${TO_CHARS})) ~ ${PG_CJK_FULL}
                 THEN "quality_flags"
               ELSE array_remove("quality_flags", 'vi_contains_cjk')
             END
       WHERE 'vi_contains_cjk' = ANY("quality_flags")
         AND "example_vi" !~ ${PG_IDEOGRAPHS}`);

    // Collapse the rows that normalization just made identical, preserving the
    // lowest id, and back them up first so down() can restore them.
    await queryRunner.query(`
      CREATE TABLE "cleanup_cjk_punct_example_keep" AS
      SELECT min("id") AS "id" FROM "examples"
       GROUP BY "definition_id", md5("example_en"), md5(COALESCE("example_vi", ''))`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_cjk_punct_example_keep" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_cjk_punct_example_keep"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_cjk_punct_examples_deleted"
      SELECT e.* FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_cjk_punct_example_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`
      DELETE FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_cjk_punct_example_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`DROP TABLE "cleanup_cjk_punct_example_keep"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    // The example set changed, so the derived report must be rebuilt.
    await queryRunner.query(`DELETE FROM "cleanup_review_example_vi_conflicts"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_review_example_vi_conflicts"
        ("definition_id", "example_en_digest", "example_ids", "variant_count")
      SELECT "definition_id", md5("example_en"), array_agg("id" ORDER BY "id"), count(*)
        FROM "examples"
       GROUP BY "definition_id", md5("example_en")
      HAVING count(*) > 1`);

    // Fail closed: no row may end up carrying flag-range text without the flag.
    await queryRunner.query(`
      DO $$
      DECLARE unflagged bigint;
      BEGIN
        SELECT (SELECT count(*) FROM "definitions"
                 WHERE "definition_vi" ~ ${PG_CJK_FULL}
                   AND NOT ('vi_contains_cjk' = ANY("quality_flags")))
             + (SELECT count(*) FROM "examples"
                 WHERE "example_vi" ~ ${PG_CJK_FULL}
                   AND NOT ('vi_contains_cjk' = ANY("quality_flags")))
          INTO unflagged;
        IF unflagged > 0 THEN
          RAISE EXCEPTION '% row(s) contain CJK but lost the flag; aborting', unflagged;
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Release the index first: restoring pre-normalization text reintroduces
    // the very rows whose digests collided.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);

    await queryRunner.query(`
      UPDATE "definitions" d
         SET "definition_vi" = b."text_value", "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_cjk_punctuation" b
       WHERE b."table_name" = 'definitions' AND d."id" = b."row_id"`);

    // Re-insert the collapsed rows BEFORE restoring text. They were snapshotted
    // after normalization, so they carry normalized Vietnamese. Their surviving
    // twin was frequently never flagged at all — its punctuation was already
    // ASCII — so restoring text first and inserting second reproduces the exact
    // digest collision that caused the collapse, and the index rebuild fails.
    // Inserting first lets the restore below cover these rows too.
    await queryRunner.query(`
      INSERT INTO "examples"
      SELECT * FROM "cleanup_backup_cjk_punct_examples_deleted"`);
    await queryRunner.query(`
      SELECT setval(pg_get_serial_sequence('examples','id'),
                    (SELECT max("id") FROM "examples"), true)`);

    await queryRunner.query(`
      UPDATE "examples" e
         SET "example_vi" = b."text_value", "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_cjk_punctuation" b
       WHERE b."table_name" = 'examples' AND e."id" = b."row_id"`);

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

    await queryRunner.query(
      `DROP TABLE IF EXISTS "cleanup_backup_cjk_punct_examples_deleted"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_cjk_punctuation"`);
  }
}
