import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes exact duplicate legacy rows and installs the constraints that stop
 * them coming back.
 *
 * `examples.definition_id` is ON DELETE CASCADE, so deleting a duplicate
 * definition would silently take its examples with it. Measured on the live
 * corpus: 7,684 duplicate definitions carry 4,782 examples. This migration
 * therefore remaps those examples onto the retained definition first, and only
 * then deletes.
 *
 * The example uniqueness key includes the Vietnamese. Keying on English alone
 * would delete 3,878 rows, of which 1,223 carry a *different* translation of
 * the same sentence. Keying on both deletes only the 2,655 exact duplicates and
 * records the surviving multi-translation groups for human review.
 */
export class DedupeLegacyDictionaryRows1721402000000 implements MigrationInterface {
  name = 'DedupeLegacyDictionaryRows1721402000000';

  private static readonly SNAPSHOTS = [
    'cleanup_definition_remap',
    'cleanup_backup_definitions',
    'cleanup_backup_examples',
    'cleanup_backup_pronunciations',
    'cleanup_review_example_vi_conflicts',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Refuse to run on top of a stale snapshot. A partial backup from a
    //    failed run must never be silently reused as the rollback source.
    for (const table of DedupeLegacyDictionaryRows1721402000000.SNAPSHOTS) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF to_regclass('public.${table}') IS NOT NULL THEN
            RAISE EXCEPTION 'stale snapshot ${table} exists; review and drop it before re-running';
          END IF;
        END $$;`);
    }

    // The review report is retained after cleanup, unlike the backups, so it is
    // created explicitly rather than being covered by the snapshot rule.
    await queryRunner.query(`
      CREATE TABLE "cleanup_review_example_vi_conflicts" (
        "definition_id" bigint NOT NULL REFERENCES "definitions"("id") ON DELETE CASCADE,
        "example_en_digest" text NOT NULL,
        "example_ids" bigint[] NOT NULL,
        "variant_count" integer NOT NULL CHECK ("variant_count" > 1),
        PRIMARY KEY ("definition_id", "example_en_digest"))`);

    // 2. Map every duplicate definition to the lowest id in its group.
    await queryRunner.query(`
      CREATE TABLE "cleanup_definition_remap" (
        "old_id" bigint PRIMARY KEY,
        "keep_id" bigint NOT NULL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_definition_remap" ("old_id", "keep_id")
      SELECT d."id",
             min(d."id") OVER (PARTITION BY d."word_id", d."definition_en")
        FROM "definitions" d`);
    await queryRunner.query(`
      DELETE FROM "cleanup_definition_remap" WHERE "old_id" = "keep_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_cleanup_remap_keep" ON "cleanup_definition_remap" ("keep_id")`);

    // 3. Materialise the rows to KEEP, then drive both the backup and the
    //    delete off an indexed anti-join.
    //
    //    `DELETE ... WHERE id NOT IN (SELECT min(id) ... GROUP BY ...)` is the
    //    obvious formulation and is pathological here: it ran for over ten
    //    minutes on 361k examples without finishing, because NOT IN against a
    //    large subquery cannot be hashed away under NULL semantics. NOT EXISTS
    //    against a primary-keyed keep-set is a plain anti-join instead.
    //
    //    Grouping on md5 rather than the raw text keeps the aggregate cheap
    //    (example_en reaches 5,171 bytes) and matches the unique index below
    //    exactly. Step 5 proves no digest collision makes that unsafe.
    await queryRunner.query(`
      CREATE TABLE "cleanup_pronunciation_keep" AS
      SELECT min("id") AS "id" FROM "pronunciations"
       GROUP BY "word_id", "accent", "ipa"`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_pronunciation_keep" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_pronunciation_keep"`);

    // 3b. Back up everything that will change or disappear. LIKE ... INCLUDING
    //     ALL preserves column types and defaults so the restore is exact.
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_definitions" (LIKE "definitions" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_definitions"
      SELECT d.* FROM "definitions" d
       WHERE d."id" IN (SELECT "old_id" FROM "cleanup_definition_remap")`);

    // Every example touched by the remap OR by the dedupe that follows it.
    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_examples" (LIKE "examples" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_examples"
      SELECT e.* FROM "examples" e
       WHERE e."definition_id" IN (SELECT "old_id" FROM "cleanup_definition_remap")
          OR e."definition_id" IN (SELECT "keep_id" FROM "cleanup_definition_remap")`);

    await queryRunner.query(`
      CREATE TABLE "cleanup_backup_pronunciations" (LIKE "pronunciations" INCLUDING ALL)`);
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_pronunciations"
      SELECT p.* FROM "pronunciations" p
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_pronunciation_keep" k WHERE k."id" = p."id")`);

    // 4. Move examples onto the retained definition BEFORE any delete, so the
    //    cascade has nothing to take with it.
    await queryRunner.query(`
      UPDATE "examples" e
         SET "definition_id" = r."keep_id"
        FROM "cleanup_definition_remap" r
       WHERE e."definition_id" = r."old_id"`);

