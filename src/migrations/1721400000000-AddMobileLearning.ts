import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMobileLearning1721400000000 implements MigrationInterface {
  name = 'AddMobileLearning1721400000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "folder_ids" uuid[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "review_stage" smallint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "next_review_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "last_reviewed_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "review_successes" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "word_lists" ADD COLUMN IF NOT EXISTS "review_failures" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lookup_history" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "query" varchar(255) NOT NULL, "direction" varchar(8) NOT NULL, "canonical_result" varchar(255), "created_at" timestamptz NOT NULL DEFAULT now())`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lookup_history_user" ON "lookup_history" ("user_id")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "word_folders" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "name" varchar(80) NOT NULL, "color" varchar(12) NOT NULL DEFAULT '#F4A300', "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "UQ_word_folder_user_name" UNIQUE ("user_id", "name"))`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "word_folders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lookup_history"`);
    await queryRunner.query(`ALTER TABLE "word_lists" DROP COLUMN IF EXISTS "review_failures", DROP COLUMN IF EXISTS "review_successes", DROP COLUMN IF EXISTS "last_reviewed_at", DROP COLUMN IF EXISTS "next_review_at", DROP COLUMN IF EXISTS "review_stage", DROP COLUMN IF EXISTS "folder_ids"`);
  }
}
