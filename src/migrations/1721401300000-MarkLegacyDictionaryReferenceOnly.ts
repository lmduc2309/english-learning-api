import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The legacy definitions/examples tables are source evidence, not the reviewed
 * learner publication surface. Keep their rows available to the raw fallback
 * presenter, but make it impossible to mistake them for approved learner data.
 */
export class MarkLegacyDictionaryReferenceOnly1721401300000
  implements MigrationInterface
{
  name = 'MarkLegacyDictionaryReferenceOnly1721401300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "definitions" ALTER COLUMN "is_learner_visible" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "examples" ALTER COLUMN "is_learner_visible" SET DEFAULT false`,
    );

    // NOT VALID avoids an initial full-table validation while immediately
    // protecting new writes. The targeted updates repair existing rows before
    // the explicit validation scan.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_definitions_reference_only'
            AND conrelid = 'definitions'::regclass
        ) THEN
          ALTER TABLE "definitions"
            ADD CONSTRAINT "CHK_definitions_reference_only"
            CHECK ("is_learner_visible" = false) NOT VALID;
        END IF;
      END
      $$
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_examples_reference_only'
            AND conrelid = 'examples'::regclass
        ) THEN
          ALTER TABLE "examples"
            ADD CONSTRAINT "CHK_examples_reference_only"
            CHECK ("is_learner_visible" = false) NOT VALID;
        END IF;
      END
      $$
    `);

    await queryRunner.query(
      `UPDATE "definitions" SET "is_learner_visible" = false WHERE "is_learner_visible" = true`,
    );
    await queryRunner.query(
      `UPDATE "examples" SET "is_learner_visible" = false WHERE "is_learner_visible" = true`,
    );

    await queryRunner.query(
      `ALTER TABLE "definitions" VALIDATE CONSTRAINT "CHK_definitions_reference_only"`,
    );
    await queryRunner.query(
      `ALTER TABLE "examples" VALIDATE CONSTRAINT "CHK_examples_reference_only"`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "definitions"."is_learner_visible" IS 'Trust gate: legacy definitions are reference-only; reviewed learner content lives in learner_senses'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "examples"."is_learner_visible" IS 'Trust gate: legacy examples are reference-only; reviewed learner content lives in learner_examples'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "examples" DROP CONSTRAINT IF EXISTS "CHK_examples_reference_only"`,
    );
    await queryRunner.query(
      `ALTER TABLE "definitions" DROP CONSTRAINT IF EXISTS "CHK_definitions_reference_only"`,
    );

    // Deliberately retain the false defaults and repaired values. A rollback
    // must never promote unreviewed source material to trusted learner content.
  }
}
