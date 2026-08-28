import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds accent-insensitive, indexed Vietnamese lookup over the existing
 * production dictionary. This derives search keys at query/index time and does
 * not create or import a second corpus.
 */
export class AddPrimaryVietnameseSearch1721403500000
  implements MigrationInterface
{
  name = 'AddPrimaryVietnameseSearch1721403500000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION dictionary_normalize_search(value text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $fn$
        SELECT btrim(
          regexp_replace(
            lower(unaccent(coalesce(value, ''))),
            '[^a-z0-9]+',
            ' ',
            'g'
          )
        )
      $fn$
    `);
    await queryRunner.query(`
      ALTER TABLE "definitions"
      ADD COLUMN IF NOT EXISTS "definition_vi_normalized" text
      GENERATED ALWAYS AS (
        dictionary_normalize_search("definition_vi")
      ) STORED
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_definitions_vi_search_trgm"
      ON "definitions"
      USING gin ("definition_vi_normalized" gin_trgm_ops)
      WHERE "definition_vi" IS NOT NULL
        AND btrim("definition_vi") <> ''
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_definitions_vi_search_prefix_c"
      ON "definitions" (("definition_vi_normalized" COLLATE "C"))
      WHERE "definition_vi" IS NOT NULL
        AND btrim("definition_vi") <> ''
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_learner_translation_vi_search_trgm"
      ON "learner_sense_translations"
      USING gin ("text_normalized" gin_trgm_ops)
      WHERE "review_status" = 'approved'
        AND "locale" = 'vi'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_learner_translation_vi_search_trgm"',
    );
    await queryRunner.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_definitions_vi_search_prefix_c"',
    );
    await queryRunner.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_definitions_vi_search_trgm"',
    );
    await queryRunner.query(
      'ALTER TABLE "definitions" DROP COLUMN IF EXISTS "definition_vi_normalized"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS dictionary_normalize_search(text)',
    );
  }
}
