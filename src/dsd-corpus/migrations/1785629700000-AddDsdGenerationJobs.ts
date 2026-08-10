import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resumable, auditable AI generation ledger.
 *
 * It stores DSD request/result identity and accounting only. There is no legacy
 * identifier, wording, match, rank, or source position. Generation jobs may be
 * updated as they advance, but the database refuses backward state transitions
 * and refuses changing the hashes/model identity after a job is submitted.
 */
export class AddDsdGenerationJobs1785629700000 implements MigrationInterface {
  name = 'AddDsdGenerationJobs1785629700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dsd_generation_runs" (
        "id"                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "target_id"              varchar(64) NOT NULL,
        "wave_id"                varchar(32) NOT NULL,
        "run_kind"               varchar(16) NOT NULL,
        "state"                  varchar(16) NOT NULL DEFAULT 'planned',
        "provider_id"            varchar(32) NOT NULL,
        "endpoint"               varchar(32) NOT NULL,
        "requested_model"        varchar(64) NOT NULL,
        "prompt_sha256"          char(64) NOT NULL,
        "schema_sha256"          char(64) NOT NULL,
        "max_requests"           integer NOT NULL,
        "max_input_tokens"       bigint NOT NULL,
        "max_output_tokens"      bigint NOT NULL,
        "max_cost_microusd"      bigint NOT NULL,
        "request_count"          integer NOT NULL DEFAULT 0,
        "input_tokens"           bigint NOT NULL DEFAULT 0,
        "output_tokens"          bigint NOT NULL DEFAULT 0,
        "cost_microusd"          bigint NOT NULL DEFAULT 0,
        "provider_batch_id"      varchar(128),
        "started_at"             timestamptz,
        "completed_at"           timestamptz,
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dsd_generation_run_wave" UNIQUE ("wave_id", "run_kind", "prompt_sha256", "schema_sha256"),
        CONSTRAINT "CHK_dsd_generation_run_kind" CHECK ("run_kind" IN ('inventory','text','critic','repair')),
        CONSTRAINT "CHK_dsd_generation_run_state" CHECK ("state" IN ('planned','running','paused','completed','failed','cancelled')),
        CONSTRAINT "CHK_dsd_generation_run_provider" CHECK ("provider_id" = 'openai'),
        CONSTRAINT "CHK_dsd_generation_run_endpoint" CHECK ("endpoint" IN ('responses','batch')),
        CONSTRAINT "CHK_dsd_generation_run_hashes" CHECK (
          "prompt_sha256" ~ '^[0-9a-f]{64}$' AND "schema_sha256" ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT "CHK_dsd_generation_run_limits" CHECK (
          "max_requests" > 0 AND "max_input_tokens" > 0
          AND "max_output_tokens" > 0 AND "max_cost_microusd" > 0
        ),
        CONSTRAINT "CHK_dsd_generation_run_usage" CHECK (
          "request_count" >= 0 AND "input_tokens" >= 0
          AND "output_tokens" >= 0 AND "cost_microusd" >= 0
          AND "request_count" <= "max_requests"
          AND "input_tokens" <= "max_input_tokens"
          AND "output_tokens" <= "max_output_tokens"
          AND "cost_microusd" <= "max_cost_microusd"
        )
      )`);

    await queryRunner.query(`
      CREATE TABLE "dsd_generation_jobs" (
        "id"                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "run_id"                 uuid NOT NULL REFERENCES "dsd_generation_runs"("id") ON DELETE RESTRICT,
        "dsd_entry_id"           uuid REFERENCES "dsd_entries"("id") ON DELETE RESTRICT,
        "custom_id"              varchar(128) NOT NULL,
        "state"                  varchar(24) NOT NULL DEFAULT 'queued',
        "attempt_count"          smallint NOT NULL DEFAULT 0,
        "input_sha256"           char(64) NOT NULL,
        "prompt_sha256"          char(64) NOT NULL,
        "schema_sha256"          char(64) NOT NULL,
        "provider_request_id"    varchar(128),
        "response_model"         varchar(128),
        "output_sha256"          char(64),
        "input_tokens"           integer NOT NULL DEFAULT 0,
        "output_tokens"          integer NOT NULL DEFAULT 0,
        "cost_microusd"          bigint NOT NULL DEFAULT 0,
        "lease_owner"            varchar(64),
        "lease_expires_at"       timestamptz,
        "retry_after"            timestamptz,
        "error_code"             varchar(64),
        "quarantine_reason"      text,
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        "completed_at"           timestamptz,
        CONSTRAINT "UQ_dsd_generation_job_custom" UNIQUE ("run_id", "custom_id"),
        CONSTRAINT "CHK_dsd_generation_job_state" CHECK ("state" IN (
          'queued','submitted','received','schema_valid','quality_valid',
          'imported_draft','review_ready','retry_wait','quarantined','terminal_failure'
        )),
        CONSTRAINT "CHK_dsd_generation_job_attempt" CHECK ("attempt_count" BETWEEN 0 AND 10),
        CONSTRAINT "CHK_dsd_generation_job_hashes" CHECK (
          "input_sha256" ~ '^[0-9a-f]{64}$'
          AND "prompt_sha256" ~ '^[0-9a-f]{64}$'
          AND "schema_sha256" ~ '^[0-9a-f]{64}$'
          AND ("output_sha256" IS NULL OR "output_sha256" ~ '^[0-9a-f]{64}$')
        ),
        CONSTRAINT "CHK_dsd_generation_job_usage" CHECK (
          "input_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_microusd" >= 0
        ),
        CONSTRAINT "CHK_dsd_generation_job_quarantine" CHECK (
          "state" <> 'quarantined' OR length(btrim("quarantine_reason")) > 0
        )
      )`);

    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_generation_run_state" ON "dsd_generation_runs" ("state", "wave_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_generation_job_state" ON "dsd_generation_jobs" ("run_id", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dsd_generation_job_entry" ON "dsd_generation_jobs" ("dsd_entry_id")`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dsd_guard_generation_job_identity()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE
        old_rank integer;
        new_rank integer;
      BEGIN
        IF NEW."run_id" <> OLD."run_id"
           OR NEW."custom_id" <> OLD."custom_id"
           OR NEW."dsd_entry_id" IS DISTINCT FROM OLD."dsd_entry_id"
           OR NEW."input_sha256" <> OLD."input_sha256"
           OR NEW."prompt_sha256" <> OLD."prompt_sha256"
           OR NEW."schema_sha256" <> OLD."schema_sha256" THEN
          RAISE EXCEPTION 'generation job identity and hashes are immutable'
            USING ERRCODE = 'check_violation';
        END IF;

