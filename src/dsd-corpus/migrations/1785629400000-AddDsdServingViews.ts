import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner-defined serving views, and the revocation that makes them the only path.
 *
 * The application role has been able to read the base tables since the core
 * migration. That was fine while nothing served DSD content and wrong the moment
 * something does: a `SELECT` on `dsd_senses` returns drafts, rejected wording,
 * author identities and batch ids, and a serving bug becomes a disclosure.
 *
 * So this migration does two things, and the second matters more than the first.
 * It defines views that expose published content only — and it revokes `dsd_app`
 * from every base table, so the views are not the recommended path but the only
 * one. A query the role cannot execute needs no code review.
 *
 * What the views deliberately never expose:
 *
 *   - draft, in-review, rejected or superseded rows
 *   - contributor identities: authored_by, reviewed_by, decided_by
 *   - provenance events, evidence ids, batch ids
 *   - similarity results and compliance scores of any kind
 *   - IPA candidates, which are machine output and never content
 *   - audio that is quarantined, unreviewed, or from a voice whose rights are
 *     unresolved
 *
 * Content identity is the DSD UUID. The legacy integer ids are not reachable
 * from here — there is no column that could carry one.
 */
export class AddDsdServingViews1785629400000 implements MigrationInterface {
  name = 'AddDsdServingViews1785629400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── entries ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_entries" AS
        SELECT e."id",
               e."headword",
               e."headword_normalized",
               e."language",
               -- Exposed for cache validators. There is no published_at on the
               -- base table; the publication timestamp lives in the provenance
               -- ledger, which the serving role cannot read and should not.
               e."updated_at"
          FROM "dsd_entries" e
         WHERE e."status" = 'published'`);

    // ── senses ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_senses" AS
        SELECT s."id",
               s."dsd_entry_id",
               s."sense_order",
               s."part_of_speech",
               s."definition_en",
               s."usage_labels"
          FROM "dsd_senses" s
          JOIN "dsd_entries" e ON e."id" = s."dsd_entry_id"
         WHERE s."status" = 'published' AND e."status" = 'published'`);

    // ── translations ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_translations" AS
        SELECT t."id",
               t."dsd_sense_id",
               t."locale",
               t."text"
          FROM "dsd_translations" t
          JOIN "dsd_senses" s ON s."id" = t."dsd_sense_id"
          JOIN "dsd_entries" e ON e."id" = s."dsd_entry_id"
         WHERE t."status" = 'published'
           AND s."status" = 'published'
           AND e."status" = 'published'`);

    // ── examples ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_examples" AS
        SELECT x."id",
               x."dsd_sense_id",
               x."example_order",
               x."example_en",
               x."example_vi"
          FROM "dsd_examples" x
          JOIN "dsd_senses" s ON s."id" = x."dsd_sense_id"
          JOIN "dsd_entries" e ON e."id" = s."dsd_entry_id"
         WHERE x."status" = 'published'
           AND s."status" = 'published'
           AND e."status" = 'published'`);

    // ── pronunciations ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_pronunciations" AS
        SELECT p."id",
               p."dsd_entry_id",
               p."accent",
               p."ipa",
               p."priority"
          FROM "dsd_pronunciations" p
          JOIN "dsd_entries" e ON e."id" = p."dsd_entry_id"
         WHERE p."status" = 'published' AND e."status" = 'published'`);

    // dsd_servable_audio already exists from the audio migration and is already
    // restricted to accepted assets with approved rights and clean QA. It is
    // not redefined here; one definition of "servable audio" is enough.

    // ── revoke the base tables ─────────────────────────────────────────────
    // The important half. Without this the views are advice.
    await queryRunner.query(`
      DO $$
      DECLARE t text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_app') THEN
          RETURN;
        END IF;
        FOREACH t IN ARRAY ARRAY[
          'dsd_entries', 'dsd_senses', 'dsd_translations', 'dsd_examples',
          'dsd_pronunciations', 'dsd_provenance_events', 'dsd_similarity_results',
          'dsd_ipa_candidates', 'dsd_audio_assets', 'dsd_relations'
        ] LOOP
          IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t) THEN
            EXECUTE format('REVOKE ALL ON %I FROM dsd_app', t);
          END IF;
        END LOOP;
      END $$;`);

    for (const view of [
      'dsd_serving_entries',
      'dsd_serving_senses',
      'dsd_serving_translations',
      'dsd_serving_examples',
      'dsd_serving_pronunciations',
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_app') THEN
            GRANT SELECT ON "${view}" TO dsd_app;
          END IF;
        END $$;`);
    }

    // The auditor keeps base-table access: an audit that could only see the
    // published surface could not tell you what is wrong with the rest.
    for (const view of [
      'dsd_serving_entries',
      'dsd_serving_senses',
      'dsd_serving_translations',
      'dsd_serving_examples',
      'dsd_serving_pronunciations',
    ]) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_auditor') THEN
            GRANT SELECT ON "${view}" TO dsd_auditor;
          END IF;
        END $$;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const view of [
      'dsd_serving_pronunciations',
      'dsd_serving_examples',
      'dsd_serving_translations',
      'dsd_serving_senses',
      'dsd_serving_entries',
    ]) {
      await queryRunner.query(`DROP VIEW IF EXISTS "${view}"`);
    }

    // Restore what the core migration granted, so down() is a real inverse.
    await queryRunner.query(`
      DO $$
      DECLARE t text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_app') THEN
          RETURN;
        END IF;
        FOREACH t IN ARRAY ARRAY[
          'dsd_entries', 'dsd_senses', 'dsd_translations', 'dsd_examples',
          'dsd_pronunciations'
        ] LOOP
          IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t) THEN
            EXECUTE format('GRANT SELECT ON %I TO dsd_app', t);
          END IF;
        END LOOP;
      END $$;`);
  }
}
