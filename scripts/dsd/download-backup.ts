/** Download and verify the newest complete off-host backup for one database. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { BackupManifest } from './create-backup-manifest';
import {
  BackupUploadConfig,
  createBackupS3Client,
  parseBackupUploadConfig,
} from './upload-backup';
import { remoteReceiptPath } from './backup-offhost';

dotenv.config();

interface S3Sender {
  send(command: unknown): Promise<any>;
}

interface RemoteVersion {
  Key?: string;
  VersionId?: string;
  LastModified?: Date;
  Size?: number;
}

export interface DownloadedBackup {
  dumpPath: string;
  manifestPath: string;
  receiptPath: string;
}

function objectPrefix(config: BackupUploadConfig, database: string): string {
  return [config.prefix, database, ''].filter((part, index, all) => part || index === all.length - 1).join('/');
}

async function listVersions(
  client: S3Sender,
  config: BackupUploadConfig,
  database: string,
): Promise<RemoteVersion[]> {
  const versions: RemoteVersion[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await client.send(new ListObjectVersionsCommand({
      Bucket: config.bucket,
      Prefix: objectPrefix(config, database),
      KeyMarker: keyMarker,
      VersionIdMarker: versionIdMarker,
    }));
    versions.push(...(page.Versions ?? []));
    if (!page.IsTruncated) break;
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
    if (!keyMarker) throw new Error('version listing was truncated without a continuation key');
  } while (true);
  return versions;
}

async function bodyBytes(body: any): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
  if (body && Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error('S3 response body cannot be read');
}

async function getVerifiedVersion(
  client: S3Sender,
  config: BackupUploadConfig,
  version: RemoteVersion,
): Promise<{ bytes: Buffer; sha256: string; metadata: any }> {
  if (!version.Key || !version.VersionId) throw new Error('remote object has no key/version id');
  const request = { Bucket: config.bucket, Key: version.Key, VersionId: version.VersionId };
  const [head, object] = await Promise.all([
    client.send(new HeadObjectCommand({ ...request, ChecksumMode: 'ENABLED' })),
    client.send(new GetObjectCommand(request)),
  ]);
  const bytes = await bodyBytes(object.Body);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (head.VersionId !== version.VersionId || object.VersionId !== version.VersionId) {
    throw new Error(`${version.Key}: response version does not match the selected version`);
  }
  if (Number(head.ContentLength) !== bytes.length || Number(version.Size) !== bytes.length) {
    throw new Error(`${version.Key}: downloaded size does not match remote metadata`);
  }
  if (head.Metadata?.sha256 !== sha256) {
    throw new Error(`${version.Key}: downloaded SHA-256 does not match remote metadata`);
  }
  if (head.ChecksumSHA256 !== Buffer.from(sha256, 'hex').toString('base64')) {
    throw new Error(`${version.Key}: downloaded SHA-256 does not match remote checksum`);
  }
  if (head.ServerSideEncryption !== 'aws:kms' || head.SSEKMSKeyId !== config.kmsKeyId) {
    throw new Error(`${version.Key}: remote KMS encryption/key does not match`);
  }
  if (!head.ObjectLockRetainUntilDate || head.ObjectLockRetainUntilDate <= new Date()) {
    throw new Error(`${version.Key}: remote retention is missing or expired`);
  }
  return { bytes, sha256, metadata: head };
}

function newest(versions: RemoteVersion[], suffix: string): RemoteVersion | undefined {
  return versions
    .filter((version) => version.Key?.endsWith(suffix) && version.VersionId)
    .sort((a, b) => Number(b.LastModified ?? 0) - Number(a.LastModified ?? 0))[0];
}

export async function downloadNewestBackupPair(options: {
  client: S3Sender;
  config: BackupUploadConfig;
  database: string;
  outDir: string;
}): Promise<DownloadedBackup> {
  const versions = await listVersions(
    options.client,
    options.config,
    options.database,
  );
  const manifestVersion = newest(versions, '.manifest.json');
  if (!manifestVersion) {
    throw new Error(`no off-host manifest found for '${options.database}'`);
  }
  const remoteManifest = await getVerifiedVersion(
    options.client,
    options.config,
    manifestVersion,
  );
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(remoteManifest.bytes.toString('utf8'));
  } catch {
    throw new Error(`${manifestVersion.Key}: manifest is not valid JSON`);
  }
  if (manifest.database !== options.database) {
    throw new Error(`manifest names '${manifest.database}', expected '${options.database}'`);
  }
  if (path.basename(manifest.dumpFile) !== manifest.dumpFile || !manifest.dumpFile.endsWith('.dump')) {
    throw new Error(`manifest has unsafe dump filename '${manifest.dumpFile}'`);
  }
  const expectedDumpKey = objectPrefix(options.config, options.database) + manifest.dumpFile;
  const dumpVersion = versions
    .filter((version) => version.Key === expectedDumpKey && version.VersionId)
    .sort((a, b) => Number(b.LastModified ?? 0) - Number(a.LastModified ?? 0))[0];
  if (!dumpVersion) throw new Error(`manifest references missing off-host dump '${expectedDumpKey}'`);
  const remoteDump = await getVerifiedVersion(
    options.client,
    options.config,
    dumpVersion,
  );
  if (remoteDump.bytes.length !== manifest.dumpBytes || remoteDump.sha256 !== manifest.dumpSha256) {
    throw new Error('downloaded dump does not match its snapshot manifest');
  }

  fs.mkdirSync(options.outDir, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(options.outDir, path.basename(manifestVersion.Key!));
  const dumpPath = path.join(options.outDir, manifest.dumpFile);
  fs.writeFileSync(dumpPath, remoteDump.bytes, { mode: 0o600 });
  fs.writeFileSync(manifestPath, remoteManifest.bytes, { mode: 0o600 });
  const receiptPath = remoteReceiptPath(manifestPath);
  fs.writeFileSync(receiptPath, JSON.stringify({
    schemaVersion: 1,
    database: options.database,
    verifiedRemote: true,
    verifiedAt: new Date().toISOString(),
    bucket: options.config.bucket,
    prefix: options.config.prefix,
    kmsKeyId: options.config.kmsKeyId,
    manifestSha256: remoteManifest.sha256,
    objects: [
      {
        key: dumpVersion.Key,
        versionId: dumpVersion.VersionId,
        sha256: remoteDump.sha256,
        bytes: remoteDump.bytes.length,
      },
      {
        key: manifestVersion.Key,
        versionId: manifestVersion.VersionId,
        sha256: remoteManifest.sha256,
        bytes: remoteManifest.bytes.length,
      },
    ],
  }, null, 2) + '\n', { mode: 0o600 });
  return { dumpPath, manifestPath, receiptPath };
}

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && fallback === undefined) throw new Error(`--${name} is required`);
  return value ?? fallback!;
}

async function main(): Promise<void> {
  const config = parseBackupUploadConfig();
  const downloaded = await downloadNewestBackupPair({
    client: createBackupS3Client(config),
    config,
    database: arg('database'),
    outDir: path.resolve(process.cwd(), arg('out-dir', 'backups')),
  });
  console.log(`OFF-HOST BACKUP DOWNLOADED AND VERIFIED`);
  console.log(`  dump     ${downloaded.dumpPath}`);
  console.log(`  manifest ${downloaded.manifestPath}`);
  console.log(`  receipt  ${downloaded.receiptPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
