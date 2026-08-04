import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DSD-authored relations between senses, and the metadata policy around them.
 *
 * A relation is a factual assertion someone made and someone else checked —
 * "this sense means roughly the same as that one". It is not a row copied from
 * WordNet or Wiktionary, and that distinction is the whole reason this table
 * exists rather than an import script. A borrowed relation set would carry the
 * borrowed licence, which is the position the DSD corpus was built to avoid.
 *
 * Four things are enforced here rather than in the tool:
 *
 *   1. **Both ends are DSD senses.** Foreign keys to `dsd_senses`, so a relation
 *      cannot reference a legacy word or a sense that does not exist. There is
 *      no column that could hold a legacy integer id.
 *   2. **Relation sources are DSD's own.** A CHECK names the lexical databases
 *      whose relation sets must not be imported. A tool can be edited; this
 *      needs a migration.
 *   3. **Every relation is reviewed.** Approved and published rows require a
 *      named reviewer and a timestamp, and the reviewer may not be the author.
 *   4. **No CEFR anywhere.** DSD has not adopted a CEFR rubric, so a band that
 *      looks like a CEFR level is refused on `dsd_entries`. Labelling content
 *      A2 without a documented rubric behind it is a claim DSD cannot support.
 *
 * Relations are stored in one direction. The serving view exposes both, so a
 * symmetric relation cannot exist as half a pair.
 */
export class AddDsdRelations1785629200000 implements MigrationInterface {
  name = 'AddDsdRelations1785629200000';

