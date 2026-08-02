import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes the three provenance gaps the learner schema still had.
 *
 * The overlay already carries 41 CHECK constraints — source and licence are
 * NOT NULL and non-empty, published senses need reviewer metadata, CEFR needs
 * its own provenance chain. This migration adds only what was genuinely
 * missing:
 *
 *   1. CHK_learner_sense_published_definition_provenance shipped NOT VALID, so
 *      it was advisory rather than enforced. Both tables are empty, so
 *      validating costs nothing and makes it real.
 *
 *   2. definition_source_url was nullable and unconstrained, so a published
 *      sense could cite a source with no way to find it. Attribution for
 *      CC BY 4.0 (OEWN) and CC BY-SA 4.0 (NGSL) needs a resolvable URL.
 *
 *   3. Nothing tied a published sense to having an approved Vietnamese
 *      translation — the single most important rule in the product, and the
 *      one a CHECK cannot express because it spans two tables. A deferrable
 *      constraint trigger enforces it at COMMIT, so a transaction may insert
 *      the sense and its translation in either order.
 *
 * Nothing here fabricates provenance for existing rows; the legacy layer keeps
 * its documented gap.
 */
export class EnforceLearnerProvenance1721403300000 implements MigrationInterface {
  name = 'EnforceLearnerProvenance1721403300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Make the advisory constraint real. Free: learner_senses is empty.
    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        VALIDATE CONSTRAINT "CHK_learner_sense_published_definition_provenance"`);

    // 2. A cited source must be resolvable.
    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        ADD CONSTRAINT "CHK_learner_sense_published_source_url" CHECK (
          "status" <> 'published' OR (
            "definition_source_url" IS NOT NULL
            AND length(btrim("definition_source_url")) > 0
          )
        )`);

    // 3. Published senses must carry an independently approved Vietnamese
    //    translation. Deferred to COMMIT so insertion order does not matter.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION learner_sense_publish_requires_approved_translation()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE approved integer;
      BEGIN
        IF NEW."status" <> 'published' THEN
          RETURN NEW;
        END IF;

        SELECT count(*) INTO approved
          FROM "learner_sense_translations" t
         WHERE t."learner_sense_id" = NEW."id"
           AND t."locale" = 'vi'
           AND t."review_status" = 'approved';

        IF approved = 0 THEN
          RAISE EXCEPTION
            'learner sense % cannot publish: no approved Vietnamese translation', NEW."id"
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_learner_sense_publish_requires_approved_translation"
        AFTER INSERT OR UPDATE OF "status" ON "learner_senses"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION learner_sense_publish_requires_approved_translation()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_learner_sense_publish_requires_approved_translation"
        ON "learner_senses"`);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS learner_sense_publish_requires_approved_translation()`);
    await queryRunner.query(`
      ALTER TABLE "learner_senses"
        DROP CONSTRAINT IF EXISTS "CHK_learner_sense_published_source_url"`);
    // The NOT VALID -> VALID transition is not reverted: re-marking a
    // constraint NOT VALID would weaken the schema for no benefit.
  }
}
