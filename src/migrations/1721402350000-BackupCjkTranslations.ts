import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Takes an exact rollback snapshot before the AI translator overwrites legacy
 * Vietnamese text. The translator also updates flags, review status, and the
 * visibility guard, so all four values belong in the snapshot.
 */
export class BackupCjkTranslations1721402350000
  implements MigrationInterface
{
  name = 'BackupCjkTranslations1721402350000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cleanup_backup_cjk_translations') IS NOT NULL THEN
          RAISE EXCEPTION 'stale snapshot cleanup_backup_cjk_translations exists; review and drop it before re-running';
        END IF;
      END $$;`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_cjk_translations" (
        "table_name" text NOT NULL,
        "row_id" bigint NOT NULL,
        "text_value" text,
        "quality_flags" text[] NOT NULL,
        "review_status" varchar(24) NOT NULL,
        "is_learner_visible" boolean NOT NULL,
        "backed_up_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("table_name", "row_id")
      )`);

    await queryRunner.query(`
      INSERT INTO "cleanup_backup_cjk_translations"
        ("table_name", "row_id", "text_value", "quality_flags",
         "review_status", "is_learner_visible")
      SELECT 'definitions', "id", "definition_vi", "quality_flags",
             "review_status", "is_learner_visible"
        FROM "definitions"
       WHERE 'vi_contains_cjk' = ANY("quality_flags")`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_cjk_translations"
        ("table_name", "row_id", "text_value", "quality_flags",
         "review_status", "is_learner_visible")
      SELECT 'examples', "id", "example_vi", "quality_flags",
             "review_status", "is_learner_visible"
        FROM "examples"
       WHERE 'vi_contains_cjk' = ANY("quality_flags")`);

    // Compare against the source predicates rather than a historical constant:
    // earlier cascade-safe dedupe changes which contaminated example rows survive.
    await queryRunner.query(`
      DO $$
      DECLARE backed_up bigint; expected bigint;
      BEGIN
        SELECT count(*) INTO backed_up
          FROM "cleanup_backup_cjk_translations";
        SELECT
          (SELECT count(*) FROM "definitions"
            WHERE 'vi_contains_cjk' = ANY("quality_flags"))
          +
          (SELECT count(*) FROM "examples"
            WHERE 'vi_contains_cjk' = ANY("quality_flags"))
          INTO expected;
        IF backed_up <> expected THEN
          RAISE EXCEPTION 'incomplete CJK translation snapshot: backed up %, expected %',
            backed_up, expected;
        END IF;
      END $$;`);

    await queryRunner.query(`ANALYZE "cleanup_backup_cjk_translations"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "definitions" d
         SET "definition_vi" = b."text_value",
             "quality_flags" = b."quality_flags",
             "review_status" = b."review_status",
             "is_learner_visible" = b."is_learner_visible"
        FROM "cleanup_backup_cjk_translations" b
       WHERE b."table_name" = 'definitions' AND d."id" = b."row_id"`);
    await queryRunner.query(`
      UPDATE "examples" e
         SET "example_vi" = b."text_value",
             "quality_flags" = b."quality_flags",
             "review_status" = b."review_status",
             "is_learner_visible" = b."is_learner_visible"
        FROM "cleanup_backup_cjk_translations" b
       WHERE b."table_name" = 'examples' AND e."id" = b."row_id"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "cleanup_backup_cjk_translations"`,
    );
  }
}
