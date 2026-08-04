import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The record of a release package that was actually built and verified.
 *
 * A release audit says a corpus *could* be released. This table says a specific
 * set of bytes *was* built from it, signed by a named key, and verified
 * afterwards. Those are different claims, and conflating them is how a customer
 * ends up with a package nobody can tie back to a decision.
 *
 * Three rules live here:
 *
 *   1. **A build is immutable.** Every field describing what was produced is
 *      frozen once written. A package cannot be re-signed, re-hashed or
 *      re-attributed after the fact; building again produces a new row.
 *   2. **A public build requires a public-eligible release.** The pilot cannot
 *      be published from here either, and the CHECK says so in the schema.
 *   3. **The row is written last.** The export transaction is read-only, so this
 *      insert happens separately, after the package and its detached signature
 *      have verified. A record of a build that failed verification would be
 *      worse than no record.
 */
export class AddDsdReleaseBuilds1785629300000 implements MigrationInterface {
  name = 'AddDsdReleaseBuilds1785629300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dsd_release_builds" (
        "id"                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

        "release_id"             varchar(64)  NOT NULL,
        "channel"                varchar(16)  NOT NULL,
        "public_eligible"        boolean      NOT NULL,

        -- What was built.
        "manifest_sha256"        char(64)     NOT NULL,
        "signature"              text         NOT NULL,
        "signer_key_id"          varchar(64)  NOT NULL,
        "signature_algorithm"    varchar(32)  NOT NULL DEFAULT 'ed25519',

        -- What it was built from.
        "source_database"        varchar(64)  NOT NULL,
        "source_migration"       varchar(32)  NOT NULL,
        "source_date_epoch"      bigint       NOT NULL,
        "similarity_policy_sha256" char(64)   NOT NULL,
        "source_registry_sha256" char(64)     NOT NULL,
        "tool_registry_sha256"   char(64)     NOT NULL,
        "contributor_registry_sha256" char(64) NOT NULL,

        -- What the audit concluded, and what the package contains.
        "audit_version"          varchar(64)  NOT NULL,
        "entry_count"            integer      NOT NULL,
        "sense_count"            integer      NOT NULL,
        "audio_asset_count"      integer      NOT NULL,
        "territories"            text[]       NOT NULL,

        "built_at"               timestamptz  NOT NULL DEFAULT now(),
        "built_by"               varchar(64)  NOT NULL,
        "created_at"             timestamptz  NOT NULL DEFAULT now(),

        -- The same bytes for the same release is the same build. Re-running a
        -- deterministic export must not accumulate rows.
        CONSTRAINT "UQ_dsd_release_build" UNIQUE ("release_id", "manifest_sha256"),

        CONSTRAINT "CHK_dsd_release_build_channel"
          CHECK ("channel" IN ('internal','public')),
        CONSTRAINT "CHK_dsd_release_build_hashes" CHECK (
          "manifest_sha256" ~ '^[0-9a-f]{64}$'
          AND "similarity_policy_sha256" ~ '^[0-9a-f]{64}$'
          AND "source_registry_sha256" ~ '^[0-9a-f]{64}$'
          AND "tool_registry_sha256" ~ '^[0-9a-f]{64}$'
          AND "contributor_registry_sha256" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "CHK_dsd_release_build_signature" CHECK (
          length(btrim("signature")) > 0
          AND length(btrim("signer_key_id")) > 0
          AND "signature_algorithm" = 'ed25519'
        ),
        -- Rule 2. A pilot cannot be published from here either.
        CONSTRAINT "CHK_dsd_release_build_public_needs_eligibility" CHECK (
          "channel" <> 'public' OR "public_eligible" = true
        ),
        CONSTRAINT "CHK_dsd_release_build_counts" CHECK (
          "entry_count" > 0 AND "sense_count" > 0 AND "audio_asset_count" >= 0
        ),
        CONSTRAINT "CHK_dsd_release_build_territories"
          CHECK (array_length("territories", 1) > 0),
        CONSTRAINT "CHK_dsd_release_build_actor" CHECK (length(btrim("built_by")) > 0),
        -- SOURCE_DATE_EPOCH is what makes two exports byte-identical; a build
        -- that did not record one cannot be reproduced.
        CONSTRAINT "CHK_dsd_release_build_epoch" CHECK ("source_date_epoch" > 0)
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_release_build_release" ON "dsd_release_builds" ("release_id")`);

    // ── guard: a build record is immutable ─────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_release_build_immutable()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION
          'a release build record is immutable; build again to produce a new one'
          USING ERRCODE = 'check_violation';
      END $fn$;`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_release_build_immutable"
        BEFORE UPDATE OR DELETE ON "dsd_release_builds"
        FOR EACH ROW EXECUTE FUNCTION dsd_release_build_immutable()`);

    // ── role grants ────────────────────────────────────────────────────────
    // The curator writes the record after verification. The serving role is not
    // granted anything: which packages exist is not a customer-facing fact.
    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT ON "dsd_release_builds" TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_release_builds" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_release_builds" TO dsd_backup;`],
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
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_release_builds"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_release_build_immutable()`);
  }
}
