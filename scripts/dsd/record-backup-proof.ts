/** Build the release-gate proof after both off-host restores have passed. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BackupManifest } from './create-backup-manifest';
import { newestBackup, restoreReceiptPath } from './verify-restore';
import { remoteReceiptPath } from './backup-offhost';

interface RemoteReceipt {
  schemaVersion: number;
  database: string;
  verifiedRemote: boolean;
  verifiedAt: string;
  manifestSha256: string;
  objects: Array<{ key: string; versionId: string; sha256: string; bytes: number }>;
}

interface RestoreReceipt {
  schemaVersion: number;
  database: string;
  verifiedAt: string;
  manifestSha256: string;
  dumpSha256: string;
}

export interface BackupProof {
  schemaVersion: number;
  proofId: string;
  verifiedAt: string;
  offHostCopy: true;
  migrationVersion: string;
  databases: Array<{
    database: string;
    manifestSha256: string;
    dumpSha256: string;
    remoteVersionIds: string[];
  }>;
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function migrationVersion(manifest: BackupManifest): string {
  const versions = manifest.migrations.applied
    .map((name) => /([0-9]{13})$/.exec(name)?.[1] ?? '')
    .filter(Boolean)
    .sort();
  return versions.at(-1) ?? '';
}

export function buildBackupProof(options: {
  dir: string;
  dsdDatabase: string;
  legacyDatabase: string;
}): BackupProof {
  const databases = [options.dsdDatabase, options.legacyDatabase].map((database) => {
    const newest = newestBackup(options.dir, database);
    const manifestBytes = fs.readFileSync(newest.manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as BackupManifest;
    const dumpBytes = fs.readFileSync(newest.dumpPath);
    if (
      dumpBytes.length !== manifest.dumpBytes
      || sha256(dumpBytes) !== manifest.dumpSha256
    ) {
      throw new Error(`${database}: restored dump no longer matches its manifest`);
    }
    const receiptPath = remoteReceiptPath(newest.manifestPath);
    if (!fs.existsSync(receiptPath)) {
      throw new Error(`${database}: off-host verification receipt is missing`);
    }
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as RemoteReceipt;
    if (
      receipt.schemaVersion !== 1
      || receipt.database !== database
      || receipt.verifiedRemote !== true
      || !Number.isFinite(Date.parse(receipt.verifiedAt))
    ) {
      throw new Error(`${database}: off-host verification receipt is invalid`);
    }
    if (receipt.manifestSha256 !== sha256(manifestBytes)) {
      throw new Error(`${database}: receipt does not cover the restored manifest`);
    }
    const dumpObject = receipt.objects.find((object) => object.sha256 === manifest.dumpSha256);
    const manifestObject = receipt.objects.find(
      (object) => object.sha256 === receipt.manifestSha256,
    );
    if (
      !dumpObject
      || !manifestObject
      || !dumpObject.versionId
      || !manifestObject.versionId
      || dumpObject.bytes !== manifest.dumpBytes
      || manifestObject.bytes !== manifestBytes.length
    ) {
      throw new Error(`${database}: receipt does not identify both remote object versions`);
    }
    const restoredPath = restoreReceiptPath(newest.manifestPath);
    if (!fs.existsSync(restoredPath)) {
      throw new Error(`${database}: matching successful restore receipt is missing`);
    }
    const restored = JSON.parse(fs.readFileSync(restoredPath, 'utf8')) as RestoreReceipt;
    if (
      restored.schemaVersion !== 1
      || restored.database !== database
      || !Number.isFinite(Date.parse(restored.verifiedAt))
      || restored.manifestSha256 !== receipt.manifestSha256
      || restored.dumpSha256 !== manifest.dumpSha256
    ) {
      throw new Error(`${database}: successful restore receipt does not match the backup pair`);
    }
    return {
      database,
      manifestSha256: receipt.manifestSha256,
      dumpSha256: manifest.dumpSha256,
      remoteVersionIds: [dumpObject.versionId, manifestObject.versionId].sort(),
      manifest,
      restoreVerifiedAt: restored.verifiedAt,
    };
  });
  const verifiedAt = new Date(Math.min(
    ...databases.map((database) => Date.parse(database.restoreVerifiedAt)),
  )).toISOString();
  const dsd = databases.find((database) => database.database === options.dsdDatabase)!;
  const version = migrationVersion(dsd.manifest);
  if (!version) throw new Error('DSD backup manifest has no migration version');
  const publicDatabases = databases.map(({
    manifest: _manifest,
    restoreVerifiedAt: _restoreVerifiedAt,
    ...database
  }) => database);
  const proofDigest = sha256(JSON.stringify({ verifiedAt, databases: publicDatabases }));
  return {
    schemaVersion: 1,
    proofId: `BK-${verifiedAt.slice(0, 10).replace(/-/g, '')}-${proofDigest.slice(0, 12)}`,
    verifiedAt,
    offHostCopy: true,
    migrationVersion: version,
    databases: publicDatabases,
  };
}

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && fallback === undefined) throw new Error(`--${name} is required`);
  return value ?? fallback!;
}

function main(): void {
  const output = path.resolve(process.cwd(), arg('output'));
  const proof = buildBackupProof({
    dir: path.resolve(process.cwd(), arg('dir', 'backups')),
    dsdDatabase: process.env.DSD_DB_DATABASE || 'dsd_corpus_db',
    legacyDatabase: process.env.DB_DATABASE || 'english_learning_db',
  });
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  // Contains hashes and object-version identifiers, never credentials. Keep it
  // readable by the unprivileged API process through the shared evidence volume.
  fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { mode: 0o644 });
  console.log(`RESTORE PROOF RECORDED ${proof.proofId}`);
  console.log(`  ${output}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
