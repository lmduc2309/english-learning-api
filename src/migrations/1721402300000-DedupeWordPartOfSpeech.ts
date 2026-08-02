import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes repeated values from words.part_of_speech.
 *
 * The column is text[], not a delimited string — the CSV export flattens it
 * with " | ", which is why it can look malformed. 74,383 of 475,153 rows hold
 * duplicates, one reaching cardinality 122.
 *
 * Order is preserved by first occurrence, because callers treat position 0 as
 * the primary part of speech.
 */
export class DedupeWordPartOfSpeech1721402300000 implements MigrationInterface {
  name = 'DedupeWordPartOfSpeech1721402300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Refuse to run on top of a stale snapshot.
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.cleanup_backup_words_pos') IS NOT NULL THEN
          RAISE EXCEPTION 'stale snapshot cleanup_backup_words_pos exists; review and drop it before re-running';
        END IF;
      END $$;`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_words_pos" AS
      SELECT "id", "part_of_speech" FROM "words"
       WHERE cardinality("part_of_speech")
             <> cardinality(ARRAY(SELECT DISTINCT unnest("part_of_speech")))`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_backup_words_pos" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_backup_words_pos"`);

    // Rebuild each array keeping the first occurrence of each value.
    await queryRunner.query(`
      UPDATE "words" w
         SET "part_of_speech" = d."deduped"
        FROM (
          SELECT b."id",
                 ARRAY(
                   SELECT pos FROM (
                     SELECT pos, min(ord) AS first_at
                       FROM unnest(b."part_of_speech") WITH ORDINALITY AS t(pos, ord)
                      GROUP BY pos
                   ) g ORDER BY g.first_at
                 ) AS "deduped"
            FROM "cleanup_backup_words_pos" b
        ) d
       WHERE w."id" = d."id"`);

    // Fail closed: nothing may be left with repeats, and no array may be
    // emptied by the rewrite.
    await queryRunner.query(`
      DO $$
      DECLARE remaining bigint; emptied bigint;
      BEGIN
        SELECT count(*) INTO remaining FROM "words"
         WHERE cardinality("part_of_speech")
               <> cardinality(ARRAY(SELECT DISTINCT unnest("part_of_speech")));
        IF remaining > 0 THEN
          RAISE EXCEPTION '% word(s) still hold duplicate parts of speech', remaining;
        END IF;
        SELECT count(*) INTO emptied FROM "words" w
          JOIN "cleanup_backup_words_pos" b ON b."id" = w."id"
         WHERE cardinality(w."part_of_speech") = 0
           AND cardinality(b."part_of_speech") > 0;
        IF emptied > 0 THEN
          RAISE EXCEPTION '% word(s) lost every part of speech', emptied;
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "words" w
         SET "part_of_speech" = b."part_of_speech"
        FROM "cleanup_backup_words_pos" b
       WHERE w."id" = b."id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_words_pos"`);
  }
}