        old_rank := array_position(ARRAY[
          'queued','submitted','received','schema_valid','quality_valid',
          'imported_draft','review_ready'
        ], OLD."state");
        new_rank := array_position(ARRAY[
          'queued','submitted','received','schema_valid','quality_valid',
          'imported_draft','review_ready'
        ], NEW."state");
        IF old_rank IS NOT NULL AND new_rank IS NOT NULL AND new_rank < old_rank THEN
          RAISE EXCEPTION 'generation job state cannot move backward from % to %', OLD."state", NEW."state"
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $fn$`);

    await queryRunner.query(`
      CREATE TRIGGER "TRG_dsd_generation_job_identity"
        BEFORE UPDATE ON "dsd_generation_jobs"
        FOR EACH ROW EXECUTE FUNCTION dsd_guard_generation_job_identity()`);

    for (const [role, sql] of [
      ['dsd_curator', `GRANT SELECT, INSERT, UPDATE ON "dsd_generation_runs", "dsd_generation_jobs" TO dsd_curator;`],
      ['dsd_auditor', `GRANT SELECT ON "dsd_generation_runs", "dsd_generation_jobs" TO dsd_auditor;`],
      ['dsd_backup', `GRANT SELECT ON "dsd_generation_runs", "dsd_generation_jobs" TO dsd_backup;`],
    ] as Array<[string, string]>) {
      await queryRunner.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          ${sql}
        END IF;
      END $$`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_generation_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dsd_generation_runs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS dsd_guard_generation_job_identity()`);
  }
}
