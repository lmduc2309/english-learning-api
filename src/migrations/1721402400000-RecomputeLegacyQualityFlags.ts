import { MigrationInterface, QueryRunner } from 'typeorm';

const PG_CJK =
  `('[' || chr(12288) || '-' || chr(12351) || chr(13312) || '-' || chr(19903) ||` +
  ` chr(19968) || '-' || chr(40959) || chr(63744) || '-' || chr(64255) ||` +
  ` chr(65280) || '-' || chr(65519) || ']')`;
const PG_RAW_MARKUP =
  String.raw`(\([^)]*\|[^)]*\)|thumb\||<[^>]+>|&(nbsp|emsp|ensp|lt|gt|amp|quot);|\{\{|\}\})`;
const PG_EMPTY_DEFINITION = String.raw`^(\([^)]*\)[[:space:]]*)?\.?$`;

/** Rebuilds stored legacy flags from the same source fields used at runtime. */
export class RecomputeLegacyQualityFlags1721402400000
  implements MigrationInterface
{
  name = 'RecomputeLegacyQualityFlags1721402400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cleanup_backup_quality_flags') IS NOT NULL THEN
          RAISE EXCEPTION 'stale snapshot cleanup_backup_quality_flags exists; review and drop it before re-running';
        END IF;
      END $$;`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_quality_flags" (
        "table_name" text NOT NULL,
        "row_id" bigint NOT NULL,
        "quality_flags" text[] NOT NULL,
        PRIMARY KEY ("table_name", "row_id")
      )`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_quality_flags"
      SELECT 'definitions', "id", "quality_flags" FROM "definitions"`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_quality_flags"
      SELECT 'examples', "id", "quality_flags" FROM "examples"`);

    await queryRunner.query(`
      DO $$
      DECLARE backed_up bigint; expected bigint;
      BEGIN
        SELECT count(*) INTO backed_up FROM "cleanup_backup_quality_flags";
        SELECT (SELECT count(*) FROM "definitions")
             + (SELECT count(*) FROM "examples") INTO expected;
        IF backed_up <> expected THEN
          RAISE EXCEPTION 'incomplete flag snapshot: backed up %, expected %',
            backed_up, expected;
        END IF;
      END $$;`);

    await queryRunner.query(`
      UPDATE "definitions" SET "quality_flags" = (
        SELECT coalesce(array_agg(f), ARRAY[]::text[]) FROM (
          SELECT 'empty_definition'::text AS f
            WHERE btrim("definition_en") = ''
               OR btrim("definition_en") ~ '${PG_EMPTY_DEFINITION}'
          UNION ALL SELECT 'missing_vi'
            WHERE "definition_vi" IS NULL OR btrim("definition_vi") = ''
          UNION ALL SELECT 'vi_contains_cjk'
            WHERE "definition_vi" ~ ${PG_CJK}
          UNION ALL SELECT 'vi_equals_en'
            WHERE lower(btrim("definition_vi")) = lower(btrim("definition_en"))
          UNION ALL SELECT 'raw_markup'
            WHERE "definition_en" ~ '${PG_RAW_MARKUP}'
        ) flags
      )`);

    await queryRunner.query(`
      UPDATE "examples" SET "quality_flags" = (
        SELECT coalesce(array_agg(f), ARRAY[]::text[]) FROM (
          SELECT 'empty_definition'::text AS f
            WHERE btrim("example_en") = ''
               OR btrim("example_en") ~ '${PG_EMPTY_DEFINITION}'
          UNION ALL SELECT 'missing_vi'
            WHERE "example_vi" IS NULL OR btrim("example_vi") = ''
          UNION ALL SELECT 'vi_contains_cjk'
            WHERE "example_vi" ~ ${PG_CJK}
          UNION ALL SELECT 'vi_equals_en'
            WHERE lower(btrim("example_vi")) = lower(btrim("example_en"))
          UNION ALL SELECT 'raw_markup'
            WHERE "example_en" ~ '${PG_RAW_MARKUP}'
          UNION ALL SELECT 'example_too_long'
            WHERE length("example_en") > 300
        ) flags
      )`);

    await queryRunner.query(`
      DO $$
      DECLARE empty_count bigint;
      BEGIN
        SELECT count(*) INTO empty_count FROM "definitions"
         WHERE 'empty_definition' = ANY("quality_flags");
        IF empty_count > 60000 THEN
          RAISE EXCEPTION 'empty_definition sanity bound exceeded: %', empty_count;
        END IF;
      END $$;`);
    await queryRunner.query(`ANALYZE "definitions", "examples"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "definitions" d SET "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_quality_flags" b
       WHERE b."table_name" = 'definitions' AND d."id" = b."row_id"`);
    await queryRunner.query(`
      UPDATE "examples" e SET "quality_flags" = b."quality_flags"
        FROM "cleanup_backup_quality_flags" b
       WHERE b."table_name" = 'examples' AND e."id" = b."row_id"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "cleanup_backup_quality_flags"`,
    );
  }
}
