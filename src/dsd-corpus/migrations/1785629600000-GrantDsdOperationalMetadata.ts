import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expose only TypeORM's migration ledger to the two operational readers that
 * must prove database state. The auditor records the release snapshot version;
 * the backup role must be able to include the ledger in a full pg_dump.
 */
export class GrantDsdOperationalMetadata1785629600000 implements MigrationInterface {
  name = 'GrantDsdOperationalMetadata1785629600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const role of ['dsd_auditor', 'dsd_backup']) {
      await queryRunner.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          GRANT SELECT ON "dsd_migrations" TO ${role};
        END IF;
      END $$`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const role of ['dsd_auditor', 'dsd_backup']) {
      await queryRunner.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          REVOKE SELECT ON "dsd_migrations" FROM ${role};
        END IF;
      END $$`);
    }
  }
}
