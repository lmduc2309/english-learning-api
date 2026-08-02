import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Storage for the compliance similarity audit.
 *
 * The table records that a comparison happened and how close it was. It does
 * not record what was compared against: no legacy text, no legacy row id, only
 * a digest that proves a match without keeping it. That is invariant 1 holding
 * at the one point in the system where legacy data is legitimately read.
 *
 * Three rules are enforced here rather than in the tool:
 *
 *   1. An exact match can never be cleared as independently authored. In v1
 *      the only remedy is a rewrite, which produces new text, a new content
 *      hash, and a new audit.
 *   2. A manual clearance requires a named compliance reviewer, a timestamp
 *      and an evidence ID. A verdict nobody signed is not a clearance.
 *   3. The measurement is immutable. Scores, hashes and versions cannot be
 *      edited after the fact; only the decision fields may change. A result
 *      that could be rescored on demand would justify anything.
 *
 * There is deliberately no free-text rationale column. The compliance reviewer
 * who writes one has just been looking at legacy wording, and a text box in
 * DSD is exactly where that wording would end up. The rationale lives in the
 * compliance record that decision_evidence_id points at, outside this database.
 */
export class AddDsdSimilarityAudit1785628900000 implements MigrationInterface {
  name = 'AddDsdSimilarityAudit1785628900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dsd_similarity_results" (
        "id"                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "entity_kind"           varchar(16)  NOT NULL,
        "entity_id"             uuid         NOT NULL,
        "record_type"           varchar(16)  NOT NULL,
        "content_sha256"        char(64)     NOT NULL,
        "normalization_version" integer      NOT NULL,
        "algorithm_version"     integer      NOT NULL,
        "policy_version"        varchar(32)  NOT NULL,
        "policy_sha256"         char(64)     NOT NULL,
        "component_scores"      jsonb        NOT NULL,
        "match_class"           varchar(16)  NOT NULL,
        "legacy_digest"         char(64),
        "decision"              varchar(32)  NOT NULL,
        "decision_reason"       varchar(64),
        "decision_evidence_id"  varchar(64),
        "decided_by"            varchar(64),
        "decided_at"            timestamptz,
        "audited_by"            varchar(64)  NOT NULL,
        "audited_at"            timestamptz  NOT NULL DEFAULT now(),
        "created_at"            timestamptz  NOT NULL DEFAULT now(),

        -- One current verdict per piece of text per policy. Re-auditing the
        -- same text under the same policy must update, never accumulate.
        CONSTRAINT "UQ_dsd_similarity_content_policy"
          UNIQUE ("entity_kind", "entity_id", "content_sha256", "policy_sha256"),

