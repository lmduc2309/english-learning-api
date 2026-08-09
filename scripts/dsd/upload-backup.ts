/** Upload and verify one snapshot-bound backup pair in versioned KMS storage. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  GetBucketVersioningCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BackupManifest } from './create-backup-manifest';

dotenv.config();

export interface BackupUploadConfig {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
  kmsKeyId: string;
  retentionDays: number;
}

export interface UploadedBackupObject {
  key: string;
  versionId: string;
  sha256: string;
  bytes: number;
}

interface S3Sender {
  send(command: unknown): Promise<any>;
}

export function createBackupS3Client(config: BackupUploadConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
  });
}

export function parseBackupUploadConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackupUploadConfig {
  const uri = env.DSD_BACKUP_S3_URI ?? '';
  const match = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(uri);
  if (!match) throw new Error('DSD_BACKUP_S3_URI must look like s3://bucket/prefix');
  const kmsKeyId = (env.DSD_BACKUP_KMS_KEY_ID ?? '').trim();
  if (!kmsKeyId) throw new Error('DSD_BACKUP_KMS_KEY_ID is required');
  const retentionDays = Number(env.DSD_BACKUP_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('DSD_BACKUP_RETENTION_DAYS must be a positive integer');
  }
  return {
    bucket: match[1],
    prefix: (match[2] ?? '').replace(/^\/+|\/+$/g, ''),
    region: env.DSD_BACKUP_S3_REGION || 'ap-southeast-1',
    endpoint: env.DSD_BACKUP_S3_ENDPOINT || undefined,
    kmsKeyId,
    retentionDays,
  };
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function keyFor(config: BackupUploadConfig, database: string, file: string): string {
  return [config.prefix, database, path.basename(file)].filter(Boolean).join('/');
}

async function putAndVerify(
  client: S3Sender,
  config: BackupUploadConfig,
  database: string,
  file: string,
  sha256: string,
): Promise<UploadedBackupObject> {
  const bytes = fs.statSync(file).size;
  const key = keyFor(config, database, file);
  const checksum = Buffer.from(sha256, 'hex').toString('base64');
  const retainedUntil = new Date(
    Date.now() + config.retentionDays * 24 * 60 * 60 * 1000,
  );
  const put = await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fs.createReadStream(file),
      ContentLength: bytes,
      ChecksumSHA256: checksum,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: config.kmsKeyId,
      ObjectLockMode: 'GOVERNANCE',
      ObjectLockRetainUntilDate: retainedUntil,
      Metadata: { sha256, database },
    }),
  );
  const head = await client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
      VersionId: put.VersionId,
      ChecksumMode: 'ENABLED',
    }),
  );
  if (!put.VersionId || !head.VersionId) throw new Error(`${key}: object version id is missing`);
  if (head.VersionId !== put.VersionId) throw new Error(`${key}: verified a different object version`);
  if (Number(head.ContentLength) !== bytes) throw new Error(`${key}: remote size mismatch`);
  if (head.Metadata?.sha256 !== sha256) throw new Error(`${key}: remote SHA-256 metadata mismatch`);
  if (head.ChecksumSHA256 !== checksum) throw new Error(`${key}: remote SHA-256 checksum mismatch`);
  if (head.ServerSideEncryption !== 'aws:kms') throw new Error(`${key}: remote object is not KMS encrypted`);
  if (head.SSEKMSKeyId !== config.kmsKeyId) throw new Error(`${key}: remote KMS key does not match`);
  if (!head.ObjectLockRetainUntilDate || head.ObjectLockRetainUntilDate < retainedUntil) {
    throw new Error(`${key}: remote retention is missing or shorter than requested`);
  }
  return { key, versionId: head.VersionId, sha256, bytes };
}

export async function uploadBackupPair(options: {
  client: S3Sender;
  config: BackupUploadConfig;
  dumpPath: string;
  manifestPath: string;
}): Promise<UploadedBackupObject[]> {
  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, 'utf8')) as BackupManifest;
  const dumpStat = fs.statSync(options.dumpPath);
  const dumpSha256 = await sha256File(options.dumpPath);
  if (path.basename(options.dumpPath) !== manifest.dumpFile) {
    throw new Error('dump filename does not match the snapshot manifest');
  }
  if (dumpStat.size !== manifest.dumpBytes || dumpSha256 !== manifest.dumpSha256) {
    throw new Error('local dump does not match the snapshot manifest');
  }
  const versioning = await options.client.send(
    new GetBucketVersioningCommand({ Bucket: options.config.bucket }),
  );
  if (versioning.Status !== 'Enabled') {
    throw new Error(`backup bucket '${options.config.bucket}' does not have versioning enabled`);
  }
  const manifestSha256 = await sha256File(options.manifestPath);
  return [
    await putAndVerify(
      options.client,
      options.config,
      manifest.database,
      options.dumpPath,
      dumpSha256,
    ),
    await putAndVerify(
      options.client,
      options.config,
      manifest.database,
      options.manifestPath,
      manifestSha256,
    ),
  ];
}

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const config = parseBackupUploadConfig();
  const client = createBackupS3Client(config);
  const uploaded = await uploadBackupPair({
    client,
    config,
    dumpPath: arg('dump'),
    manifestPath: arg('manifest'),
  });
  for (const object of uploaded) {
    console.log(`${object.key}  ${object.bytes} bytes  version ${object.versionId}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
