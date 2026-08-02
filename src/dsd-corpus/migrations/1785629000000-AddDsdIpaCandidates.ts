import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Machine-generated IPA candidates, which are working material and never
 * content.
 *
 * A candidate is a suggestion from a tool. The published pronunciation is a
 * human decision recorded in dsd_pronunciations, authored and reviewed like
 * every other DSD record. Keeping the two in separate tables is the point: as
 * long as a candidate cannot become a pronunciation by changing a status
 * column, no amount of pressure or oversight turns generated output into
 * published content.
 *
 * Three things enforce that here rather than in the tool:
 *
 *   1. The status CHECK admits 'candidate', 'rejected' and 'superseded' only.
 *      There is no value that means approved or published, so there is nothing
 *      to set.
 *   2. There is no foreign key from a pronunciation to a candidate. A
 *      pronunciation cannot point at generated output as its source, and the
 *      release gate has no path to reach one.
 *   3. dsd_app is granted nothing. The serving role cannot read this table at
 *      all, so no API response can contain a candidate even by mistake.
 *
 * Every candidate records the exact tool, revision and artifact that produced
 * it, and the digest of the headword it was produced from. A candidate whose
 * tool cannot be identified is not evidence of anything.
 */
export class AddDsdIpaCandidates1785629000000 implements MigrationInterface {
  name = 'AddDsdIpaCandidates1785629000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dsd_ipa_candidates" (
        "id"                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "dsd_entry_id"        uuid         NOT NULL REFERENCES "dsd_entries"("id") ON DELETE CASCADE,
        "accent"              varchar(16)  NOT NULL,
        "candidate_ipa"       text         NOT NULL,
        "input_headword_hash" char(64)     NOT NULL,
        "tool_id"             varchar(64)  NOT NULL,
        "tool_revision"       varchar(64)  NOT NULL,
        "artifact_sha256"     char(64)     NOT NULL,
        "configuration"       jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "generated_at"        timestamptz  NOT NULL DEFAULT now(),
        "status"              varchar(16)  NOT NULL DEFAULT 'candidate',
        "created_at"          timestamptz  NOT NULL DEFAULT now(),

        -- The same tool at the same revision on the same input is the same
        -- candidate. Re-running must not accumulate rows.
        CONSTRAINT "UQ_dsd_ipa_candidate_input" UNIQUE
          ("dsd_entry_id", "accent", "tool_id", "tool_revision", "input_headword_hash"),

        -- Rule 1. No status here means approved or published, in any spelling.
        CONSTRAINT "CHK_dsd_ipa_candidate_status"
          CHECK ("status" IN ('candidate','rejected','superseded')),
        CONSTRAINT "CHK_dsd_ipa_candidate_accent" CHECK ("accent" IN ('en-US')),
        CONSTRAINT "CHK_dsd_ipa_candidate_value" CHECK (length(btrim("candidate_ipa")) > 0),
        CONSTRAINT "CHK_dsd_ipa_candidate_input_hash"
          CHECK ("input_headword_hash" ~ '^[0-9a-f]{64}$'),
        -- A candidate that cannot name the artifact that produced it is not
        -- reproducible, and an irreproducible suggestion is not evidence.
        CONSTRAINT "CHK_dsd_ipa_candidate_artifact"
          CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_dsd_ipa_candidate_tool" CHECK (
          length(btrim("tool_id")) > 0 AND length(btrim("tool_revision")) > 0
        )
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_ipa_candidate_entry" ON "dsd_ipa_candidates" ("dsd_entry_id")`);

    // ── guard: a candidate may never be promoted in place ──────────────────
    // The CHECK already forbids an approved status. This forbids the other
    // route: editing the generated value so a stale candidate quietly becomes
    // whatever someone wanted it to say.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_ipa_candidate_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW."candidate_ipa"        IS DISTINCT FROM OLD."candidate_ipa"
           OR NEW."input_headword_hash" IS DISTINCT FROM OLD."input_headword_hash"
           OR NEW."tool_id"           IS DISTINCT FROM OLD."tool_id"
           OR NEW."tool_revision"     IS DISTINCT FROM OLD."tool_revision"
           OR NEW."artifact_sha256"   IS DISTINCT FROM OLD."artifact_sha256"
           OR NEW."configuration"     IS DISTINCT FROM OLD."configuration"
           OR NEW."generated_at"      IS DISTINCT FROM OLD."generated_at" THEN
          RAISE EXCEPTION
            'a generated IPA candidate cannot be edited; re-generate to produce a new one'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_ipa_candidate_immutable"
        BEFORE UPDATE ON "dsd_ipa_candidates"
        FOR EACH ROW EXECUTE FUNCTION dsd_ipa_candidate_immutable()`);

    // ── role grants ────────────────────────────────────────────────────────
    // Rule 3. dsd_app is absent on purpose: the serving role cannot read this
    // table, so a candidate cannot reach an API response by any query at all.
    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT, UPDATE ON "dsd_ipa_candidates" TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_ipa_candidates" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_ipa_candidates" TO dsd_backup;`],
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
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_ipa_candidates"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_ipa_candidate_immutable()`);
  }
}
