/** Create one snapshot-bound backup, upload it, verify it, and write a receipt. */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  backupConnectionForDatabase,
  createBackup,
} from './create-backup-manifest';
import {
  createBackupS3Client,
  parseBackupUploadConfig,
  uploadBackupPair,
} from './upload-backup';

dotenv.config();

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && fallback === undefined) throw new Error(`--${name} is required`);
  return value ?? fallback!;
}

export function remoteReceiptPath(manifestPath: string): string {
  if (!manifestPath.endsWith('.manifest.json')) {
    throw new Error(`unexpected manifest filename '${path.basename(manifestPath)}'`);
  }
  return manifestPath.replace(/\.manifest\.json$/, '.remote.json');
}

async function main(): Promise<void> {
  const database = arg('database');
  const outDir = path.resolve(process.cwd(), arg('out-dir', 'backups'));
  const connection = backupConnectionForDatabase(database);
  const migrationsTable =
    database === (process.env.DSD_DB_DATABASE || 'dsd_corpus_db')
      ? 'dsd_migrations'
      : 'app_migrations';

  const backup = await createBackup({
    database,
    outDir,
    ...connection,
    migrationsTable,
    container: process.env.DSD_PG_CONTAINER || undefined,
  });
  const config = parseBackupUploadConfig();
  const objects = await uploadBackupPair({
    client: createBackupS3Client(config),
    config,
    dumpPath: backup.dumpPath,
    manifestPath: backup.manifestPath,
  });

  const receipt = {
    schemaVersion: 1,
    database,
    verifiedRemote: true,
    verifiedAt: new Date().toISOString(),
    bucket: config.bucket,
    prefix: config.prefix,
    kmsKeyId: config.kmsKeyId,
    manifestSha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(backup.manifestPath))
      .digest('hex'),
    objects,
  };
  const receiptPath = remoteReceiptPath(backup.manifestPath);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`OFF-HOST BACKUP VERIFIED for ${database}`);
  console.log(`  manifest ${backup.manifestPath}`);
  console.log(`  receipt  ${receiptPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
