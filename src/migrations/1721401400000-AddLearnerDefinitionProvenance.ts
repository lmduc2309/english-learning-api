import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pins curated English definitions to an exact source release and artifact.
 *
 * The columns are nullable so existing draft and published rows are preserved
 * without fabricating provenance. The NOT VALID publication constraint applies
 * immediately to new/updated rows while allowing legacy published rows to stay
 * readable until they are re-curated with genuine source metadata.
 */
export class AddLearnerDefinitionProvenance1721401400000
  implements MigrationInterface
{
  name = 'AddLearnerDefinitionProvenance1721401400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        ADD COLUMN IF NOT EXISTS "definition_source_version" varchar(40),
        ADD COLUMN IF NOT EXISTS "definition_source_artifact_sha256" varchar(64)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_learner_sense_definition_provenance'
            AND conrelid = 'learner_senses'::regclass
        ) THEN
          ALTER TABLE "learner_senses"
            ADD CONSTRAINT "CHK_learner_sense_definition_provenance"
            CHECK (
              ("definition_source_version" IS NULL AND "definition_source_artifact_sha256" IS NULL)
              OR (
                "definition_source_version" IS NOT NULL
                AND length(btrim("definition_source_version")) > 0
                AND "definition_source_artifact_sha256" IS NOT NULL
                AND "definition_source_artifact_sha256" ~ '^[0-9a-f]{64}$'
              )
            ) NOT VALID;
        END IF;
      END
      $$
    `);
    await queryRunner.query(
      `ALTER TABLE "learner_senses" VALIDATE CONSTRAINT "CHK_learner_sense_definition_provenance"`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_learner_sense_published_definition_provenance'
            AND conrelid = 'learner_senses'::regclass
        ) THEN
          ALTER TABLE "learner_senses"
            ADD CONSTRAINT "CHK_learner_sense_published_definition_provenance"
            CHECK (
              "status" <> 'published'
              OR (
                "definition_source_version" IS NOT NULL
                AND length(btrim("definition_source_version")) > 0
                AND "definition_source_artifact_sha256" IS NOT NULL
                AND "definition_source_artifact_sha256" ~ '^[0-9a-f]{64}$'
              )
            ) NOT VALID;
        END IF;
      END
      $$
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN "learner_senses"."definition_source_version" IS 'Exact release/version of the English definition source used for this learner sense'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "learner_senses"."definition_source_artifact_sha256" IS 'Lowercase SHA-256 of the exact English definition source artifact used for this learner sense'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "learner_senses" DROP CONSTRAINT IF EXISTS "CHK_learner_sense_published_definition_provenance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "learner_senses" DROP CONSTRAINT IF EXISTS "CHK_learner_sense_definition_provenance"`,
    );
    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        DROP COLUMN IF EXISTS "definition_source_artifact_sha256",
        DROP COLUMN IF EXISTS "definition_source_version"
    `);
  }
}
