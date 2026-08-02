import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The DSD corpus core schema.
 *
 * Every table lives in dsd_corpus_db and references only other DSD tables.
 * There is no foreign key to a legacy table and no column that stores a legacy
 * row identifier (invariant 1) — the similarity audit compares text and stores
 * a digest, never a legacy ID.
 *
 * Three rules are enforced here rather than trusted to the application, because
 * they are the ones that make the corpus defensible as original, reviewed work:
 *
 *   1. Approved and published content requires a reviewer who is not the
 *      author. Tooling can be bypassed; a CHECK constraint cannot.
 *   2. A published row cannot be edited in place. Corrections create a new
 *      draft revision linked to the retired one, which repeats every gate.
 *   3. Provenance events are append-only. A ledger that can be rewritten
 *      records nothing.
 */
export class CreateDsdCorpusCore1785628800000 implements MigrationInterface {
  name = 'CreateDsdCorpusCore1785628800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── entries ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_entries" (
        "id"                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "headword"              varchar(200) NOT NULL,
        "headword_normalized"   varchar(200) NOT NULL,
        "language"              varchar(8)   NOT NULL DEFAULT 'en',
        "dsd_priority"          integer,
        "dsd_band"              varchar(32),
        "inventory_evidence_id" varchar(64)  NOT NULL,
        "status"                varchar(16)  NOT NULL DEFAULT 'draft',
        "created_at"            timestamptz  NOT NULL DEFAULT now(),
        "updated_at"            timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dsd_entry_language_headword"
          UNIQUE ("language", "headword_normalized"),
        CONSTRAINT "CHK_dsd_entry_status" CHECK ("status" IN
          ('draft','in_review','approved','published','retired','rejected')),
        CONSTRAINT "CHK_dsd_entry_language" CHECK ("language" IN ('en')),
        CONSTRAINT "CHK_dsd_entry_headword" CHECK (length(btrim("headword")) > 0),
        CONSTRAINT "CHK_dsd_entry_normalized" CHECK (length(btrim("headword_normalized")) > 0),
        CONSTRAINT "CHK_dsd_entry_priority" CHECK ("dsd_priority" IS NULL OR "dsd_priority" > 0),
        CONSTRAINT "CHK_dsd_entry_inventory_evidence"
          CHECK (length(btrim("inventory_evidence_id")) > 0)
      )`);

    // Shared authorship/review/provenance columns, identical on every content
    // table so one set of guards covers them all.
    const contentColumns = (): string => `
        "revision"             integer      NOT NULL DEFAULT 1,
        "supersedes_id"        uuid,
        "authored_by"          varchar(64)  NOT NULL,
        "authored_at"          timestamptz  NOT NULL DEFAULT now(),
        "reviewed_by"          varchar(64),
        "reviewed_at"          timestamptz,
        "content_sha256"       char(64)     NOT NULL,
        "source_id"            varchar(64)  NOT NULL,
        "batch_id"             varchar(64)  NOT NULL,
        "rights_evidence_id"   varchar(64)  NOT NULL,
        "status"               varchar(16)  NOT NULL DEFAULT 'draft',
        "created_at"           timestamptz  NOT NULL DEFAULT now(),
        "updated_at"           timestamptz  NOT NULL DEFAULT now()`;

    // Named per table so a violation message says which table rejected the row.
    const contentConstraints = (t: string): string => `
        CONSTRAINT "CHK_${t}_status" CHECK ("status" IN
          ('draft','in_review','approved','published','retired','rejected')),
        CONSTRAINT "CHK_${t}_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_${t}_sha256" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_${t}_authored_by" CHECK (length(btrim("authored_by")) > 0),
        CONSTRAINT "CHK_${t}_batch" CHECK (length(btrim("batch_id")) > 0),
        CONSTRAINT "CHK_${t}_rights" CHECK (length(btrim("rights_evidence_id")) > 0),
        -- Independent review, enforced rather than requested. A reviewer who is
        -- the author reviews nothing.
        CONSTRAINT "CHK_${t}_independent_review" CHECK (
          "status" NOT IN ('approved','published') OR (
            "reviewed_by" IS NOT NULL
            AND length(btrim("reviewed_by")) > 0
            AND "reviewed_at" IS NOT NULL
            AND "authored_by" <> "reviewed_by"
          )
        ),
        -- The release audit validates source_id against the versioned registry.
        -- A CHECK cannot read a JSON file, so it only proves one was recorded.
        CONSTRAINT "CHK_${t}_published_source" CHECK (
          "status" <> 'published' OR length(btrim("source_id")) > 0
        ),
        CONSTRAINT "CHK_${t}_review_order" CHECK (
          "reviewed_at" IS NULL OR "reviewed_at" >= "authored_at"
        )`;

    // ── senses ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_senses" (
        "id"             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_entry_id"   uuid NOT NULL REFERENCES "dsd_entries"("id") ON DELETE CASCADE,
        "sense_key"      varchar(64)  NOT NULL,
        "sense_order"    smallint     NOT NULL,
        "part_of_speech" varchar(32)  NOT NULL,
        "definition_en"  text         NOT NULL,
        "usage_labels"   text[]       NOT NULL DEFAULT '{}',
        ${contentColumns()},
        CONSTRAINT "FK_dsd_sense_supersedes"
          FOREIGN KEY ("supersedes_id") REFERENCES "dsd_senses"("id"),
        CONSTRAINT "UQ_dsd_sense_entry_key"   UNIQUE ("dsd_entry_id", "sense_key"),
        CONSTRAINT "UQ_dsd_sense_entry_order" UNIQUE ("dsd_entry_id", "sense_order"),
        CONSTRAINT "CHK_dsd_sense_order" CHECK ("sense_order" > 0),
        CONSTRAINT "CHK_dsd_sense_definition" CHECK (length(btrim("definition_en")) > 0),
        CONSTRAINT "CHK_dsd_sense_pos" CHECK ("part_of_speech" IN
          ('noun','verb','adjective','adverb','pronoun','preposition',
           'conjunction','interjection','determiner','numeral','phrase')),
        ${contentConstraints('dsd_sense')}
      )`);

    // ── translations ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_translations" (
        "id"              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_sense_id"    uuid NOT NULL REFERENCES "dsd_senses"("id") ON DELETE CASCADE,
        "locale"          varchar(8) NOT NULL,
        "text"            text       NOT NULL,
        "text_normalized" text       NOT NULL,
        ${contentColumns()},
        CONSTRAINT "FK_dsd_translation_supersedes"
          FOREIGN KEY ("supersedes_id") REFERENCES "dsd_translations"("id"),
        CONSTRAINT "UQ_dsd_translation_sense_locale" UNIQUE ("dsd_sense_id", "locale"),
        CONSTRAINT "CHK_dsd_translation_locale" CHECK ("locale" IN ('vi')),
        CONSTRAINT "CHK_dsd_translation_text" CHECK (length(btrim("text")) > 0),
        CONSTRAINT "CHK_dsd_translation_text_normalized"
          CHECK (length(btrim("text_normalized")) > 0),
        ${contentConstraints('dsd_translation')}
      )`);

    // ── examples ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_examples" (
        "id"            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_sense_id"  uuid NOT NULL REFERENCES "dsd_senses"("id") ON DELETE CASCADE,
        "example_order" smallint NOT NULL,
        "example_en"    text     NOT NULL,
        "example_vi"    text     NOT NULL,
        ${contentColumns()},
        CONSTRAINT "FK_dsd_example_supersedes"
          FOREIGN KEY ("supersedes_id") REFERENCES "dsd_examples"("id"),
        CONSTRAINT "UQ_dsd_example_sense_order" UNIQUE ("dsd_sense_id", "example_order"),
        CONSTRAINT "CHK_dsd_example_order" CHECK ("example_order" > 0),
        CONSTRAINT "CHK_dsd_example_en" CHECK (length(btrim("example_en")) > 0),
        CONSTRAINT "CHK_dsd_example_vi" CHECK (length(btrim("example_vi")) > 0),
        ${contentConstraints('dsd_example')}
      )`);

    // ── pronunciations ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_pronunciations" (
        "id"           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_entry_id" uuid NOT NULL REFERENCES "dsd_entries"("id") ON DELETE CASCADE,
        "accent"       varchar(16) NOT NULL,
        "ipa"          text        NOT NULL,
        "priority"     smallint    NOT NULL DEFAULT 1,
        ${contentColumns()},
        CONSTRAINT "FK_dsd_pronunciation_supersedes"
          FOREIGN KEY ("supersedes_id") REFERENCES "dsd_pronunciations"("id"),
        CONSTRAINT "UQ_dsd_pronunciation_entry_accent_priority"
          UNIQUE ("dsd_entry_id", "accent", "priority"),
        CONSTRAINT "CHK_dsd_pronunciation_accent" CHECK ("accent" IN ('en-US')),
        CONSTRAINT "CHK_dsd_pronunciation_ipa" CHECK (length(btrim("ipa")) > 0),
        CONSTRAINT "CHK_dsd_pronunciation_priority" CHECK ("priority" > 0),
        ${contentConstraints('dsd_pronunciation')}
      )`);

    // ── provenance ledger ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "dsd_provenance_events" (
        "id"          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "entity_kind" varchar(32) NOT NULL,
        "entity_id"   uuid        NOT NULL,
        "event_type"  varchar(32) NOT NULL,
        "actor"       varchar(64) NOT NULL,
        "source_id"   varchar(64),
        "tool_id"     varchar(64),
        "input_hash"  char(64),
        "output_hash" char(64),
        "evidence_id" varchar(64),
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_dsd_event_kind" CHECK ("entity_kind" IN
          ('entry','sense','translation','example','pronunciation','batch','release')),
        CONSTRAINT "CHK_dsd_event_type" CHECK ("event_type" IN
          ('authored','submitted','reviewed','approved','rejected','published',
           'retired','superseded','imported','generated','similarity_checked','released')),
        CONSTRAINT "CHK_dsd_event_actor" CHECK (length(btrim("actor")) > 0),
        CONSTRAINT "CHK_dsd_event_input_hash"
          CHECK ("input_hash" IS NULL OR "input_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_dsd_event_output_hash"
          CHECK ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$')
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_event_entity" ON "dsd_provenance_events" ("entity_kind", "entity_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_event_occurred" ON "dsd_provenance_events" ("occurred_at")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_sense_entry" ON "dsd_senses" ("dsd_entry_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_translation_sense" ON "dsd_translations" ("dsd_sense_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_example_sense" ON "dsd_examples" ("dsd_sense_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_pronunciation_entry" ON "dsd_pronunciations" ("dsd_entry_id")`);

    // ── guard: review timestamps may not be in the future ──────────────────
    // now() is not IMMUTABLE, so a CHECK constraint cannot express this.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_reject_future_review()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."reviewed_at" IS NOT NULL AND NEW."reviewed_at" > now() THEN
          RAISE EXCEPTION 'reviewed_at % is in the future', NEW."reviewed_at"
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."authored_at" > now() THEN
          RAISE EXCEPTION 'authored_at % is in the future', NEW."authored_at"
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    // ── guard: a published row is immutable except to retire it ────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_reject_published_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD."status" <> 'published' THEN
          RETURN NEW;
        END IF;

        -- Retirement is the one permitted transition. A correction is a new
        -- draft revision pointing at the retired row via supersedes_id, so it
        -- repeats review, similarity and publication.
        IF NEW."status" = 'retired'
           AND NEW."content_sha256" = OLD."content_sha256"
           AND NEW."authored_by"    = OLD."authored_by"
           AND NEW."reviewed_by" IS NOT DISTINCT FROM OLD."reviewed_by"
           AND NEW."revision"       = OLD."revision" THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION
          'published % % cannot be edited in place; supersede it with a new draft revision',
          TG_TABLE_NAME, OLD."id"
          USING ERRCODE = 'check_violation';
      END $fn$;`);

    for (const table of ['dsd_senses', 'dsd_translations', 'dsd_examples', 'dsd_pronunciations']) {
      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_future_review"
          BEFORE INSERT OR UPDATE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION dsd_reject_future_review()`);
      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_published_immutable"
          BEFORE UPDATE ON "${table}"
          FOR EACH ROW EXECUTE FUNCTION dsd_reject_published_mutation()`);
    }

    // ── guard: the provenance ledger is append-only ────────────────────────
    // A ledger that can be rewritten records nothing. The break-glass path is
    // owner-only, per-transaction, and leaves the setting in the session so an
    // audit can see it was used.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_provenance_append_only()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF current_setting('dsd.break_glass', true) = 'on'
           AND pg_has_role(current_user, 'dsd_owner', 'MEMBER') THEN
          RETURN COALESCE(NEW, OLD);
        END IF;
        RAISE EXCEPTION
          'dsd_provenance_events is append-only (attempted %)', TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_provenance_append_only"
        BEFORE UPDATE OR DELETE ON "dsd_provenance_events"
        FOR EACH ROW EXECUTE FUNCTION dsd_provenance_append_only()`);

    // ── role grants ────────────────────────────────────────────────────────
    // Created here rather than in provisioning because this migration is what
    // knows which tables exist. Roles may be absent in a disposable workbench,
    // so each grant is guarded.
    //
    // dsd_app is deliberately given nothing: it reads published serving views
    // only, and those arrive with Task 14. Base-table access for the serving
    // role would defeat the publication gate.
    const grants: Array<[string, string]> = [
      // Curator drives the content workflow but cannot DELETE — retirement is
      // a status change, and a deleted row leaves no ledger.
      ['dsd_curator', `
        GRANT SELECT, INSERT, UPDATE ON "dsd_entries", "dsd_senses",
          "dsd_translations", "dsd_examples", "dsd_pronunciations" TO dsd_curator;
        GRANT INSERT, SELECT ON "dsd_provenance_events" TO dsd_curator;`],
      // Auditor reads everything and records decisions; it never edits content.
      ['dsd_auditor', `
        GRANT SELECT ON "dsd_entries", "dsd_senses", "dsd_translations",
          "dsd_examples", "dsd_pronunciations" TO dsd_auditor;
        GRANT INSERT, SELECT ON "dsd_provenance_events" TO dsd_auditor;`],
      // pg_dump needs to read every table and nothing more.
      ['dsd_backup', `
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO dsd_backup;`],
    ];

    for (const [role, sql] of grants) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            ${sql.replace(/'/g, "''")}
          END IF;
        END $$;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drops only DSD objects. Nothing here touches another database.
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_provenance_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_pronunciations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_examples"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_translations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_senses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_entries"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_provenance_append_only()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_reject_published_mutation()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_reject_future_review()`);
  }
}
