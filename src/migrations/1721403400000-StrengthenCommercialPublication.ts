import { MigrationInterface, QueryRunner } from 'typeorm';

const OEWN_2025_SHA256 =
  '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe';

/**
 * Makes the commercial publication boundary durable after publication.
 *
 * The earlier sense trigger checked for an approved Vietnamese translation
 * only when the sense was published. This migration also checks translation
 * updates/deletes, requires traceable evidence URIs on every approved child
 * artifact, and pins the two recognized upstream datasets in the database.
 */
export class StrengthenCommercialPublication1721403400000
  implements MigrationInterface
{
  name = 'StrengthenCommercialPublication1721403400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "learner_sense_translations"
        ADD CONSTRAINT "CHK_learner_translation_approved_source_url" CHECK (
          "review_status" <> 'approved' OR (
            "source_url" IS NOT NULL AND length(btrim("source_url")) > 0
          )
        )`);
    await queryRunner.query(`
      ALTER TABLE "learner_examples"
        ADD CONSTRAINT "CHK_learner_example_approved_source_url" CHECK (
          "review_status" <> 'approved' OR (
            "source_url" IS NOT NULL AND length(btrim("source_url")) > 0
          )
        )`);
    await queryRunner.query(`
      ALTER TABLE "learner_pronunciations"
        ADD CONSTRAINT "CHK_learner_pronunciation_approved_source_url" CHECK (
          "review_status" <> 'approved' OR (
            "source_url" IS NOT NULL AND length(btrim("source_url")) > 0
          )
        )`);

    await queryRunner.query(`
      ALTER TABLE "learner_entries"
        ADD CONSTRAINT "CHK_learner_entry_rank_source_url" CHECK (
          "learner_rank" IS NULL OR (
            "rank_source_url" IS NOT NULL AND length(btrim("rank_source_url")) > 0
          )
        )`);

    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        ADD CONSTRAINT "CHK_learner_sense_published_oewn_lock" CHECK (
          "status" <> 'published'
          OR NOT (
            lower(btrim("definition_source")) = 'oewn'
            OR lower(btrim("definition_source")) LIKE 'open english wordnet%'
          )
          OR (
            "definition_source_version" = '2025'
            AND "definition_source_artifact_sha256" = '${OEWN_2025_SHA256}'
            AND upper(btrim("definition_source_license")) = 'CC BY 4.0'
          )
        )`);

    await queryRunner.query(`
      ALTER TABLE "learner_entries"
        ADD CONSTRAINT "CHK_learner_entry_ngsl_lock" CHECK (
          "learner_rank" IS NULL
          OR lower(btrim("rank_source")) <> 'ngsl'
          OR (
            "rank_source_version" = '1.2'
            AND upper(btrim("rank_source_license")) = 'CC BY-SA 4.0'
          )
        )`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION commercial_assert_published_sense_has_approved_vi()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE affected_id uuid;
      BEGIN
        FOR affected_id IN
          SELECT DISTINCT id FROM (
            SELECT CASE WHEN TG_OP <> 'INSERT' THEN OLD."learner_sense_id" END id
            UNION ALL
            SELECT CASE WHEN TG_OP <> 'DELETE' THEN NEW."learner_sense_id" END id
          ) affected
          WHERE id IS NOT NULL
        LOOP
          IF EXISTS (
            SELECT 1 FROM "learner_senses" s
             WHERE s."id" = affected_id AND s."status" = 'published'
          ) AND NOT EXISTS (
            SELECT 1 FROM "learner_sense_translations" t
             WHERE t."learner_sense_id" = affected_id
               AND lower(t."locale") = 'vi'
               AND t."review_status" = 'approved'
          ) THEN
            RAISE EXCEPTION
              'published learner sense % must retain an approved Vietnamese translation',
              affected_id
              USING ERRCODE = 'check_violation';
          END IF;
        END LOOP;
        RETURN COALESCE(NEW, OLD);
      END $fn$`);

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_translation_change_preserves_published_sense"
        AFTER INSERT OR UPDATE OR DELETE ON "learner_sense_translations"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION commercial_assert_published_sense_has_approved_vi()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_translation_change_preserves_published_sense"
        ON "learner_sense_translations"`);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS commercial_assert_published_sense_has_approved_vi()`);
    await queryRunner.query(`ALTER TABLE "learner_entries" DROP CONSTRAINT IF EXISTS "CHK_learner_entry_ngsl_lock"`);
    await queryRunner.query(`ALTER TABLE "learner_senses" DROP CONSTRAINT IF EXISTS "CHK_learner_sense_published_oewn_lock"`);
    await queryRunner.query(`ALTER TABLE "learner_entries" DROP CONSTRAINT IF EXISTS "CHK_learner_entry_rank_source_url"`);
    await queryRunner.query(`ALTER TABLE "learner_pronunciations" DROP CONSTRAINT IF EXISTS "CHK_learner_pronunciation_approved_source_url"`);
    await queryRunner.query(`ALTER TABLE "learner_examples" DROP CONSTRAINT IF EXISTS "CHK_learner_example_approved_source_url"`);
    await queryRunner.query(`ALTER TABLE "learner_sense_translations" DROP CONSTRAINT IF EXISTS "CHK_learner_translation_approved_source_url"`);
  }
}
