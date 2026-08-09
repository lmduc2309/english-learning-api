/**
 * Snapshot-bound backup for a DSD or legacy database.
 *
 * The point of this script is a guarantee that is easy to state and easy to
 * get wrong: **the dump and the manifest describe the same database state.**
 *
 * The naive approach — run pg_dump, then query row counts — produces a
 * manifest describing a database that has already moved on, so a later restore
 * check compares a dump against numbers that were never true of it. Instead:
 *
 *   1. Open a REPEATABLE READ transaction and `pg_export_snapshot()`.
 *   2. Hold it open while `pg_dump --snapshot=<id>` runs.
 *   3. Compute counts and digests inside a second transaction that adopts the
 *      same snapshot with `SET TRANSACTION SNAPSHOT`.
 *
 * All three see one frozen instant.
 *
 * USAGE:
 *   npm run dsd:backup -- --database dsd_corpus_db --out-dir ./backups
 *   npm run dsd:backup -- --database english_learning_db --out-dir ./backups
 */
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

export const MANIFEST_SCHEMA_VERSION = 1;
export const SCRATCH_PREFIX = 'dsd_restore_check_';

export interface TableFingerprint {
  name: string;
  rowCount: number;
  contentDigest: string;
}

export interface BackupManifest {
  manifestSchemaVersion: number;
  database: string;
  createdAt: string;
  snapshotId: string;
  postgresVersion: string;
  pgDumpVersion: string;
  dumpFile: string;
  dumpSha256: string;
  dumpBytes: number;
  migrations: { table: string; applied: string[] };
  tables: TableFingerprint[];
}

export interface BackupConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Select the one least-privilege credential for the requested database. */
export function backupConnectionForDatabase(
  database: string,
  env: NodeJS.ProcessEnv = process.env,
): BackupConnection {
  const dsdDatabase = env.DSD_DB_DATABASE || 'dsd_corpus_db';
  const legacyDatabase = env.DB_DATABASE || 'english_learning_db';
  let variable: 'DSD_BACKUP_DATABASE_URL' | 'LEGACY_BACKUP_DATABASE_URL';
  let expectedUser: 'dsd_backup' | 'legacy_backup';
  if (database === dsdDatabase) {
    variable = 'DSD_BACKUP_DATABASE_URL';
    expectedUser = 'dsd_backup';
  } else if (database === legacyDatabase) {
    variable = 'LEGACY_BACKUP_DATABASE_URL';
    expectedUser = 'legacy_backup';
  } else {
    throw new Error(
      `database '${database}' is neither the configured DSD nor legacy database`,
    );
  }
  const raw = env[variable];
  if (!raw) throw new Error(`${variable} is required; backup credentials never fall back`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${variable} is not a valid PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${variable} must use postgres:// or postgresql://`);
  }
  const targetDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(parsed.username);
  if (targetDatabase !== database) {
    throw new Error(`${variable} targets '${targetDatabase}', expected '${database}'`);
  }
  if (user !== expectedUser) {
    throw new Error(`${variable} uses '${user}', expected '${expectedUser}'`);
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user,
    password: decodeURIComponent(parsed.password),
  };
}

/**
 * Fields that legitimately differ between a dump and a restore of it. A
 * restored copy has another name, another creation time, and no dump of its
 * own — none of which means the content differs.
 */
const VOLATILE_FIELDS: ReadonlyArray<keyof BackupManifest> = [
  'database',
  'createdAt',
  'snapshotId',
  'dumpFile',
  'dumpSha256',
  'dumpBytes',
  'postgresVersion',
  'pgDumpVersion',
];

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortObject(v)]),
    );
  }
  return value;
}

/** Deterministic serialization: sorted keys, tables sorted by name. */
export function canonicalManifest(manifest: BackupManifest): string {
  const normalized = {
    ...manifest,
    tables: [...manifest.tables].sort((a, b) => a.name.localeCompare(b.name)),
    migrations: {
      ...manifest.migrations,
      applied: [...manifest.migrations.applied].sort(),
    },
  };
  return JSON.stringify(sortObject(normalized), null, 2) + '\n';
}

/** Digest of the content-bearing fields only. Comparable across a restore. */
export function manifestDigest(manifest: BackupManifest): string {
  const stable: Record<string, unknown> = { ...manifest };
  for (const field of VOLATILE_FIELDS) delete stable[field];
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sortObject(stable)))
    .digest('hex');
}

