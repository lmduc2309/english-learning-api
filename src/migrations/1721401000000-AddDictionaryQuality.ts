import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDictionaryQuality1721401000000 implements MigrationInterface {
  name = 'AddDictionaryQuality1721401000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "source" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "source_sense_id" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "translation_method" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "translation_confidence" real`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "review_status" varchar(24) NOT NULL DEFAULT 'raw'`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "quality_flags" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "definitions" ADD COLUMN IF NOT EXISTS "is_learner_visible" boolean NOT NULL DEFAULT true`);

    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "translation_method" varchar(40)`);
    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "translation_confidence" real`);
    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "review_status" varchar(24) NOT NULL DEFAULT 'raw'`);
    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "quality_flags" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "is_learner_visible" boolean NOT NULL DEFAULT true`);

    await queryRunner.query(`
      UPDATE definitions SET
        quality_flags = array_remove(ARRAY[
          CASE WHEN definition_vi IS NULL OR definition_vi !~ '\\S' THEN 'missing_vi' END,
          CASE WHEN definition_vi ~ '[一-龯㐀-䶿]' THEN 'vi_contains_cjk' END,
          CASE WHEN lower(trim(definition_vi)) = lower(trim(definition_en)) THEN 'vi_equals_en' END,
          CASE WHEN definition_en ~ '\\([^)]*\\|[^)]*\\)' OR definition_en ILIKE '%thumb|%' OR definition_en ~ '<[^>]+>' OR definition_en ~ '&(nbsp|emsp|ensp|lt|gt|amp|quot);' THEN 'raw_markup' END
        ]::text[], NULL),
        is_learner_visible = NOT (
          definition_vi IS NULL OR definition_vi !~ '\\S' OR
          definition_vi ~ '[一-龯㐀-䶿]' OR
          lower(trim(definition_vi)) = lower(trim(definition_en))
        )`);
    await queryRunner.query(`
      UPDATE examples SET
        quality_flags = array_remove(ARRAY[
          CASE WHEN example_vi IS NULL OR example_vi !~ '\\S' THEN 'missing_vi' END,
          CASE WHEN example_vi ~ '[一-龯㐀-䶿]' THEN 'vi_contains_cjk' END,
          CASE WHEN lower(trim(example_vi)) = lower(trim(example_en)) THEN 'vi_equals_en' END,
          CASE WHEN length(example_en) > 300 THEN 'example_too_long' END
        ]::text[], NULL),
        is_learner_visible = NOT (
          example_vi IS NULL OR example_vi !~ '\\S' OR
          example_vi ~ '[一-龯㐀-䶿]' OR
          lower(trim(example_vi)) = lower(trim(example_en)) OR
          length(example_en) > 300
        )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_definitions_learner_visible" ON "definitions" ("word_id", "is_learner_visible")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_examples_learner_visible" ON "examples" ("definition_id", "is_learner_visible")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_examples_learner_visible"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_definitions_learner_visible"`);
    await queryRunner.query(`ALTER TABLE "examples" DROP COLUMN IF EXISTS "is_learner_visible", DROP COLUMN IF EXISTS "quality_flags", DROP COLUMN IF EXISTS "review_status", DROP COLUMN IF EXISTS "translation_confidence", DROP COLUMN IF EXISTS "translation_method"`);
    await queryRunner.query(`ALTER TABLE "definitions" DROP COLUMN IF EXISTS "is_learner_visible", DROP COLUMN IF EXISTS "quality_flags", DROP COLUMN IF EXISTS "review_status", DROP COLUMN IF EXISTS "translation_confidence", DROP COLUMN IF EXISTS "translation_method", DROP COLUMN IF EXISTS "source_sense_id", DROP COLUMN IF EXISTS "source"`);
  }
}
