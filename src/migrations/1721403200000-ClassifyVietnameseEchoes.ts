import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sorts vi_equals_en rows into what they actually are, so only genuine
 * translation failures reach the paid API.
 *
 * An echo is not one defect. Symbol-only entries (`' + '`) and single
 * capitalised words (`Acclivous`) are frequently identical in both languages
 * by design; queueing them wastes quota and invites the model to invent
 * Vietnamese for a proper noun. Only `needs_translation` is real work.
 *
 * This migration changes no corpus text. It writes a retained report that the
 * translation targets and the CSV exporter both read.
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

    await queryRunner.query(
      `CREATE INDEX "IDX_review_vi_echoes_kind" ON "cleanup_review_vi_echoes" ("kind")`);

    // Fail closed: every flagged row must be classified exactly once.
    await queryRunner.query(`
      DO $$
      DECLARE flagged bigint; classified bigint;
      BEGIN
        SELECT (SELECT count(*) FROM "definitions" WHERE 'vi_equals_en' = ANY("quality_flags"))
             + (SELECT count(*) FROM "examples" WHERE 'vi_equals_en' = ANY("quality_flags"))
          INTO flagged;
        SELECT count(*) INTO classified FROM "cleanup_review_vi_echoes";
        IF flagged <> classified THEN
          RAISE EXCEPTION 'classified % of % flagged echo rows', classified, flagged;
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_review_vi_echoes"`);
  }
}
