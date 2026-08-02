/**
 * DSD corpus connection configuration.
 *
 * The DSD corpus lives in its own database with its own roles. This module is
 * the single place that decides which credential a given caller gets, and it
 * is deliberately unforgiving:
 *
 *   - The DSD database name may never equal the legacy database name.
 *   - Every role URL must target the DSD database.
 *   - Every role URL must authenticate as that role, not a more privileged one.
 *   - A missing role throws. Nothing ever falls back to another role's URL.
 *
 * The last rule is the important one. A fallback would mean the serving path
 * quietly acquiring curator or migrator rights the first time an environment
 * variable was missing, which is exactly the failure the separate database was
 * built to prevent.
 */

export const DSD_ROLES = ['app', 'curator', 'audit', 'migrator', 'backup'] as const;
export type DsdRole = (typeof DSD_ROLES)[number];

/** Role names as provisioned in Task 2A. `audit` maps to `dsd_auditor`. */
export const DSD_EXPECTED_USERNAME: Record<DsdRole, string> = {
  app: 'dsd_app',
  curator: 'dsd_curator',
  audit: 'dsd_auditor',
  migrator: 'dsd_migrator',
  backup: 'dsd_backup',
};

const DSD_ENV_VAR: Record<DsdRole, string> = {
  app: 'DSD_APP_DATABASE_URL',
  curator: 'DSD_CURATOR_DATABASE_URL',
  audit: 'DSD_AUDIT_DATABASE_URL',
  migrator: 'DSD_MIGRATOR_DATABASE_URL',
  backup: 'DSD_BACKUP_DATABASE_URL',
};

export const DSD_RELEASE_CHANNELS = ['off', 'internal', 'public'] as const;
export type DsdReleaseChannel = (typeof DSD_RELEASE_CHANNELS)[number];

export const DSD_DEFAULT_DATABASE = 'dsd_corpus_db';
export const DSD_MIGRATIONS_TABLE = 'dsd_migrations';

export interface DsdConnection {
  role: DsdRole;
  url: string;
  host: string;
  port: number;
  database: string;
  username: string;
}

export interface DsdCorpusConfig {
  database: string;
  releaseChannel: DsdReleaseChannel;
  connections: Partial<Record<DsdRole, DsdConnection>>;
  errors: string[];
}

function normalizeName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function parseConnection(role: DsdRole, raw: string): DsdConnection | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: `DSD ${role} URL is not a valid connection URL` };
  }
  return {
    role,
    url: raw,
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    username: decodeURIComponent(parsed.username),
  };
}

export function buildDsdCorpusConfig(
  env: NodeJS.ProcessEnv = process.env,
): DsdCorpusConfig {
  const errors: string[] = [];

  const database = (env.DSD_DB_DATABASE ?? DSD_DEFAULT_DATABASE).trim();
  const legacyDatabase = env.DB_DATABASE ?? '';

  // Compare normalized: a name differing only by case or padding is the same
  // database as far as PostgreSQL and this guard are concerned.
  if (normalizeName(database) === normalizeName(legacyDatabase)) {
    errors.push(
      `DSD_DB_DATABASE '${database}' must not equal the legacy database '${legacyDatabase}'`,
    );
  }

  const rawChannel = (env.DSD_RELEASE_CHANNEL ?? 'off').trim();
  let releaseChannel: DsdReleaseChannel = 'off';
  if ((DSD_RELEASE_CHANNELS as readonly string[]).includes(rawChannel)) {
    releaseChannel = rawChannel as DsdReleaseChannel;
  } else {
    errors.push(
      `unknown release channel '${rawChannel}'; expected one of ${DSD_RELEASE_CHANNELS.join(', ')}`,
    );
  }

  const connections: Partial<Record<DsdRole, DsdConnection>> = {};

  for (const role of DSD_ROLES) {
    const raw = env[DSD_ENV_VAR[role]];
    if (!raw) continue;

    const parsed = parseConnection(role, raw);
    if ('error' in parsed) {
      errors.push(parsed.error);
      continue;
    }

    if (normalizeName(parsed.database) !== normalizeName(database)) {
      errors.push(
        `DSD ${role} URL targets database '${parsed.database}' but DSD_DB_DATABASE is '${database}'`,
      );
    }

    const expected = DSD_EXPECTED_USERNAME[role];
    if (parsed.username !== expected) {
      errors.push(
        `DSD ${role} URL uses role '${parsed.username}' but expected role '${expected}'`,
      );
    }

    connections[role] = parsed;
  }

  return { database, releaseChannel, connections, errors };
}

/**
 * Resolve one role's connection.
 *
 * Throws when the role is unconfigured or the configuration is invalid. It
 * never substitutes another role — a caller that cannot get its own credential
 * must fail, not proceed with a different one.
 */
export function requireDsdConnection(
  config: DsdCorpusConfig,
  role: DsdRole,
): DsdConnection {
  if (config.errors.length > 0) {
    throw new Error(
      `DSD corpus configuration is invalid; refusing to connect as '${role}':\n  - ` +
        config.errors.join('\n  - '),
    );
  }
  const connection = config.connections[role];
  if (!connection) {
    throw new Error(
      `DSD ${role} connection is not configured (${DSD_ENV_VAR[role]}). ` +
        'This role does not fall back to another credential.',
    );
  }
  return connection;
}

/**
 * Whether DSD must be reachable for the service to be considered healthy.
 *
 * On `internal` and `public` the DSD corpus is serving content, so an
 * unavailable connection is a startup/health failure. On `off` the dictionary
 * routes return 404 and user, auth and progress routes stay healthy — they
 * never fall back to legacy content.
 */
export function dsdMustBeAvailable(channel: DsdReleaseChannel): boolean {
  return channel === 'internal' || channel === 'public';
}
