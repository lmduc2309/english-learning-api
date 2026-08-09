import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBackupProof } from './record-backup-proof';

function addBackup(dir: string, database: string, migration: string): void {
  const stem = `${database}-2026-08-09T00-00-00-000Z`;
  const dump = Buffer.from(`${database}-dump`);
  const dumpSha256 = crypto.createHash('sha256').update(dump).digest('hex');
  const manifestPath = path.join(dir, `${stem}.manifest.json`);
  const manifest = {
    manifestSchemaVersion: 1,
    database,
    createdAt: '2026-08-09T00:00:00.000Z',
    snapshotId: '1:2:',
    postgresVersion: 'PostgreSQL 15',
    pgDumpVersion: 'pg_dump 15',
    dumpFile: `${stem}.dump`,
    dumpSha256,
    dumpBytes: dump.length,
    migrations: { table: 'migrations', applied: [migration] },
    tables: [],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(path.join(dir, `${stem}.dump`), dump);
  const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  fs.writeFileSync(path.join(dir, `${stem}.remote.json`), JSON.stringify({
    schemaVersion: 1,
    database,
    verifiedRemote: true,
    verifiedAt: '2026-08-09T01:00:00.000Z',
    manifestSha256,
    objects: [
      { key: `${stem}.dump`, versionId: 'dump-v1', sha256: dumpSha256, bytes: dump.length },
      { key: `${stem}.manifest.json`, versionId: 'manifest-v1', sha256: manifestSha256, bytes: manifestBytes.length },
    ],
  }));
  fs.writeFileSync(path.join(dir, `${stem}.restore.json`), JSON.stringify({
    schemaVersion: 1,
    database,
    verifiedAt: '2026-08-09T02:00:00.000Z',
    manifestSha256,
    dumpSha256,
  }));
}

describe('backup proof', () => {
  it('binds a successful proof to both verified off-host object pairs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-proof-'));
    addBackup(dir, 'dsd_corpus_db', 'HardenDsdCommercialBoundary1785629500000');
    addBackup(dir, 'english_learning_db', 'Legacy1721403400000');
    const proof = buildBackupProof({
      dir,
      dsdDatabase: 'dsd_corpus_db',
      legacyDatabase: 'english_learning_db',
    });
    expect(proof).toMatchObject({
      offHostCopy: true,
      migrationVersion: '1785629500000',
      verifiedAt: '2026-08-09T02:00:00.000Z',
    });
    expect(proof.databases).toHaveLength(2);
  });

  it('refuses to refresh evidence without matching successful restores', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-proof-'));
    addBackup(dir, 'dsd_corpus_db', 'M1785629500000');
    addBackup(dir, 'english_learning_db', 'M1721403400000');
    fs.unlinkSync(path.join(dir, 'dsd_corpus_db-2026-08-09T00-00-00-000Z.restore.json'));
    expect(() => buildBackupProof({
      dir,
      dsdDatabase: 'dsd_corpus_db',
      legacyDatabase: 'english_learning_db',
    })).toThrow(/successful restore receipt is missing/);
  });

  it('refuses to claim off-host recovery without a matching receipt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-proof-'));
    addBackup(dir, 'dsd_corpus_db', 'M1785629500000');
    addBackup(dir, 'english_learning_db', 'M1721403400000');
    fs.unlinkSync(path.join(dir, 'english_learning_db-2026-08-09T00-00-00-000Z.remote.json'));
    expect(() => buildBackupProof({
      dir,
      dsdDatabase: 'dsd_corpus_db',
      legacyDatabase: 'english_learning_db',
    })).toThrow(/receipt is missing/);
  });
});
