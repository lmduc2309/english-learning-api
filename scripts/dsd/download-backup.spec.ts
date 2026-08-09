import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { downloadNewestBackupPair } from './download-backup';
import { BackupUploadConfig } from './upload-backup';

const config: BackupUploadConfig = {
  bucket: 'backups',
  prefix: 'production',
  region: 'ap-southeast-1',
  kmsKeyId: 'arn:aws:kms:ap-southeast-1:123:key/abc',
  retentionDays: 30,
};

function remoteFixture(overrides: Record<string, unknown> = {}) {
  const database = 'dsd_corpus_db';
  const stem = `${database}-2026-08-09T00-00-00-000Z`;
  const dump = Buffer.from('dump bytes');
  const dumpSha256 = crypto.createHash('sha256').update(dump).digest('hex');
  const manifest = Buffer.from(JSON.stringify({
    manifestSchemaVersion: 1,
    database,
    createdAt: '2026-08-09T00:00:00.000Z',
    snapshotId: '1:2:',
    postgresVersion: 'PostgreSQL 15',
    pgDumpVersion: 'pg_dump 15',
    dumpFile: `${stem}.dump`,
    dumpSha256,
    dumpBytes: dump.length,
    migrations: { table: 'dsd_migrations', applied: ['M1785629500000'] },
    tables: [],
  }));
  const manifestSha256 = crypto.createHash('sha256').update(manifest).digest('hex');
  const keys: Record<string, { bytes: Buffer; sha256: string; versionId: string }> = {
    [`production/${database}/${stem}.dump`]: { bytes: dump, sha256: dumpSha256, versionId: 'dv1' },
    [`production/${database}/${stem}.manifest.json`]: {
      bytes: manifest,
      sha256: manifestSha256,
      versionId: 'mv1',
    },
  };
  const client = {
    send: jest.fn(async (command: any) => {
      const name = command.constructor.name;
      if (name === 'ListObjectVersionsCommand') {
        return {
          IsTruncated: false,
          Versions: Object.entries(keys).map(([Key, value]) => ({
            Key,
            VersionId: value.versionId,
            LastModified: new Date('2026-08-09T01:00:00.000Z'),
            Size: value.bytes.length,
          })),
        };
      }
      const value = keys[command.input.Key];
      if (name === 'HeadObjectCommand') {
        return {
          VersionId: value.versionId,
          ContentLength: value.bytes.length,
          Metadata: { sha256: value.sha256 },
          ChecksumSHA256: Buffer.from(value.sha256, 'hex').toString('base64'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: config.kmsKeyId,
          ObjectLockRetainUntilDate: new Date(Date.now() + 86400_000),
          ...overrides,
        };
      }
      if (name === 'GetObjectCommand') {
        return { VersionId: value.versionId, Body: value.bytes };
      }
      throw new Error(`unexpected command ${name}`);
    }),
  };
  return { client, database, dump, manifest };
}

describe('off-host backup download', () => {
  it('downloads exact versions only after KMS, retention, size and hashes verify', async () => {
    const remote = remoteFixture();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-download-'));
    const result = await downloadNewestBackupPair({
      client: remote.client,
      config,
      database: remote.database,
      outDir,
    });
    expect(fs.readFileSync(result.dumpPath)).toEqual(remote.dump);
    expect(fs.readFileSync(result.manifestPath)).toEqual(remote.manifest);
    expect(JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'))).toMatchObject({
      verifiedRemote: true,
      database: remote.database,
    });
  });

  it('refuses an object whose retention has expired', async () => {
    const remote = remoteFixture({ ObjectLockRetainUntilDate: new Date(0) });
    await expect(downloadNewestBackupPair({
      client: remote.client,
      config,
      database: remote.database,
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-download-')),
    })).rejects.toThrow(/retention is missing or expired/);
  });

  it('refuses an object encrypted with a different KMS key', async () => {
    const remote = remoteFixture({ SSEKMSKeyId: 'wrong-key' });
    await expect(downloadNewestBackupPair({
      client: remote.client,
      config,
      database: remote.database,
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-download-')),
    })).rejects.toThrow(/KMS encryption\/key does not match/);
  });
});
