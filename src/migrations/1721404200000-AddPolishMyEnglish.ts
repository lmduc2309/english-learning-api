import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPolishMyEnglish1721404200000 implements MigrationInterface {
  name = 'AddPolishMyEnglish1721404200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "polish_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "source_app" character varying(80) NOT NULL,
        "tone" character varying(10) NOT NULL,
        "raw_text" text NOT NULL,
        "edited_text" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_polish_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_polish_sessions_user_created" ON "polish_sessions" ("user_id", "created_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE "polish_corrections" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "session_id" uuid NOT NULL,
        "kind" character varying(10) NOT NULL,
        "pattern_code" character varying(40) NOT NULL,
        "wrong_text" text NOT NULL,
        "right_text" text NOT NULL,
        "explanation_vi" text NOT NULL,
        "minor" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_polish_corrections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_polish_corrections_session" FOREIGN KEY ("session_id")
          REFERENCES "polish_sessions" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_polish_corrections_pattern" ON "polish_corrections" ("pattern_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_polish_corrections_session" ON "polish_corrections" ("session_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "polish_phrases" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "session_id" uuid,
        "text" character varying(200) NOT NULL,
        "source_sentence" text NOT NULL,
        "situation_code" character varying(40) NOT NULL DEFAULT 'other',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_polish_phrases" PRIMARY KEY ("id"),
        CONSTRAINT "FK_polish_phrases_session" FOREIGN KEY ("session_id")
          REFERENCES "polish_sessions" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_polish_phrases_user_text" ON "polish_phrases" ("user_id", lower("text"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "polish_phrases"`);
    await queryRunner.query(`DROP TABLE "polish_corrections"`);
    await queryRunner.query(`DROP TABLE "polish_sessions"`);
  }
}
