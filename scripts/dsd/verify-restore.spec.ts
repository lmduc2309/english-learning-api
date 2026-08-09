import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BackupManifest } from './create-backup-manifest';
import {
  assertDumpMatchesManifest,
  newestBackup,
  restoreReceiptPath,
  restoreConnection,
} from './verify-restore';

describe('restore rehearsal credentials', () => {
  it('accepts only the dedicated restore operator on the maintenance database', () => {
    expect(restoreConnection({
      DSD_RESTORE_DATABASE_URL:
        'postgres://dsd_restore_operator:secret@postgres:5432/postgres',
    } as NodeJS.ProcessEnv)).toEqual({
      host: 'postgres',
      port: 5432,
      user: 'dsd_restore_operator',
      password: 'secret',
    });
  });

  it('never falls back to application or owner credentials', () => {
    expect(() => restoreConnection({ DB_USERNAME: 'dictionary_user' } as NodeJS.ProcessEnv))
      .toThrow(/never fall back/);
    expect(() => restoreConnection({
      DSD_RESTORE_DATABASE_URL: 'postgres://postgres:x@postgres:5432/postgres',
    } as NodeJS.ProcessEnv)).toThrow(/expected 'dsd_restore_operator'/);
    expect(() => restoreConnection({
      DSD_RESTORE_DATABASE_URL:
        'postgres://dsd_restore_operator:x@postgres:5432/dsd_corpus_db',
    } as NodeJS.ProcessEnv)).toThrow(/maintenance database 'postgres'/);
  });
});

describe('restore input integrity', () => {
  let dir: string;
  let dump: Buffer;
  let manifest: BackupManifest;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-restore-input-'));
    dump = Buffer.from('custom-format-dump');
    manifest = {
      manifestSchemaVersion: 1,
      database: 'dsd_corpus_db',
      createdAt: '2026-08-09T00:00:00.000Z',
      snapshotId: 'snapshot',
      postgresVersion: 'PostgreSQL 15',
      pgDumpVersion: 'custom-format',
      dumpFile: 'dsd_corpus_db-2026-08-09.dump',
      dumpSha256: crypto.createHash('sha256').update(dump).digest('hex'),
      dumpBytes: dump.length,
      migrations: { table: 'dsd_migrations', applied: [] },
      tables: [],
    };
  });

  function writeFixture(): { dumpPath: string; manifestPath: string } {
    const dumpPath = path.join(dir, manifest.dumpFile);
    const manifestPath = path.join(
      dir,
      'dsd_corpus_db-2026-08-09.manifest.json',
    );
    fs.writeFileSync(dumpPath, dump);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return { dumpPath, manifestPath };
  }

  it('accepts bytes bound to the selected manifest', () => {
    const paths = writeFixture();
    expect(newestBackup(dir, 'dsd_corpus_db')).toEqual(paths);
    expect(() => assertDumpMatchesManifest(paths.dumpPath, manifest)).not.toThrow();
  });

  it('rejects a changed dump before restore', () => {
    const paths = writeFixture();
    fs.appendFileSync(paths.dumpPath, 'changed');
    expect(() => assertDumpMatchesManifest(paths.dumpPath, manifest)).toThrow(
      /does not match/,
    );
  });

  it('rejects a manifest for another database or an unsafe dump path', () => {
    writeFixture();
    const manifestPath = path.join(
      dir,
      'dsd_corpus_db-2026-08-09.manifest.json',
    );
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, database: 'other_db' }));
    expect(() => newestBackup(dir, 'dsd_corpus_db')).toThrow(/names.*expected/);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, dumpFile: '../outside.dump' }),
    );
    expect(() => newestBackup(dir, 'dsd_corpus_db')).toThrow(/unsafe dump filename/);
  });

  it('derives a restore receipt beside the exact manifest', () => {
    expect(restoreReceiptPath('/backups/x.manifest.json')).toBe(
      '/backups/x.restore.json',
    );
    expect(() => restoreReceiptPath('/backups/x.json')).toThrow(/unexpected manifest/);
  });
});
