import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generated pronunciation audio, and the provenance that makes it releasable.
 *
 * An audio asset is the one DSD artifact a customer hears rather than reads, and
 * the one produced by a machine end to end. Both facts push the same way: the
 * row has to record exactly what produced the bytes, and a person has to have
 * listened before it ships.
 *
 * Four rules live here rather than in the generator:
 *
 *   1. **Blocked voices are refused by the database.** Amy and Ryan are named in
 *      a CHECK. A tool can be edited; this cannot be, without a migration.
 *   2. **Bytes are never overwritten.** The storage key is the content hash, so
 *      differing bytes cannot collide. When the same logical input yields a
 *      different hash — a non-deterministic encoder, a changed model, a
 *      tampered object — the new row is admitted only as 'quarantined', and its
 *      existence blocks acceptance of the sibling. Silent replacement would
 *      make "which bytes did we ship" unanswerable.
 *   3. **A human listening decision cannot be synthesised.** reviewed_by is
 *      required for accepted and rejected, and a trigger refuses any attempt to
 *      set it in the same statement that creates the row. Automated QA and batch
 *      sampling have no path to it.
 *   4. **Rights gate the row, not the release.** Acceptance requires the
 *      training-dataset status to be approved, so an asset from a voice whose
 *      rights are unresolved cannot become servable even by accident.
 */
export class AddDsdAudioAssets1785629100000 implements MigrationInterface {
  name = 'AddDsdAudioAssets1785629100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dsd_audio_assets" (
        "id"                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_entry_id"            uuid         NOT NULL REFERENCES "dsd_entries"("id") ON DELETE CASCADE,

        -- what was spoken
        "input_kind"              varchar(16)  NOT NULL,
        "input_record_id"         uuid         NOT NULL,
        "input_text_sha256"       char(64)     NOT NULL,

        -- identity of the generation, independent of the bytes
        "logical_asset_key"       char(64)     NOT NULL,

        -- which voice, and what it was
        "public_voice_id"         varchar(32)  NOT NULL,
        "engine_voice"            varchar(64)  NOT NULL,
        "engine_version"          varchar(64)  NOT NULL,
        "model_revision"          varchar(64)  NOT NULL,
        "model_sha256"            char(64)     NOT NULL,
        "model_license"           varchar(64)  NOT NULL,
        "training_dataset"        varchar(128) NOT NULL,
        "training_dataset_status" varchar(16)  NOT NULL,

        -- the bytes
        "storage_key"             text         NOT NULL,
        "audio_sha256"            char(64)     NOT NULL,
        "media_type"              varchar(32)  NOT NULL,
        "format"                  varchar(8)   NOT NULL,
        "duration_ms"             integer      NOT NULL,
        "sample_rate"             integer      NOT NULL,
        "channels"                smallint     NOT NULL DEFAULT 1,
        "byte_size"               integer      NOT NULL,

        -- who made it, and who listened
        "generated_at"            timestamptz  NOT NULL DEFAULT now(),
        "generator_actor"         varchar(64)  NOT NULL,
        "release_runtime_digest"  varchar(80),
        "review_status"           varchar(24)  NOT NULL DEFAULT 'pending_qa',
        "qa_findings"             jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "reviewed_by"             varchar(64),
        "reviewed_at"             timestamptz,
        "review_notes"            text,
        "created_at"              timestamptz  NOT NULL DEFAULT now(),
        "updated_at"              timestamptz  NOT NULL DEFAULT now(),

        -- The same bytes for the same logical generation is the same asset.
        -- Re-running the generator must be idempotent, not additive.
        CONSTRAINT "UQ_dsd_audio_logical_bytes" UNIQUE ("logical_asset_key", "audio_sha256"),

