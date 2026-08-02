import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deletes the 35,953 definitions whose English body was lost at parse time,
 * leaving only a Wiktionary label: `(archaic)`, `(medicine) .`, `( )`.
 *
 * Their Vietnamese is the translated label rather than a definition, so there
 * is nothing to salvage in the database. dictionary-presenter.ts already drops
 * every row flagged empty_definition, so no client output changes — this makes
 * the stored data agree with what the API has always served.
 *
 * 19,614 words lose their only definition and become explicitly undefined.
 * That is the honest state; they were already undefined in practice.
 *
 * Recovering the lost bodies means re-parsing the 12 GB Wiktionary dump still
 * on disk, and is deliberately out of scope.
 */
export class RemoveEmptyDefinitions1721403000000 implements MigrationInterface {
  name = 'RemoveEmptyDefinitions1721403000000';

  private static readonly SNAPSHOTS = [
    'cleanup_backup_empty_definitions',
    'cleanup_backup_empty_definition_examples',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of RemoveEmptyDefinitions1721403000000.SNAPSHOTS) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_empty_definitions" (LIKE "definitions" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_empty_definitions"
      SELECT d.* FROM "definitions" d
       WHERE 'empty_definition' = ANY(d."quality_flags")`);

    // Back these up BEFORE the parent delete or the cascade takes them with no
    // record. 8,448 of the doomed definitions carry examples.
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_empty_definition_examples" (LIKE "examples" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_empty_definition_examples"
      SELECT e.* FROM "examples" e
       WHERE e."definition_id" IN (SELECT "id" FROM "cleanup_backup_empty_definitions")`);

    await queryRunner.query(`
      DELETE FROM "definitions"
       WHERE "id" IN (SELECT "id" FROM "cleanup_backup_empty_definitions")`);

    // Fail closed: nothing flagged empty_definition may survive, and no example
    // may be left pointing at a deleted parent.
    await queryRunner.query(`
      DO $$
      DECLARE remaining bigint; orphans bigint;
      BEGIN
        SELECT count(*) INTO remaining FROM "definitions"
         WHERE 'empty_definition' = ANY("quality_flags");
        IF remaining > 0 THEN
          RAISE EXCEPTION '% empty definition(s) survived the delete', remaining;
        END IF;

        SELECT count(*) INTO orphans FROM "examples" e
          LEFT JOIN "definitions" d ON d."id" = e."definition_id"
         WHERE d."id" IS NULL;
        IF orphans > 0 THEN
          RAISE EXCEPTION '% orphaned example(s) after delete', orphans;
        END IF;
      END $$;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Parents first, or the examples foreign key rejects the restore.
    await queryRunner.query(`
      INSERT INTO "definitions" SELECT * FROM "cleanup_backup_empty_definitions"`);
    await queryRunner.query(`
      INSERT INTO "examples" SELECT * FROM "cleanup_backup_empty_definition_examples"`);

    for (const table of ['definitions', 'examples']) {
      await queryRunner.query(`
        SELECT setval(pg_get_serial_sequence('${table}','id'),
                      (SELECT max("id") FROM "${table}"), true)`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_empty_definition_examples"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_empty_definitions"`);
  }
}
