/**
 * Restore rehearsal: prove a backup is actually recoverable.
 *
 * A dump that has never been restored is not a backup, it is a file. This
 * restores the newest dump into a uniquely named scratch database, recomputes
 * the canonical manifest from the restored copy, and compares it against the
 * manifest captured from the original snapshot.
 *
 * Because the stored manifest was captured from the same exported snapshot as
 * the dump, a match proves the dump is complete and faithful. Comparing a dump
 * against a live database would prove nothing — the live database has moved on.
 *
 * The scratch name passes three independent guards before any DDL runs, since
 * a mistake here would destroy a production database.
 *
 * USAGE:
 *   npm run dsd:verify-restore -- --database dsd_corpus_db --dir ./backups
 */
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import {
  BackupManifest,
  MANIFEST_SCHEMA_VERSION,
  SCRATCH_PREFIX,
  assertScratchNameSafe,
  compareManifests,
  rowCountAndDigestSql,
} from './create-backup-manifest';

dotenv.config();

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && fallback === undefined) throw new Error(`missing required --${name}`);
  return value ?? fallback!;
}

export function newestBackup(
  dir: string,
  database: string,
): { dumpPath: string; manifestPath: string } {
  const manifests = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${database}-`) && f.endsWith('.manifest.json'))
    .sort()
    .reverse();

  if (manifests.length === 0) {
    throw new Error(`no manifest for '${database}' in ${dir}`);
  }

  const manifestPath = path.join(dir, manifests[0]);
  const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.database !== database) {
    throw new Error(`manifest names '${manifest.database}', expected '${database}'`);
  }
  if (
    path.basename(manifest.dumpFile) !== manifest.dumpFile
    || !manifest.dumpFile.endsWith('.dump')
  ) {
    throw new Error(`manifest has unsafe dump filename '${manifest.dumpFile}'`);
  }
  const dumpPath = path.join(dir, manifest.dumpFile);
  if (!fs.existsSync(dumpPath)) {
    throw new Error(`manifest references a missing dump: ${manifest.dumpFile}`);
  }
  return { dumpPath, manifestPath };
}

/** Refuse altered bytes before pg_restore has a chance to execute them. */
export function assertDumpMatchesManifest(
  dumpPath: string,
  manifest: BackupManifest,
): void {
  const bytes = fs.readFileSync(dumpPath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== manifest.dumpBytes || digest !== manifest.dumpSha256) {
    throw new Error('backup dump does not match its snapshot manifest');
  }
}

export function restoreReceiptPath(manifestPath: string): string {
  if (!manifestPath.endsWith('.manifest.json')) {
    throw new Error(`unexpected manifest filename '${path.basename(manifestPath)}'`);
  }
  return manifestPath.replace(/\.manifest\.json$/, '.restore.json');
}

function writeRestoreReceipt(
  database: string,
  manifestPath: string,
  dumpPath: string,
): string {
  const manifestBytes = fs.readFileSync(manifestPath);
  const dumpBytes = fs.readFileSync(dumpPath);
  const receiptPath = restoreReceiptPath(manifestPath);
  fs.writeFileSync(receiptPath, JSON.stringify({
    schemaVersion: 1,
    database,
    verifiedAt: new Date().toISOString(),
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    dumpSha256: crypto.createHash('sha256').update(dumpBytes).digest('hex'),
  }, null, 2) + '\n', { mode: 0o600 });
  return receiptPath;
}

function run(command: string, args: string[], input?: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env },
      stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

export interface RestoreConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Restore rehearsal never borrows the application, backup, or owner credential. */
export function restoreConnection(
  env: NodeJS.ProcessEnv = process.env,
): RestoreConnection {
  const raw = env.DSD_RESTORE_DATABASE_URL;
  if (!raw) {
    throw new Error('DSD_RESTORE_DATABASE_URL is required; restore credentials never fall back');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DSD_RESTORE_DATABASE_URL is not a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DSD_RESTORE_DATABASE_URL must use postgres:// or postgresql://');
  }
  const user = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (user !== 'dsd_restore_operator') {
    throw new Error(
      `DSD_RESTORE_DATABASE_URL uses '${user}', expected 'dsd_restore_operator'`,
    );
  }
  if (database !== 'postgres') {
    throw new Error(
      `DSD_RESTORE_DATABASE_URL targets '${database}', expected maintenance database 'postgres'`,
    );
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user,
    password: decodeURIComponent(parsed.password),
  };
}

async function manifestOf(
  client: Client,
  database: string,
  migrationsTable: string,
  stored: BackupManifest,
): Promise<BackupManifest> {
  await client.query('SET max_parallel_workers_per_gather = 0');
  const { rows: tableRows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );

  const tables = [];
  for (const { tablename } of tableRows) {
    const result = await client.query(rowCountAndDigestSql(tablename));
    tables.push({
      name: tablename,
      rowCount: Number(result.rows[0].row_count),
      contentDigest: result.rows[0].content_digest,
    });
  }

  const present = await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
    `public.${migrationsTable}`,
  ]);
  const applied = present.rows[0].present
    ? (await client.query(`SELECT name FROM "${migrationsTable}" ORDER BY name`)).rows.map(
        (r) => r.name,
      )
    : [];

  return {
    ...stored,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    database,
    createdAt: new Date().toISOString(),
    migrations: { table: migrationsTable, applied },
    tables,
  };
}

async function main(): Promise<void> {
  const database = arg('database');
  const dir = path.resolve(process.cwd(), arg('dir', 'backups'));
  const container = process.env.DSD_PG_CONTAINER;

  const { host, port, user, password } = restoreConnection();

  const protectedNames = [
    process.env.DSD_DB_DATABASE || 'dsd_corpus_db',
    process.env.DB_DATABASE || 'english_learning_db',
    database,
  ];

  const started = Date.now();
  const { dumpPath, manifestPath } = newestBackup(dir, database);
  const stored: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertDumpMatchesManifest(dumpPath, stored);

  const scratch = `${SCRATCH_PREFIX}${Date.now()}`;
  assertScratchNameSafe(scratch, protectedNames);

  console.log(`restoring ${path.basename(dumpPath)} -> ${scratch}`);

  const admin = new Client({ host, port, user, password, database: 'postgres' });
  await admin.connect();
  let restored = false;
  try {
    await admin.query(`CREATE DATABASE ${scratch}`);
    restored = true;

    const dump = fs.readFileSync(dumpPath);
    const restoreArgs = [
      '--no-owner',
      '--no-privileges',
      '--dbname', scratch,
      '--host', container ? 'localhost' : host,
      '--port', String(container ? 5432 : port),
      '--username', user,
      '--no-password',
    ];
    if (container) {
      await run(
        'docker',
        ['exec', '-e', 'PGPASSWORD', '-i', container, 'pg_restore', ...restoreArgs],
        dump,
      );
    } else {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pg_restore', restoreArgs, {
          env: { ...process.env, PGPASSWORD: password },
          stdio: ['pipe', 'inherit', 'inherit'],
        });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`pg_restore exited with ${code}`)),
        );
        child.stdin.write(dump);
        child.stdin.end();
      });
    }

    const check = new Client({ host, port, user, password, database: scratch });
    await check.connect();
    let differences: string[];
    try {
      const actual = await manifestOf(check, scratch, stored.migrations.table, stored);
      differences = compareManifests(stored, actual);
    } finally {
      await check.end();
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (differences.length > 0) {
      console.error(`RESTORE VERIFICATION FAILED for ${database} after ${seconds}s:`);
      for (const difference of differences) console.error(`  - ${difference}`);
      // Keep the scratch database: it is the evidence for diagnosis.
      console.error(`  scratch database '${scratch}' retained for inspection`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `RESTORE VERIFIED for ${database} in ${seconds}s ` +
        `(${stored.tables.length} tables, ${stored.tables.reduce((n, t) => n + t.rowCount, 0)} rows)`,
    );

    // Drop only after the guard succeeds.
    await admin.query(`DROP DATABASE ${scratch}`);
    restored = false;
    const receiptPath = writeRestoreReceipt(database, manifestPath, dumpPath);
    console.log(`  restore receipt ${receiptPath}`);
  } finally {
    if (restored) {
      console.error(`note: scratch database '${scratch}' still exists`);
    }
    await admin.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