  /** Relation sets that must not be imported, whatever their licence permits. */
  private readonly forbiddenSources = [
    'oewn-2025',
    'wordnet',
    'wordnet-3.1',
    'open-english-wordnet',
    'wiktionary-en',
    'wiktionary',
    'legacy-dictionary-corpus',
    'tudien-archive',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const forbidden = this.forbiddenSources.map((source) => `'${source}'`).join(',');

    await queryRunner.query(`
      CREATE TABLE "dsd_relations" (
        "id"                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

        -- Both ends are DSD senses. Sense level rather than entry level because
        -- "bank" the riverside and "bank" the institution do not share synonyms.
        "from_sense_id"        uuid         NOT NULL REFERENCES "dsd_senses"("id") ON DELETE CASCADE,
        "to_sense_id"          uuid         NOT NULL REFERENCES "dsd_senses"("id") ON DELETE CASCADE,
        "relation_type"        varchar(24)  NOT NULL,

        -- The same review surface as every other authored record.
        "status"               varchar(16)  NOT NULL DEFAULT 'draft',
        "content_sha256"       char(64)     NOT NULL,
        "authored_by"          varchar(64)  NOT NULL,
        "reviewed_by"          varchar(64),
        "reviewed_at"          timestamptz,
        "source_id"            varchar(64)  NOT NULL,
        "batch_id"             varchar(64)  NOT NULL,
        "rights_evidence_id"   varchar(64)  NOT NULL,
        "created_at"           timestamptz  NOT NULL DEFAULT now(),
        "updated_at"           timestamptz  NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_dsd_relation_pair" UNIQUE ("from_sense_id", "to_sense_id", "relation_type"),

        -- A sense is not its own synonym.
        CONSTRAINT "CHK_dsd_relation_not_self" CHECK ("from_sense_id" <> "to_sense_id"),

        CONSTRAINT "CHK_dsd_relation_type" CHECK ("relation_type" IN
          ('synonym','antonym','related','derived_form','see_also')),
        CONSTRAINT "CHK_dsd_relation_status" CHECK ("status" IN
          ('draft','in_review','approved','published','retired','rejected')),
        CONSTRAINT "CHK_dsd_relation_hash" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),

        -- Rule 3. A reviewed record names its reviewer.
        CONSTRAINT "CHK_dsd_relation_reviewed" CHECK (
          "status" NOT IN ('approved','published') OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0
            AND "reviewed_at" IS NOT NULL
          )
        ),
        CONSTRAINT "CHK_dsd_relation_not_self_reviewed" CHECK (
          "reviewed_by" IS NULL OR "reviewed_by" <> "authored_by"
        ),

        -- Rule 2. Named in the schema so the refusal survives an edit to the
        -- import tool. These sets are not imported at any licence.
        CONSTRAINT "CHK_dsd_relation_source_not_borrowed" CHECK (
          "source_id" NOT IN (${forbidden})
        ),
        CONSTRAINT "CHK_dsd_relation_attribution" CHECK (
          length(btrim("authored_by")) > 0
          AND length(btrim("source_id")) > 0
          AND length(btrim("rights_evidence_id")) > 0
        )
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_relation_from" ON "dsd_relations" ("from_sense_id", "relation_type")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_relation_to" ON "dsd_relations" ("to_sense_id", "relation_type")`);

    // ── no CEFR, on any table ──────────────────────────────────────────────
    // Rule 4. dsd_band is a product ordering value. A band spelled like a CEFR
    // level would be read as a CEFR claim by everyone who saw it, and DSD has no
    // rubric behind that claim.
    await queryRunner.query(`
      ALTER TABLE "dsd_entries" ADD CONSTRAINT "CHK_dsd_entry_band_is_not_cefr" CHECK (
        "dsd_band" IS NULL OR "dsd_band" !~* '^(a1|a2|b1|b2|c1|c2)$'
      )`);

    // ── the provenance ledger learns a new entity kind ─────────────────────
    // The core migration's CHECK predates relations. Extended here rather than
    // edited there, so an already-applied database moves forward by migration
    // instead of by someone rewriting history.
    await queryRunner.query(`
      ALTER TABLE "dsd_provenance_events" DROP CONSTRAINT IF EXISTS "CHK_dsd_event_kind"`);
    await queryRunner.query(`
      ALTER TABLE "dsd_provenance_events" ADD CONSTRAINT "CHK_dsd_event_kind" CHECK (
        "entity_kind" IN
          ('entry','sense','translation','example','pronunciation','relation','batch','release')
      )`);

    // ── serving view: both directions, published only ──────────────────────
    // Stored one way, served both ways, so a symmetric relation cannot exist as
    // half a pair and the API needs no union of its own.
    await queryRunner.query(`
      CREATE VIEW "dsd_serving_relations" AS
        SELECT r."id",
               r."from_sense_id" AS "sense_id",
               r."to_sense_id"   AS "related_sense_id",
               r."relation_type"
          FROM "dsd_relations" r
          JOIN "dsd_senses" fs ON fs."id" = r."from_sense_id"
          JOIN "dsd_senses" ts ON ts."id" = r."to_sense_id"
          JOIN "dsd_entries" fe ON fe."id" = fs."dsd_entry_id"
          JOIN "dsd_entries" te ON te."id" = ts."dsd_entry_id"
         WHERE r."status" = 'published'
           AND fs."status" = 'published' AND ts."status" = 'published'
           AND fe."status" = 'published' AND te."status" = 'published'
        UNION ALL
        SELECT r."id",
               r."to_sense_id"   AS "sense_id",
               r."from_sense_id" AS "related_sense_id",
               r."relation_type"
          FROM "dsd_relations" r
          JOIN "dsd_senses" fs ON fs."id" = r."from_sense_id"
          JOIN "dsd_senses" ts ON ts."id" = r."to_sense_id"
          JOIN "dsd_entries" fe ON fe."id" = fs."dsd_entry_id"
          JOIN "dsd_entries" te ON te."id" = ts."dsd_entry_id"
         WHERE r."status" = 'published'
           AND fs."status" = 'published' AND ts."status" = 'published'
           AND fe."status" = 'published' AND te."status" = 'published'
           -- Directional relations are not reversible: a derived form of X is
           -- not the same statement as X being a derived form of it.
           AND r."relation_type" IN ('synonym','antonym','related','see_also')`);

    // ── role grants ────────────────────────────────────────────────────────
    // The serving role gets the view and never the table, matching every other
    // content table.
    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT, UPDATE ON "dsd_relations" TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_relations" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_relations" TO dsd_backup;`],
      ['dsd_app', `GRANT SELECT ON "dsd_serving_relations" TO dsd_app;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_serving_relations" TO dsd_auditor;`],
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
    await queryRunner.query(`DROP VIEW IF EXISTS "dsd_serving_relations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_relations"`);
    await queryRunner.query(
      `ALTER TABLE "dsd_entries" DROP CONSTRAINT IF EXISTS "CHK_dsd_entry_band_is_not_cefr"`);
    // Restore the narrower entity-kind list, so down() is a real inverse.
    await queryRunner.query(`
      ALTER TABLE "dsd_provenance_events" DROP CONSTRAINT IF EXISTS "CHK_dsd_event_kind"`);
    await queryRunner.query(`
      ALTER TABLE "dsd_provenance_events" ADD CONSTRAINT "CHK_dsd_event_kind" CHECK (
        "entity_kind" IN
          ('entry','sense','translation','example','pronunciation','batch','release')
      )`);
  }
}
