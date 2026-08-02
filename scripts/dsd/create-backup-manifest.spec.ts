import {
  MANIFEST_SCHEMA_VERSION,
  BackupManifest,
  canonicalManifest,
  manifestDigest,
  compareManifests,
  assertScratchNameSafe,
  rowCountAndDigestSql,
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