    // 5. Guard against an md5 collision before relying on digests for
    //    uniqueness. Comparing two DISTINCT counts is equivalent to checking
    //    every group individually, and is two hash aggregates rather than a
    //    DISTINCT aggregate evaluated per group.
    await queryRunner.query(`
      DO $$
      DECLARE by_digest bigint; by_text bigint;
      BEGIN
        SELECT count(*) INTO by_digest FROM (
          SELECT DISTINCT "definition_id", md5("example_en"), md5(COALESCE("example_vi", ''))
            FROM "examples") d;
        SELECT count(*) INTO by_text FROM (
          SELECT DISTINCT "definition_id", "example_en", COALESCE("example_vi", '')
            FROM "examples") t;
        IF by_digest <> by_text THEN
          RAISE EXCEPTION 'md5 collision: % digest groups vs % text groups; aborting',
                          by_digest, by_text;
        END IF;
      END $$;`);

    // 6. Remove exact duplicates. Vietnamese participates in the key, so rows
    //    with a distinct translation survive. The keep-set is built AFTER the
    //    remap in step 4, so it sees the post-remap grouping.
    await queryRunner.query(`
      CREATE TABLE "cleanup_example_keep" AS
      SELECT min("id") AS "id" FROM "examples"
       GROUP BY "definition_id", md5("example_en"), md5(COALESCE("example_vi", ''))`);
    await queryRunner.query(
      `ALTER TABLE "cleanup_example_keep" ADD PRIMARY KEY ("id")`);
    await queryRunner.query(`ANALYZE "cleanup_example_keep"`);

    // Top up the backup before deleting. Step 3b captured every example
    // attached to a remapped definition, but the corpus also contains exact
    // duplicates on definitions that were never remapped — 15 such rows on the
    // live data. Those are deleted below, so without this they would be
    // unrecoverable and down() would silently restore a short table.
    // Their definition_id is untouched by the remap, so capturing them now is
    // equivalent to capturing them earlier.
    await queryRunner.query(`
      INSERT INTO "cleanup_backup_examples"
      SELECT e.* FROM "examples" e
       WHERE NOT EXISTS (
             SELECT 1 FROM "cleanup_example_keep" k WHERE k."id" = e."id")
         AND NOT EXISTS (
             SELECT 1 FROM "cleanup_backup_examples" b WHERE b."id" = e."id")`);

    await queryRunner.query(`
      DELETE FROM "examples" e
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_example_keep" k WHERE k."id" = e."id")`);
    await queryRunner.query(`
      DELETE FROM "pronunciations" p
       WHERE NOT EXISTS (
         SELECT 1 FROM "cleanup_pronunciation_keep" k WHERE k."id" = p."id")`);
    await queryRunner.query(`DROP TABLE "cleanup_example_keep"`);
    await queryRunner.query(`DROP TABLE "cleanup_pronunciation_keep"`);

    // 7. The doomed definitions now carry no examples.
    await queryRunner.query(`
      DELETE FROM "definitions"
       WHERE "id" IN (SELECT "old_id" FROM "cleanup_definition_remap")`);

    // 8. Install the constraints that prevent recurrence. combine-data.ts still
    //    emits duplicates, so a re-import without these reintroduces them.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_definitions_word_text"
        ON "definitions" ("word_id", "definition_en")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pronunciations_word_accent_ipa"
        ON "pronunciations" ("word_id", "accent", "ipa")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_examples_definition_digest"
        ON "examples" ("definition_id", md5("example_en"), md5(COALESCE("example_vi", '')))`);

    // 9. Record the groups that kept more than one Vietnamese variant. These
    //    are a real defect awaiting human review, not legitimate content.
    await queryRunner.query(`
      INSERT INTO "cleanup_review_example_vi_conflicts"
        ("definition_id", "example_en_digest", "example_ids", "variant_count")
      SELECT "definition_id", md5("example_en"), array_agg("id" ORDER BY "id"), count(*)
        FROM "examples"
       GROUP BY "definition_id", md5("example_en")
      HAVING count(*) > 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_examples_definition_digest"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_pronunciations_word_accent_ipa"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_definitions_word_text"`);

    // Parents first, or the examples FK rejects the restore.
    await queryRunner.query(`
      INSERT INTO "definitions" SELECT * FROM "cleanup_backup_definitions"`);

    // Replace the whole affected example set rather than patching it, so rows
    // that were remapped are returned to their original definition_id.
    await queryRunner.query(`
      DELETE FROM "examples"
       WHERE "id" IN (SELECT "id" FROM "cleanup_backup_examples")`);
    await queryRunner.query(`
      INSERT INTO "examples" SELECT * FROM "cleanup_backup_examples"`);

    await queryRunner.query(`
      INSERT INTO "pronunciations" SELECT * FROM "cleanup_backup_pronunciations"`);

    // Explicit ids were re-inserted, so the sequences must be advanced.
    for (const table of ['definitions', 'examples', 'pronunciations']) {
      await queryRunner.query(`
        SELECT setval(pg_get_serial_sequence('${table}','id'),
                      (SELECT max("id") FROM "${table}"), true)`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_pronunciations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_examples"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_backup_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_definition_remap"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleanup_review_example_vi_conflicts"`);
  }
}