export function compareManifests(
  expected: BackupManifest,
  actual: BackupManifest,
): string[] {
  const differences: string[] = [];

  if (expected.manifestSchemaVersion !== actual.manifestSchemaVersion) {
    // Comparing across schema versions would produce meaningless diffs.
    return [
      `manifest schema version differs (${expected.manifestSchemaVersion} vs ${actual.manifestSchemaVersion}); regenerate before comparing`,
    ];
  }

  const expectedMigrations = [...expected.migrations.applied].sort().join(',');
  const actualMigrations = [...actual.migrations.applied].sort().join(',');
  if (expectedMigrations !== actualMigrations) {
    differences.push(
      `migration state differs: expected [${expectedMigrations}] but found [${actualMigrations}]`,
    );
  }

  const expectedTables = new Map(expected.tables.map((t) => [t.name, t]));
  const actualTables = new Map(actual.tables.map((t) => [t.name, t]));

  for (const [name, want] of expectedTables) {
    const got = actualTables.get(name);
    if (!got) {
      differences.push(`table '${name}' is missing from the restore`);
      continue;
    }
    if (want.rowCount !== got.rowCount) {
      differences.push(
        `table '${name}' row count differs: expected ${want.rowCount} but found ${got.rowCount}`,
      );
    }
    if (want.contentDigest !== got.contentDigest) {
      // Row counts cannot see this: same number of rows, different content.
      differences.push(`table '${name}' content digest differs`);
    }
  }

  for (const name of actualTables.keys()) {
    if (!expectedTables.has(name)) {
      differences.push(`table '${name}' is unexpected in the restore`);
    }
  }

  return differences;
}

/**
 * Guard a scratch database name before any DROP or CREATE touches it.
 *
 * Three independent checks, because this name is interpolated into DDL and a
 * mistake here destroys a production database.
 */
export function assertScratchNameSafe(name: string, protectedNames: string[]): void {
  const normalized = name.trim().toLowerCase();

  for (const protectedName of protectedNames) {
    if (normalized === protectedName.trim().toLowerCase()) {
      throw new Error(
        `refusing to use '${name}': it is a production database and must never be a restore target`,
      );
    }
  }

  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(`refusing '${name}': not a plain lowercase identifier`);
  }

  if (!normalized.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `refusing '${name}': scratch databases must start with the '${SCRATCH_PREFIX}' prefix`,
    );
  }
}

/**
 * Row count plus a content digest for one table.
 *
 * Ordered by primary key so the digest is reproducible; md5 of the whole row
 * so a change in any column is visible, which a row count is not.
 */
export function rowCountAndDigestSql(table: string): string {
  return `
    SELECT count(*)::bigint AS row_count,
           coalesce(md5(string_agg(row_digest, '|' ORDER BY row_digest)), '') AS content_digest
      FROM (SELECT md5(t::text) AS row_digest FROM "${table}" t) s`;
}

// ─── I/O below this line ────────────────────────────────────────────────────

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && fallback === undefined) {
    throw new Error(`missing required --${name}`);
  }
  return value ?? fallback!;
}

async function listTables(client: Client): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function readMigrations(
  client: Client,
  table: string,
): Promise<string[]> {
  const exists = await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
    `public.${table}`,
  ]);
  if (!exists.rows[0].present) return [];
  const { rows } = await client.query(`SELECT name FROM "${table}" ORDER BY name`);
  return rows.map((r) => r.name);
}

/**
 * Run pg_dump and write custom-format output to `dumpPath`.
 *
 * pg_dump is frequently absent from the host — the deploy runs it inside the
 * Postgres container, and this machine has no client install. When
 * DSD_PG_CONTAINER is set the dump is taken through `docker exec` and streamed
 * to a host file. The exported snapshot is valid either way: snapshots belong
 * to the PostgreSQL instance, not to the connecting client.
 */
