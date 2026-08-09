import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Close the gaps found after the first end-to-end DSD implementation review.
 *
 * This is intentionally a forward migration. Already-provisioned workbenches
 * must receive the same fixes as a fresh database; rewriting an earlier
 * migration would leave them on a different security model.
 */
export class HardenDsdCommercialBoundary1785629500000 implements MigrationInterface {
  name = 'HardenDsdCommercialBoundary1785629500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A release id identifies exactly one signed build. Multiple manifests
    // under one public id would make runtime activation ambiguous.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dsd_release_build_release_id"
        ON "dsd_release_builds" ("release_id")`);

    await queryRunner.query(`
      CREATE TABLE "dsd_release_entries" (
        "release_build_id" uuid NOT NULL
          REFERENCES "dsd_release_builds"("id") ON DELETE RESTRICT,
        "entry_id" uuid NOT NULL
          REFERENCES "dsd_entries"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dsd_release_entries" PRIMARY KEY ("release_build_id", "entry_id")
      )`);

    // Entry membership alone is insufficient: a later sense or translation
    // published under the same entry would otherwise drift into old signed
    // releases. Record the exact child rows whose bytes were exported too.
    const releaseChildren = [
      ['senses', 'sense_id', 'dsd_senses'],
      ['translations', 'translation_id', 'dsd_translations'],
      ['examples', 'example_id', 'dsd_examples'],
      ['pronunciations', 'pronunciation_id', 'dsd_pronunciations'],
      ['relations', 'relation_id', 'dsd_relations'],
      ['audio_assets', 'audio_asset_id', 'dsd_audio_assets'],
    ] as Array<[string, string, string]>;
    for (const [suffix, idColumn, target] of releaseChildren) {
      await queryRunner.query(`
        CREATE TABLE "dsd_release_${suffix}" (
          "release_build_id" uuid NOT NULL
            REFERENCES "dsd_release_builds"("id") ON DELETE RESTRICT,
          "${idColumn}" uuid NOT NULL
            REFERENCES "${target}"("id") ON DELETE RESTRICT,
          "created_at" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "PK_dsd_release_${suffix}"
            PRIMARY KEY ("release_build_id", "${idColumn}")
        )`);
    }

    await queryRunner.query(`ALTER TABLE "dsd_release_builds"
      ADD COLUMN "manifest_bytes" text NOT NULL DEFAULT '',
      ADD COLUMN "translation_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "example_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "pronunciation_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "relation_count" integer NOT NULL DEFAULT 0`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_release_entry_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'release membership is immutable; build a new release'
          USING ERRCODE = 'insufficient_privilege';
      END $fn$`);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_release_entry_immutable"
        BEFORE UPDATE OR DELETE ON "dsd_release_entries"
        FOR EACH ROW EXECUTE FUNCTION dsd_release_entry_immutable()`);
    for (const [suffix] of releaseChildren) {
      await queryRunner.query(`
        CREATE TRIGGER "TRG_dsd_release_${suffix}_immutable"
          BEFORE UPDATE OR DELETE ON "dsd_release_${suffix}"
          FOR EACH ROW EXECUTE FUNCTION dsd_release_entry_immutable()`);
    }

    // The view is the only release metadata visible to dsd_app. It exposes no
    // contributor, evidence-store or audit internals. A partially-recorded
    // build is invisible because its membership count must equal entry_count.
    await queryRunner.query(`
      CREATE VIEW "dsd_complete_release_builds" AS
        SELECT b.* FROM "dsd_release_builds" b
         WHERE octet_length(b."manifest_bytes") > 0
           AND b."entry_count" = (SELECT count(*)::int FROM "dsd_release_entries" c WHERE c."release_build_id" = b."id")
           AND b."sense_count" = (SELECT count(*)::int FROM "dsd_release_senses" c WHERE c."release_build_id" = b."id")
           AND b."translation_count" = (SELECT count(*)::int FROM "dsd_release_translations" c WHERE c."release_build_id" = b."id")
           AND b."example_count" = (SELECT count(*)::int FROM "dsd_release_examples" c WHERE c."release_build_id" = b."id")
           AND b."pronunciation_count" = (SELECT count(*)::int FROM "dsd_release_pronunciations" c WHERE c."release_build_id" = b."id")
           AND b."relation_count" = (SELECT count(*)::int FROM "dsd_release_relations" c WHERE c."release_build_id" = b."id")
           AND b."audio_asset_count" = (SELECT count(*)::int FROM "dsd_release_audio_assets" c WHERE c."release_build_id" = b."id")
           -- Membership is exact only while every signed row remains servable.
           -- Retiring or quarantining one member invalidates activation instead
           -- of silently shrinking the release or substituting a newer row.
           AND b."entry_count" = (
             SELECT count(*)::int FROM "dsd_release_entries" c
             JOIN "dsd_serving_entries" s ON s."id" = c."entry_id"
             WHERE c."release_build_id" = b."id")
           AND b."sense_count" = (
             SELECT count(*)::int FROM "dsd_release_senses" c
             JOIN "dsd_serving_senses" s ON s."id" = c."sense_id"
             WHERE c."release_build_id" = b."id")
           AND b."translation_count" = (
             SELECT count(*)::int FROM "dsd_release_translations" c
             JOIN "dsd_serving_translations" s ON s."id" = c."translation_id"
             WHERE c."release_build_id" = b."id")
           AND b."example_count" = (
             SELECT count(*)::int FROM "dsd_release_examples" c
             JOIN "dsd_serving_examples" s ON s."id" = c."example_id"
             WHERE c."release_build_id" = b."id")
           AND b."pronunciation_count" = (
             SELECT count(*)::int FROM "dsd_release_pronunciations" c
             JOIN "dsd_serving_pronunciations" s ON s."id" = c."pronunciation_id"
             WHERE c."release_build_id" = b."id")
           AND b."relation_count" = (
             SELECT count(DISTINCT c."relation_id")::int FROM "dsd_release_relations" c
             JOIN "dsd_serving_relations" s ON s."id" = c."relation_id"
             WHERE c."release_build_id" = b."id")
           AND b."audio_asset_count" = (
             SELECT count(*)::int FROM "dsd_release_audio_assets" c
             JOIN "dsd_servable_audio" s ON s."id" = c."audio_asset_id"
             WHERE c."release_build_id" = b."id")`);
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_release_entries" AS
        SELECT b."release_id", b."channel", b."public_eligible",
               b."entry_count", b."sense_count", b."translation_count",
               b."example_count", b."pronunciation_count", b."relation_count",
               b."audio_asset_count", b."manifest_sha256", b."signer_key_id",
               b."signature", b."signature_algorithm", b."manifest_bytes",
               m."entry_id"
          FROM "dsd_complete_release_builds" b
          JOIN "dsd_release_entries" m ON m."release_build_id" = b."id"`);
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_release_records" AS
        SELECT b."release_id", 'sense'::varchar(24) AS "record_kind", m."sense_id" AS "record_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_senses" m ON m."release_build_id" = b."id"
        UNION ALL
        SELECT b."release_id", 'translation', m."translation_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_translations" m ON m."release_build_id" = b."id"
        UNION ALL
        SELECT b."release_id", 'example', m."example_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_examples" m ON m."release_build_id" = b."id"
        UNION ALL
        SELECT b."release_id", 'pronunciation', m."pronunciation_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_pronunciations" m ON m."release_build_id" = b."id"
        UNION ALL
        SELECT b."release_id", 'relation', m."relation_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_relations" m ON m."release_build_id" = b."id"
        UNION ALL
        SELECT b."release_id", 'audio', m."audio_asset_id"
          FROM "dsd_complete_release_builds" b JOIN "dsd_release_audio_assets" m ON m."release_build_id" = b."id"`);

    // Corrections must be able to coexist with the retired row they replace.
    // Rejected rows are also historical; they must not reserve a logical key.
    for (const constraint of [
      ['dsd_entries', 'UQ_dsd_entry_language_headword'],
      ['dsd_senses', 'UQ_dsd_sense_entry_key'],
      ['dsd_senses', 'UQ_dsd_sense_entry_order'],
      ['dsd_translations', 'UQ_dsd_translation_sense_locale'],
      ['dsd_examples', 'UQ_dsd_example_sense_order'],
      ['dsd_pronunciations', 'UQ_dsd_pronunciation_entry_accent_priority'],
      ['dsd_relations', 'UQ_dsd_relation_pair'],
    ] as Array<[string, string]>) {
      await queryRunner.query(
        `ALTER TABLE "${constraint[0]}" DROP CONSTRAINT IF EXISTS "${constraint[1]}"`,
      );
    }

    await queryRunner.query(`ALTER TABLE "dsd_entries"
      ADD COLUMN "revision" integer NOT NULL DEFAULT 1,
      ADD COLUMN "supersedes_id" uuid,
      ADD CONSTRAINT "FK_dsd_entry_supersedes"
        FOREIGN KEY ("supersedes_id") REFERENCES "dsd_entries"("id"),
      ADD CONSTRAINT "CHK_dsd_entry_revision" CHECK ("revision" > 0)`);
    await queryRunner.query(`ALTER TABLE "dsd_relations"
      ADD COLUMN "revision" integer NOT NULL DEFAULT 1,
      ADD COLUMN "supersedes_id" uuid,
      ADD CONSTRAINT "FK_dsd_relation_supersedes"
        FOREIGN KEY ("supersedes_id") REFERENCES "dsd_relations"("id"),
      ADD CONSTRAINT "CHK_dsd_relation_revision" CHECK ("revision" > 0)`);

    const partialIndexes = [
      ['UQ_dsd_entry_language_headword_active', 'dsd_entries', '"language", "headword_normalized"'],
      ['UQ_dsd_sense_entry_key_active', 'dsd_senses', '"dsd_entry_id", "sense_key"'],
      ['UQ_dsd_sense_entry_order_active', 'dsd_senses', '"dsd_entry_id", "sense_order"'],
      ['UQ_dsd_translation_sense_locale_active', 'dsd_translations', '"dsd_sense_id", "locale"'],
      ['UQ_dsd_example_sense_order_active', 'dsd_examples', '"dsd_sense_id", "example_order"'],
      ['UQ_dsd_pronunciation_entry_accent_priority_active', 'dsd_pronunciations', '"dsd_entry_id", "accent", "priority"'],
      ['UQ_dsd_relation_pair_active', 'dsd_relations', '"from_sense_id", "to_sense_id", "relation_type"'],
    ];
    for (const [name, table, columns] of partialIndexes) {
      await queryRunner.query(`CREATE UNIQUE INDEX "${name}" ON "${table}" (${columns})
        WHERE "status" NOT IN ('retired', 'rejected')`);
    }
    for (const table of [
      'dsd_entries',
      'dsd_senses',
      'dsd_translations',
      'dsd_examples',
      'dsd_pronunciations',
      'dsd_relations',
    ]) {
      await queryRunner.query(`CREATE UNIQUE INDEX "UQ_${table}_one_successor"
        ON "${table}" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL`);
    }

    // The earlier generic trigger compared only metadata while retiring a row,
    // so text could change while retaining its old hash. Compare the complete
    // row except for the two fields retirement is allowed to change.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_reject_published_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD."status" <> 'published' THEN
          RETURN NEW;
        END IF;
        IF NEW."status" = 'retired'
           AND (to_jsonb(NEW) - ARRAY['status','updated_at'])
             = (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION
          'published % % cannot be edited in place; supersede it with a new draft revision',
          TG_TABLE_NAME, OLD."id" USING ERRCODE = 'check_violation';
      END $fn$`);

    for (const table of ['dsd_entries', 'dsd_relations']) {
      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_published_immutable"
          BEFORE UPDATE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION dsd_reject_published_mutation()`);
    }

    // Automated rewrite_required is not a clearance. Only the decision that
    // permits publication needs a named reviewer and external evidence.
    await queryRunner.query(`ALTER TABLE "dsd_similarity_results"
      DROP CONSTRAINT IF EXISTS "CHK_dsd_similarity_manual_clearance"`);
    await queryRunner.query(`ALTER TABLE "dsd_similarity_results"
      ADD CONSTRAINT "CHK_dsd_similarity_manual_clearance" CHECK (
        "decision" <> 'independently_authored_cleared' OR (
          "decided_by" IS NOT NULL AND length(btrim("decided_by")) > 0
          AND "decided_at" IS NOT NULL
          AND "decision_evidence_id" IS NOT NULL
          AND length(btrim("decision_evidence_id")) > 0
          AND "decision_reason" IS NOT NULL
          AND length(btrim("decision_reason")) > 0
        )
      )`);
    await queryRunner.query(`ALTER TABLE "dsd_similarity_results"
      DROP CONSTRAINT IF EXISTS "CHK_dsd_similarity_scores_shape"`);
    await queryRunner.query(`ALTER TABLE "dsd_similarity_results"
      ADD CONSTRAINT "CHK_dsd_similarity_scores_shape" CHECK (
        jsonb_typeof("component_scores") = 'object'
        AND ("component_scores" - ARRAY[
          'exact','tokenJaccard','wordNgramJaccard','charNgramJaccard',
          'cosine','longestRun','longestRunRatio','contentRun'
        ]) = '{}'::jsonb
        AND "component_scores" ?& ARRAY['exact','tokenJaccard','cosine','longestRun']
      )`);

    // Accepted audio must name the voice-rights evidence, come from a pinned
    // runtime and be listened to by someone other than the generator. Existing
    // rows are not blessed retroactively; the serving view excludes them until
    // a real decision supplies the missing evidence.
    await queryRunner.query(`ALTER TABLE "dsd_audio_assets"
      ADD COLUMN "voice_rights_evidence_id" varchar(64)`);
    await queryRunner.query(`
      DO $fn$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "dsd_audio_assets" a
           WHERE (a."input_kind" = 'pronunciation' AND NOT EXISTS (
                    SELECT 1 FROM "dsd_pronunciations" p
                     WHERE p."id" = a."input_record_id"
                       AND p."dsd_entry_id" = a."dsd_entry_id"
                 ))
              OR (a."input_kind" = 'headword' AND a."input_record_id" <> a."dsd_entry_id")
        ) THEN
          RAISE EXCEPTION 'audio input_record_id does not belong to its DSD entry'
            USING ERRCODE = 'foreign_key_violation';
        END IF;
      END $fn$`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_audio_input_belongs_to_entry()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."input_kind" = 'pronunciation' AND NOT EXISTS (
          SELECT 1 FROM "dsd_pronunciations" p
           WHERE p."id" = NEW."input_record_id"
             AND p."dsd_entry_id" = NEW."dsd_entry_id"
        ) THEN
          RAISE EXCEPTION 'audio pronunciation % does not belong to entry %',
            NEW."input_record_id", NEW."dsd_entry_id"
            USING ERRCODE = 'foreign_key_violation';
        ELSIF NEW."input_kind" = 'headword'
          AND NEW."input_record_id" <> NEW."dsd_entry_id" THEN
          RAISE EXCEPTION 'headword audio input must identify its own entry'
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        RETURN NEW;
      END $fn$`);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_audio_input_belongs_to_entry"
        BEFORE INSERT OR UPDATE OF "dsd_entry_id", "input_kind", "input_record_id"
        ON "dsd_audio_assets"
        FOR EACH ROW EXECUTE FUNCTION dsd_audio_input_belongs_to_entry()`);
    await queryRunner.query(`ALTER TABLE "dsd_audio_assets"
      ADD CONSTRAINT "CHK_dsd_audio_accepted_is_releasable" CHECK (
        "review_status" <> 'accepted' OR (
          "release_runtime_digest" ~ '^sha256:[0-9a-f]{64}$'
          AND "voice_rights_evidence_id" IS NOT NULL
          AND length(btrim("voice_rights_evidence_id")) > 0
          AND "reviewed_by" <> "generator_actor"
        )
      ) NOT VALID`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW "dsd_servable_audio" AS
        SELECT a."id", a."dsd_entry_id", a."input_kind", a."input_record_id",
               a."public_voice_id", a."storage_key", a."audio_sha256",
               a."media_type", a."format", a."duration_ms", a."sample_rate"
          FROM "dsd_audio_assets" a
         WHERE a."review_status" = 'accepted'
           AND a."training_dataset_status" = 'approved'
           AND a."qa_findings" = '[]'::jsonb
           AND a."release_runtime_digest" ~ '^sha256:[0-9a-f]{64}$'
           AND a."voice_rights_evidence_id" IS NOT NULL
           AND length(btrim(a."voice_rights_evidence_id")) > 0
           AND a."reviewed_by" <> a."generator_actor"`);

    const releaseTables = [
      'dsd_release_entries',
      ...releaseChildren.map(([suffix]) => `dsd_release_${suffix}`),
    ].map((table) => `"${table}"`).join(', ');
    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT ON ${releaseTables} TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON ${releaseTables}, "dsd_serving_release_entries", "dsd_serving_release_records" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON ${releaseTables} TO dsd_backup;`],
      ['dsd_app', `GRANT SELECT ON "dsd_serving_release_entries", "dsd_serving_release_records", "dsd_servable_audio" TO dsd_app;`],
    ] as Array<[string, string]>) {
      await queryRunner.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          ${sql}
        END IF;
      END $$`);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // The remaining hardening is intentionally not undone automatically: doing
    // so could re-enable in-place published edits or make accepted audio with
    // incomplete evidence servable. Roll forward with a reviewed migration.
    throw new Error('security hardening migration is irreversible; roll forward');
  }
}
