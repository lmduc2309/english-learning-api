import * as fs from 'fs';
import * as path from 'path';
import {
  MANIFEST_SCHEMA_VERSION,
  BackupManifest,
  canonicalManifest,
  manifestDigest,
  compareManifests,
  assertScratchNameSafe,
  rowCountAndDigestSql,
  backupConnectionForDatabase,
} from './create-backup-manifest';

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    database: 'dsd_corpus_db',
    createdAt: '2026-08-02T10:00:00.000Z',
    snapshotId: '00000003-00000002-1',
    postgresVersion: 'PostgreSQL 15.15',
    pgDumpVersion: 'pg_dump (PostgreSQL) 15.15',
    dumpFile: 'dsd_corpus_db-2026-08-02T10-00-00.dump',
    dumpSha256: 'a'.repeat(64),
    dumpBytes: 12345,
    migrations: { table: 'dsd_migrations', applied: ['CreateDsdCoreSchema1785628000000'] },
    tables: [
      { name: 'dsd_entries', rowCount: 500, contentDigest: 'b'.repeat(32) },
      { name: 'dsd_senses', rowCount: 1000, contentDigest: 'c'.repeat(32) },
    ],
    ...overrides,
  };
}

describe('canonicalManifest', () => {
  it('is stable regardless of key insertion order', () => {
    const a = manifest();
    const b: BackupManifest = JSON.parse(JSON.stringify(manifest()));
    // Rebuild with keys in a different order.
    const shuffled = Object.fromEntries(
      Object.entries(b).reverse(),
    ) as unknown as BackupManifest;
    expect(canonicalManifest(shuffled)).toBe(canonicalManifest(a));
  });

  it('is stable regardless of table order', () => {
    const ordered = manifest();
    const reversed = manifest({ tables: [...manifest().tables].reverse() });
    expect(canonicalManifest(reversed)).toBe(canonicalManifest(ordered));
  });

  it('changes when any table digest changes', () => {
    const changed = manifest({
      tables: [
        { name: 'dsd_entries', rowCount: 500, contentDigest: 'z'.repeat(32) },
        { name: 'dsd_senses', rowCount: 1000, contentDigest: 'c'.repeat(32) },
      ],
    });
    expect(canonicalManifest(changed)).not.toBe(canonicalManifest(manifest()));
  });
});