function pgDumpToFile(
  args: string[],
  dumpPath: string,
  password: string,
  container: string | undefined,
): Promise<void> {
  const [command, argv] = container
    // Pass only the environment-variable name on argv. The secret remains in
    // the child environment rather than being exposed in the process list.
    ? ['docker', ['exec', '-e', 'PGPASSWORD', '-i', container, 'pg_dump', ...args]]
    : ['pg_dump', args];

  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dumpPath, { mode: 0o600 });
    let processComplete = false;
    let streamComplete = false;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const finish = () => {
      if (!settled && processComplete && streamComplete) {
        settled = true;
        resolve();
      }
    };
    const child = spawn(command, argv as string[], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.pipe(out);
    out.on('error', fail);
    out.on('finish', () => {
      streamComplete = true;
      finish();
    });
    child.on('error', (error) =>
      fail(
        new Error(
          `${command} could not be started (${error.message}). ` +
            'Install the PostgreSQL client tools or set DSD_PG_CONTAINER.',
        ),
      ),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`pg_dump exited with ${code}`));
        return;
      }
      processComplete = true;
      finish();
    });
  });
}

export async function createBackup(options: {
  database: string;
  outDir: string;
  host: string;
  port: number;
  user: string;
  password: string;
  migrationsTable: string;
  /** When set, pg_dump runs inside this Docker container instead of on the host. */
  container?: string;
}): Promise<{ manifestPath: string; dumpPath: string; manifest: BackupManifest }> {
  fs.mkdirSync(options.outDir, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpName = `${options.database}-${stamp}.dump`;
  const dumpPath = path.join(options.outDir, dumpName);
  const manifestPath = path.join(options.outDir, `${options.database}-${stamp}.manifest.json`);

  const base = {
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
  };

  // 1. Freeze an instant and publish it.
  const holder = new Client(base);
  await holder.connect();
  await holder.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const { rows } = await holder.query('SELECT pg_export_snapshot() AS id');
  const snapshotId: string = rows[0].id;

  try {
    // 2. Dump that exact instant.
    await pgDumpToFile(
      [
        '--format=custom',
        `--snapshot=${snapshotId}`,
        '--host', options.container ? 'localhost' : options.host,
        '--port', String(options.container ? 5432 : options.port),
        '--username', options.user,
        '--no-password',
        options.database,
      ],
      dumpPath,
      options.password,
      options.container,
    );

    // 3. Fingerprint that same instant from a second session.
    const reader = new Client(base);
    await reader.connect();
    try {
      await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await reader.query(`SET TRANSACTION SNAPSHOT '${snapshotId}'`);
      // A 64 MB /dev/shm cannot back parallel workers over a million rows.
      await reader.query('SET max_parallel_workers_per_gather = 0');

      const tables: TableFingerprint[] = [];
      for (const table of await listTables(reader)) {
        const result = await reader.query(rowCountAndDigestSql(table));
        tables.push({
          name: table,
          rowCount: Number(result.rows[0].row_count),
          contentDigest: result.rows[0].content_digest,
        });
      }

      const applied = await readMigrations(reader, options.migrationsTable);
      const version = await reader.query('SELECT version() AS v');
      await reader.query('COMMIT');

      const dumpBytes = fs.statSync(dumpPath).size;
      const dumpSha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(dumpPath))
        .digest('hex');

      const manifest: BackupManifest = {
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        database: options.database,
        createdAt: new Date().toISOString(),
        snapshotId,
        postgresVersion: String(version.rows[0].v).split(' on ')[0],
        pgDumpVersion: 'custom-format',
        dumpFile: dumpName,
        dumpSha256,
        dumpBytes,
        migrations: { table: options.migrationsTable, applied },
        tables,
      };

      fs.writeFileSync(manifestPath, canonicalManifest(manifest), { mode: 0o600 });
      fs.chmodSync(dumpPath, 0o600);
      return { manifestPath, dumpPath, manifest };
    } finally {
      await reader.end();
    }
  } finally {
    await holder.query('COMMIT').catch(() => undefined);
    await holder.end();
  }
}

async function main(): Promise<void> {
  const database = arg('database');
  const outDir = path.resolve(process.cwd(), arg('out-dir', 'backups'));
  const migrationsTable = arg(
    'migrations-table',
    database === (process.env.DB_DATABASE || 'english_learning_db')
      ? 'app_migrations'
      : 'dsd_migrations',
  );

  const connection = backupConnectionForDatabase(database);
  const result = await createBackup({
    database,
    outDir,
    ...connection,
    migrationsTable,
    container: process.env.DSD_PG_CONTAINER,
  });

  console.log(`dump     ${result.dumpPath} (${result.manifest.dumpBytes} bytes)`);
  console.log(`manifest ${result.manifestPath}`);
  console.log(`snapshot ${result.manifest.snapshotId}`);
  console.log(`tables   ${result.manifest.tables.length}`);
  console.log(`digest   ${manifestDigest(result.manifest)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