        CONSTRAINT "CHK_dsd_audio_input_kind" CHECK ("input_kind" IN ('pronunciation','headword')),
        CONSTRAINT "CHK_dsd_audio_status" CHECK ("review_status" IN
          ('pending_qa','qa_failed','awaiting_review','accepted','rejected','quarantined')),
        CONSTRAINT "CHK_dsd_audio_dataset_status" CHECK ("training_dataset_status" IN
          ('approved','pending','blocked')),
        CONSTRAINT "CHK_dsd_audio_format" CHECK ("format" IN ('wav','mp3')),
        CONSTRAINT "CHK_dsd_audio_media_type" CHECK ("media_type" IN ('audio/wav','audio/mpeg')),
        CONSTRAINT "CHK_dsd_audio_hashes" CHECK (
          "input_text_sha256" ~ '^[0-9a-f]{64}$'
          AND "logical_asset_key" ~ '^[0-9a-f]{64}$'
          AND "audio_sha256" ~ '^[0-9a-f]{64}$'
          AND "model_sha256" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "CHK_dsd_audio_measurements" CHECK (
          "duration_ms" > 0 AND "sample_rate" > 0 AND "channels" > 0 AND "byte_size" > 0
        ),

        -- Rule 1. Named in the schema so the refusal survives an edit to the
        -- generator. See tts-service/docs/DSD-VOICE-RIGHTS.md.
        CONSTRAINT "CHK_dsd_audio_blocked_voices" CHECK (
          "engine_voice" NOT IN ('en_US-amy-medium','en_US-ryan-medium')
        ),

        -- Content-addressed, and the key must agree with the hash it claims.
        CONSTRAINT "CHK_dsd_audio_storage_key" CHECK (
          "storage_key" = 'dsd/audio/' || "public_voice_id" || '/' || "audio_sha256" || '.' || "format"
        ),

        -- Rule 3. A decision needs a decider and a time.
        CONSTRAINT "CHK_dsd_audio_decision_is_attributed" CHECK (
          "review_status" NOT IN ('accepted','rejected') OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0
            AND "reviewed_at" IS NOT NULL
          )
        ),
        -- The reverse, too: a reviewer cannot be recorded against a row nobody
        -- decided on, which is how a listening queue gets quietly pre-filled.
        CONSTRAINT "CHK_dsd_audio_no_premature_reviewer" CHECK (
          "reviewed_by" IS NULL OR "review_status" IN ('accepted','rejected')
        ),
        -- Rule 4. Rights gate the row.
        CONSTRAINT "CHK_dsd_audio_accepted_needs_rights" CHECK (
          "review_status" <> 'accepted' OR "training_dataset_status" = 'approved'
        ),
        -- Automated QA findings must be clean for an accepted asset.
        CONSTRAINT "CHK_dsd_audio_accepted_passes_qa" CHECK (
          "review_status" <> 'accepted' OR "qa_findings" = '[]'::jsonb
        ),
        CONSTRAINT "CHK_dsd_audio_generator_actor" CHECK (length(btrim("generator_actor")) > 0)
      )`);

    // Rule 2. At most one live row per logical generation. A differing hash can
    // still be recorded — as quarantined — so the conflict is visible rather
    // than resolved by whoever wrote last.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dsd_audio_one_live_per_key"
        ON "dsd_audio_assets" ("logical_asset_key")
        WHERE "review_status" <> 'quarantined'`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_audio_entry" ON "dsd_audio_assets" ("dsd_entry_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_audio_status" ON "dsd_audio_assets" ("review_status")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_audio_bytes" ON "dsd_audio_assets" ("audio_sha256")`);

    // ── guard: differing bytes arrive quarantined ──────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_audio_conflict_must_quarantine()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE existing_hash char(64);
      BEGIN
        SELECT a."audio_sha256" INTO existing_hash
          FROM "dsd_audio_assets" a
         WHERE a."logical_asset_key" = NEW."logical_asset_key"
           AND a."audio_sha256" <> NEW."audio_sha256"
           AND a."review_status" <> 'quarantined'
         LIMIT 1;

        IF existing_hash IS NOT NULL AND NEW."review_status" <> 'quarantined' THEN
          RAISE EXCEPTION
            'logical asset key % already holds different bytes (%); the new asset must be '
            'recorded as quarantined, never substituted',
            NEW."logical_asset_key", left(existing_hash, 12)
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_audio_conflict_must_quarantine"
        BEFORE INSERT ON "dsd_audio_assets"
        FOR EACH ROW EXECUTE FUNCTION dsd_audio_conflict_must_quarantine()`);

    // ── guard: a quarantined sibling blocks acceptance ─────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_audio_quarantine_blocks_acceptance()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."review_status" = 'accepted' AND EXISTS (
          SELECT 1 FROM "dsd_audio_assets" a
           WHERE a."logical_asset_key" = NEW."logical_asset_key"
             AND a."id" <> NEW."id"
             AND a."review_status" = 'quarantined'
        ) THEN
          -- The same input produced two different recordings. Until someone
          -- explains why, neither is trustworthy enough to ship.
          RAISE EXCEPTION
            'logical asset key % has a quarantined conflict; resolve it before accepting',
            NEW."logical_asset_key"
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_audio_quarantine_blocks_acceptance"
        BEFORE INSERT OR UPDATE ON "dsd_audio_assets"
        FOR EACH ROW EXECUTE FUNCTION dsd_audio_quarantine_blocks_acceptance()`);

    // ── guard: a listening decision cannot be created, only made ───────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_audio_review_is_a_separate_act()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW."reviewed_by" IS NOT NULL OR NEW."reviewed_at" IS NOT NULL
             OR NEW."review_status" IN ('accepted','rejected') THEN
            -- Generation and review are separate acts by separate parties. A
            -- generator that could insert an accepted row would make the
            -- listening requirement decorative.
            RAISE EXCEPTION
              'an audio asset cannot be created already reviewed; generation and review '
              'are separate acts'
              USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW."generator_actor" IS DISTINCT FROM OLD."generator_actor" THEN
          RAISE EXCEPTION 'generator_actor is immutable' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."audio_sha256" IS DISTINCT FROM OLD."audio_sha256"
           OR NEW."logical_asset_key" IS DISTINCT FROM OLD."logical_asset_key"
           OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
           OR NEW."model_sha256" IS DISTINCT FROM OLD."model_sha256"
           OR NEW."input_text_sha256" IS DISTINCT FROM OLD."input_text_sha256" THEN
          RAISE EXCEPTION
            'the identity of an audio asset is immutable; generate a new one'
            USING ERRCODE = 'check_violation';
        END IF;
        IF OLD."review_status" IN ('accepted','rejected')
           AND NEW."review_status" <> OLD."review_status"
           AND NEW."review_status" <> 'quarantined' THEN
          -- A decision may be superseded by quarantine when a conflict appears,
          -- but it is not simply re-opened.
          RAISE EXCEPTION
            'audio asset % is already %; a decision is not re-opened, it is superseded',
            OLD."id", OLD."review_status"
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_audio_review_is_a_separate_act"
        BEFORE INSERT OR UPDATE ON "dsd_audio_assets"
        FOR EACH ROW EXECUTE FUNCTION dsd_audio_review_is_a_separate_act()`);

    // ── role grants ────────────────────────────────────────────────────────
    // The serving role reads accepted assets only, through a view. The curator
    // generates and records decisions. The auditor reads everything.
    await queryRunner.query(`
      CREATE VIEW "dsd_servable_audio" AS
        SELECT a."id", a."dsd_entry_id", a."input_kind", a."input_record_id",
               a."public_voice_id", a."storage_key", a."audio_sha256",
               a."media_type", a."format", a."duration_ms", a."sample_rate"
          FROM "dsd_audio_assets" a
         WHERE a."review_status" = 'accepted'
           AND a."training_dataset_status" = 'approved'
           AND a."qa_findings" = '[]'::jsonb`);

    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT, UPDATE ON "dsd_audio_assets" TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_audio_assets" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_audio_assets" TO dsd_backup;`],
      // Deliberately the view and not the table: the serving role has no query
      // that can reach an unreviewed asset.
      ['dsd_app', `GRANT SELECT ON "dsd_servable_audio" TO dsd_app;`],
    ] as Array<[string, string]>) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            ${sql}
          END IF;
        END $$;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "dsd_servable_audio"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_audio_assets"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_audio_conflict_must_quarantine()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_audio_quarantine_blocks_acceptance()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_audio_review_is_a_separate_act()`);
  }
}
