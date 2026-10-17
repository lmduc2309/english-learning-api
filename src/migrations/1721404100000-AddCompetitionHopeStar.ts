import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompetitionHopeStar1721404100000 implements MigrationInterface {
  name = 'AddCompetitionHopeStar1721404100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "competition_players"
      ADD COLUMN IF NOT EXISTS "hope_star_question_index" smallint`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "competition_players"
      DROP COLUMN IF EXISTS "hope_star_question_index"`);
  }
}