describe('manifestDigest', () => {
  it('is a sha256 hex digest', () => {
    expect(manifestDigest(manifest())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores fields that legitimately differ between a dump and its restore', () => {
    // A restored copy has a different name, creation time, snapshot and dump
    // file. Those must not make an otherwise-identical restore look corrupt.
    const restored = manifest({
      database: 'dsd_restore_check_1234',
      createdAt: '2026-08-02T18:00:00.000Z',
      snapshotId: '00000009-00000008-1',
      dumpFile: 'other.dump',
      dumpSha256: 'f'.repeat(64),
      dumpBytes: 999,
    });
    expect(manifestDigest(restored)).toBe(manifestDigest(manifest()));
  });

  it('does not ignore content', () => {
    const restored = manifest({
      database: 'dsd_restore_check_1234',
      tables: [
        { name: 'dsd_entries', rowCount: 499, contentDigest: 'b'.repeat(32) },
        { name: 'dsd_senses', rowCount: 1000, contentDigest: 'c'.repeat(32) },
      ],
    });
    expect(manifestDigest(restored)).not.toBe(manifestDigest(manifest()));
  });
});

describe('compareManifests', () => {
  it('reports no differences for an identical restore', () => {
    expect(compareManifests(manifest(), manifest({ database: 'scratch' }))).toEqual([]);
  });

  it('reports a row-count drift with the table named', () => {
    const restored = manifest({
      tables: [
        { name: 'dsd_entries', rowCount: 499, contentDigest: 'b'.repeat(32) },
        { name: 'dsd_senses', rowCount: 1000, contentDigest: 'c'.repeat(32) },
      ],
    });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(
      /dsd_entries.*row count.*500.*499/i,
    );
  });

  it('reports a content drift even when the row count matches', () => {
    // The failure mode row counts cannot see.
    const restored = manifest({
      tables: [
        { name: 'dsd_entries', rowCount: 500, contentDigest: 'z'.repeat(32) },
        { name: 'dsd_senses', rowCount: 1000, contentDigest: 'c'.repeat(32) },
      ],
    });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(
      /dsd_entries.*content digest/i,
    );
  });

  it('reports a missing table rather than silently ignoring it', () => {
    const restored = manifest({ tables: [manifest().tables[0]] });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(/dsd_senses.*missing/i);
  });

  it('reports an unexpected extra table', () => {
    const restored = manifest({
      tables: [...manifest().tables, { name: 'surprise', rowCount: 1, contentDigest: 'd'.repeat(32) }],
    });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(/surprise.*unexpected/i);
  });

  it('reports a migration-state difference', () => {
    const restored = manifest({ migrations: { table: 'dsd_migrations', applied: [] } });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(/migration/i);
  });

  it('refuses to compare across manifest schema versions', () => {
    const restored = manifest({ manifestSchemaVersion: MANIFEST_SCHEMA_VERSION + 1 });
    expect(compareManifests(manifest(), restored).join(' ')).toMatch(/schema version/i);
  });
});

describe('assertScratchNameSafe', () => {
  const protectedNames = ['dsd_corpus_db', 'english_learning_db'];

  it('accepts a uniquely named scratch database', () => {
    expect(() =>
      assertScratchNameSafe('dsd_restore_check_1754130000', protectedNames),
    ).not.toThrow();
  });

  it.each(['dsd_corpus_db', 'english_learning_db'])('refuses the production name %s', (name) => {
    expect(() => assertScratchNameSafe(name, protectedNames)).toThrow(/production database/i);
  });

  it('refuses a production name differing only by case or padding', () => {
    expect(() => assertScratchNameSafe(' DSD_Corpus_DB ', protectedNames)).toThrow(
      /production database/i,
    );
  });

  it('refuses a name that is not a plain identifier, so it cannot carry SQL', () => {
    expect(() => assertScratchNameSafe('scratch; DROP DATABASE x', protectedNames)).toThrow(
      /identifier/i,
    );
  });

  it('requires the scratch prefix, so a typo cannot target something real', () => {
    expect(() => assertScratchNameSafe('some_other_db', protectedNames)).toThrow(/prefix/i);
  });
});

describe('rowCountAndDigestSql', () => {
  it('orders by primary key so the digest is deterministic', () => {
    const sql = rowCountAndDigestSql('dsd_entries');
    expect(sql).toMatch(/order by/i);
  });

  it('digests the whole row, not a column subset', () => {
    expect(rowCountAndDigestSql('dsd_entries')).toMatch(/md5\(t::text\)|to_jsonb/i);
  });

  it('quotes the table name', () => {
    expect(rowCountAndDigestSql('dsd_entries')).toContain('"dsd_entries"');
  });
});

describe('backup credentials', () => {
  const env = {
    DB_DATABASE: 'english_learning_db',
    DSD_DB_DATABASE: 'dsd_corpus_db',
    LEGACY_BACKUP_DATABASE_URL:
      'postgres://legacy_backup:legacy-secret@postgres:5432/english_learning_db',
    DSD_BACKUP_DATABASE_URL:
      'postgres://dsd_backup:dsd-secret@postgres:5432/dsd_corpus_db',
  } as NodeJS.ProcessEnv;

  it('selects the DSD backup role only for the DSD database', () => {
    expect(backupConnectionForDatabase('dsd_corpus_db', env)).toMatchObject({
      user: 'dsd_backup',
      password: 'dsd-secret',
    });
  });

  it('selects the legacy backup role only for the legacy database', () => {
    expect(backupConnectionForDatabase('english_learning_db', env)).toMatchObject({
      user: 'legacy_backup',
      password: 'legacy-secret',
    });
  });

  it('never falls back to the application credential', () => {
    expect(() =>
      backupConnectionForDatabase('dsd_corpus_db', {
        ...env,
        DSD_BACKUP_DATABASE_URL: undefined,
        DB_USERNAME: 'dictionary_user',
        DB_PASSWORD: 'secret',
      }),
    ).toThrow(/required; backup credentials never fall back/);
  });

  it('refuses a URL with the wrong database or role', () => {
    expect(() =>
      backupConnectionForDatabase('dsd_corpus_db', {
        ...env,
        DSD_BACKUP_DATABASE_URL:
          'postgres://dsd_backup:x@postgres:5432/english_learning_db',
      }),
    ).toThrow(/targets.*expected/);
    expect(() =>
      backupConnectionForDatabase('dsd_corpus_db', {
        ...env,
        DSD_BACKUP_DATABASE_URL:
          'postgres://dsd_owner:x@postgres:5432/dsd_corpus_db',
      }),
    ).toThrow(/uses.*expected 'dsd_backup'/);
  });
});

describe('backup secret handling', () => {
  it('passes only the PGPASSWORD name to docker, never its value in argv', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'create-backup-manifest.ts'),
      'utf8',
    );
    expect(source).toContain("['exec', '-e', 'PGPASSWORD'");
    expect(source).not.toContain('`PGPASSWORD=${password}`');
  });

  it('keeps provisioned role passwords out of the psql command line', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'provision-dsd-database.sh'),
      'utf8',
    );
    expect(source).toContain('\\getenv dsd_provision_password');
    expect(source).not.toContain("PASSWORD '$pw'");
  });

  it('keeps the workbench superuser password out of docker argv', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'create-workbench.sh'),
      'utf8',
    );
    expect(source).toContain('docker exec -e PGPASSWORD');
    expect(source).not.toContain('-e PGPASSWORD="$PW"');
    expect(source).not.toContain("PASSWORD '$LOCAL_PW'");
  });
});
