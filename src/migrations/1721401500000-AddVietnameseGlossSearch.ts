import { MigrationInterface, QueryRunner } from 'typeorm';

function normalizeVietnameseSearch(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export class AddVietnameseGlossSearch1721401500000 implements MigrationInterface {
  name = 'AddVietnameseGlossSearch1721401500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "learner_sense_translations" ADD COLUMN "text_normalized" text',
    );

    const translations = await queryRunner.query(
      'SELECT "id", "text" FROM "learner_sense_translations"',
    ) as Array<{ id: string; text: string }>;
    for (const translation of translations) {
      const normalized = normalizeVietnameseSearch(translation.text);
      if (!normalized) {
        throw new Error(
          `Cannot build Vietnamese gloss search text for learner translation ${translation.id}`,
        );
      }
      await queryRunner.query(
        'UPDATE "learner_sense_translations" SET "text_normalized" = $1 WHERE "id" = $2',
        [normalized, translation.id],
      );
    }

    await queryRunner.query(
      'ALTER TABLE "learner_sense_translations" ALTER COLUMN "text_normalized" SET NOT NULL',
    );
    await queryRunner.query(`
      ALTER TABLE "learner_sense_translations"
      ADD CONSTRAINT "CHK_learner_translation_text_normalized"
      CHECK (length(btrim("text_normalized")) > 0)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_translation_vi_gloss"
      ON "learner_sense_translations" ("locale", "text_normalized" text_pattern_ops)
      WHERE "review_status" = 'approved'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_learner_translation_vi_gloss"');
    await queryRunner.query(
      'ALTER TABLE "learner_sense_translations" DROP CONSTRAINT "CHK_learner_translation_text_normalized"',
    );
    await queryRunner.query(
      'ALTER TABLE "learner_sense_translations" DROP COLUMN "text_normalized"',
    );
  }
}
