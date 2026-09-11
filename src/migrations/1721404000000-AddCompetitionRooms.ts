import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompetitionRooms1721404000000 implements MigrationInterface {
  name = 'AddCompetitionRooms1721404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_rooms" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "code" varchar(6) NOT NULL UNIQUE,
      "name" varchar(80) NOT NULL,
      "host_name" varchar(32) NOT NULL,
      "host_token_hash" varchar(64) NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'lobby',
      "questions" jsonb NOT NULL,
      "seconds_per_question" smallint NOT NULL DEFAULT 20,
      "started_at" timestamptz,
      "ended_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_players" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "room_id" uuid NOT NULL REFERENCES "competition_rooms"("id") ON DELETE CASCADE,
      "name" varchar(32) NOT NULL,
      "token_hash" varchar(64) NOT NULL,
      "score" integer NOT NULL DEFAULT 0,
      "last_seen_at" timestamptz NOT NULL DEFAULT now(),
      "joined_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_competition_player_room_name" UNIQUE ("room_id", "name")
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_players_room" ON "competition_players" ("room_id")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "competition_answers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "room_id" uuid NOT NULL REFERENCES "competition_rooms"("id") ON DELETE CASCADE,
      "player_id" uuid NOT NULL REFERENCES "competition_players"("id") ON DELETE CASCADE,
      "question_index" smallint NOT NULL,
      "answer" text NOT NULL DEFAULT '',
      "is_correct" boolean,
      "used_hint" boolean NOT NULL DEFAULT false,
      "points" integer NOT NULL DEFAULT 0,
      "response_ms" integer,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_competition_answer_player_question" UNIQUE ("player_id", "question_index")
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_competition_answers_room" ON "competition_answers" ("room_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "competition_answers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "competition_players"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "competition_rooms"`);
  }
}