        CONSTRAINT "CHK_dsd_similarity_entity_kind"
          CHECK ("entity_kind" IN ('sense','example')),
        CONSTRAINT "CHK_dsd_similarity_record_type"
          CHECK ("record_type" IN ('definition','example')),
        CONSTRAINT "CHK_dsd_similarity_content_sha"
          CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_dsd_similarity_policy_sha"
          CHECK ("policy_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_dsd_similarity_legacy_digest"
          CHECK ("legacy_digest" IS NULL OR "legacy_digest" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_dsd_similarity_match_class"
          CHECK ("match_class" IN ('exact','high','medium','low')),
        CONSTRAINT "CHK_dsd_similarity_decision"
          CHECK ("decision" IN
            ('clear','manual_review','rewrite_required','independently_authored_cleared')),

        -- Rule 1. Not available in v1, and not by accident either.
        CONSTRAINT "CHK_dsd_similarity_exact_never_cleared" CHECK (
          "match_class" <> 'exact' OR "decision" <> 'independently_authored_cleared'
        ),
        -- Rule 2. A clearance is a signed act.
        CONSTRAINT "CHK_dsd_similarity_manual_clearance" CHECK (
          "decision" NOT IN ('rewrite_required','independently_authored_cleared') OR (
            "decided_by" IS NOT NULL AND length(btrim("decided_by")) > 0
            AND "decided_at" IS NOT NULL
            AND "decision_evidence_id" IS NOT NULL
            AND length(btrim("decision_evidence_id")) > 0
            AND "decision_reason" IS NOT NULL
            AND length(btrim("decision_reason")) > 0
          )
        ),
        -- A low-similarity result is cleared by measurement, not by a person.
        CONSTRAINT "CHK_dsd_similarity_auto_clear" CHECK (
          "decision" <> 'clear' OR "match_class" = 'low'
        ),
        CONSTRAINT "CHK_dsd_similarity_auditor"
          CHECK (length(btrim("audited_by")) > 0)
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_similarity_entity" ON "dsd_similarity_results" ("entity_kind", "entity_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_similarity_class" ON "dsd_similarity_results" ("match_class", "decision")`);

    // ── guard: the measurement is immutable ────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_similarity_measurement_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."entity_kind"           IS DISTINCT FROM OLD."entity_kind"
           OR NEW."entity_id"          IS DISTINCT FROM OLD."entity_id"
           OR NEW."record_type"        IS DISTINCT FROM OLD."record_type"
           OR NEW."content_sha256"     IS DISTINCT FROM OLD."content_sha256"
           OR NEW."normalization_version" IS DISTINCT FROM OLD."normalization_version"
           OR NEW."algorithm_version"  IS DISTINCT FROM OLD."algorithm_version"
           OR NEW."policy_version"     IS DISTINCT FROM OLD."policy_version"
           OR NEW."policy_sha256"      IS DISTINCT FROM OLD."policy_sha256"
           OR NEW."component_scores"   IS DISTINCT FROM OLD."component_scores"
           OR NEW."match_class"        IS DISTINCT FROM OLD."match_class"
           OR NEW."legacy_digest"      IS DISTINCT FROM OLD."legacy_digest"
           OR NEW."audited_by"         IS DISTINCT FROM OLD."audited_by"
           OR NEW."audited_at"         IS DISTINCT FROM OLD."audited_at" THEN
          RAISE EXCEPTION
            'a similarity measurement cannot be edited; re-audit to produce a new one'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_similarity_measurement_immutable"
        BEFORE UPDATE ON "dsd_similarity_results"
        FOR EACH ROW EXECUTE FUNCTION dsd_similarity_measurement_immutable()`);

    // ── guard: no legacy identifier may be smuggled into the scores blob ───
    // component_scores is jsonb, the one free-shaped column here. Restricting
    // it to the numbers the algorithm produces keeps it from becoming a place
    // to stash a legacy row id.
    //
    // Expressed with the jsonb delete operator rather than a subquery over
    // jsonb_object_keys, because a CHECK constraint may not contain a
    // subquery: removing the known keys must leave an empty object.
    await queryRunner.query(`
      ALTER TABLE "dsd_similarity_results" ADD CONSTRAINT "CHK_dsd_similarity_scores_shape" CHECK (
        jsonb_typeof("component_scores") = 'object'
        AND ("component_scores" - ARRAY[
              'exact','tokenJaccard','wordNgramJaccard','charNgramJaccard',
              'cosine','longestRun','longestRunRatio'
            ]) = '{}'::jsonb
        AND "component_scores" ?& ARRAY['exact','tokenJaccard','cosine','longestRun']
      )`);

    // ── role grants ────────────────────────────────────────────────────────
    // The auditor writes results and records decisions. The curator may read
    // them, so an author can be told to rewrite, but cannot write a verdict on
    // their own work.
    // The body of a DO block is dollar-quoted, so its SQL is written plainly.
    for (const [role, sql] of [
      ['dsd_auditor', `GRANT SELECT, INSERT, UPDATE ON "dsd_similarity_results" TO dsd_auditor;`],
      ['dsd_curator', `GRANT SELECT ON "dsd_similarity_results" TO dsd_curator;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_similarity_results" TO dsd_backup;`],
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
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_similarity_results"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_similarity_measurement_immutable()`);
  }
}
