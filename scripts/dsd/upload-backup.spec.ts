import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BackupUploadConfig,
  parseBackupUploadConfig,
  uploadBackupPair,
} from './upload-backup';

const config: BackupUploadConfig = {
  bucket: 'dsd-backups',
  prefix: 'production',
  region: 'ap-southeast-1',
  kmsKeyId: 'kms-key-1',
  retentionDays: 30,
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-backup-upload-'));
  const dumpPath = path.join(dir, 'dsd.dump');
  const manifestPath = path.join(dir, 'dsd.manifest.json');
  fs.writeFileSync(dumpPath, 'snapshot bytes');
  const bytes = fs.statSync(dumpPath).size;
  const hash = crypto.createHash('sha256').update('snapshot bytes').digest('hex');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      database: 'dsd_corpus_db',
      dumpFile: 'dsd.dump',
      dumpBytes: bytes,
      dumpSha256: hash,
    }),
  );
  return { dumpPath, manifestPath, bytes, hash };
}

function clientFor(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  let object = 0;
  return {
    send: jest.fn(async (command: any) => {
      const name = command.constructor.name;
      if (name === 'GetBucketVersioningCommand') return { Status: 'Enabled' };
      if (name === 'PutObjectCommand') return { VersionId: `v${++object}` };
      if (name === 'HeadObjectCommand') {
        const version = command.input.VersionId;
        const isDump = command.input.Key.endsWith('.dump');
        const file = isDump ? f.dumpPath : f.manifestPath;
        return {
          VersionId: version,
          ContentLength: fs.statSync(file).size,
          Metadata: {
            sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
          },
          ChecksumSHA256: crypto
            .createHash('sha256')
            .update(fs.readFileSync(file))
            .digest('base64'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: config.kmsKeyId,
          ObjectLockRetainUntilDate: new Date(Date.now() + 31 * 86400_000),
          ...overrides,
        };
      }
      throw new Error(`unexpected ${name}`);
    }),
  };
}

describe('backup upload configuration', () => {
  it('requires a versioned retention policy and explicit KMS key', () => {
    expect(
      parseBackupUploadConfig({
        DSD_BACKUP_S3_URI: 's3://dsd-backups/production',
        DSD_BACKUP_KMS_KEY_ID: 'kms-key-1',
        DSD_BACKUP_RETENTION_DAYS: '30',
      } as any),
    ).toMatchObject({ bucket: 'dsd-backups', prefix: 'production', retentionDays: 30 });
    expect(() => parseBackupUploadConfig({ DSD_BACKUP_S3_URI: 's3://x' } as any)).toThrow(
      /KMS_KEY_ID/,
    );
  });
});

describe('uploadBackupPair', () => {
  it('uploads both files and verifies their exact remote versions', async () => {
    const f = fixture();
    const client = clientFor(f);
    const result = await uploadBackupPair({ client, config, ...f });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      key: 'production/dsd_corpus_db/dsd.dump',
      versionId: 'v1',
      sha256: f.hash,
    });
    expect(client.send).toHaveBeenCalledTimes(5);
  });

  it('refuses an unversioned bucket', async () => {
    const f = fixture();
    const client = { send: jest.fn().mockResolvedValue({ Status: 'Suspended' }) };
    await expect(uploadBackupPair({ client, config, ...f })).rejects.toThrow(/versioning enabled/);
  });

  it('refuses a remote object whose metadata does not match', async () => {
    const f = fixture();
    const client = clientFor(f, { Metadata: { sha256: 'bad' } });
    await expect(uploadBackupPair({ client, config, ...f })).rejects.toThrow(/SHA-256/);
  });

  it('refuses local bytes that no longer match their manifest', async () => {
    const f = fixture();
    fs.appendFileSync(f.dumpPath, 'tampered');
    await expect(
      uploadBackupPair({ client: clientFor(f), config, ...f }),
    ).rejects.toThrow(/local dump does not match/);
  });
});
