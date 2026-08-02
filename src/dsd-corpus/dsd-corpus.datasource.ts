import { DataSource, DataSourceOptions } from 'typeorm';
import {
  DSD_MIGRATIONS_TABLE,
  DsdCorpusConfig,
  DsdRole,
  buildDsdCorpusConfig,
  requireDsdConnection,
} from './dsd-corpus.config';
import { DSD_MIGRATIONS } from './migrations';

/**
 * TypeORM data sources for the DSD corpus.
 *
 * Deliberately separate from the legacy connector in every respect: its own
 * database, its own roles, its own `dsd_migrations` table, and its own entity
 * list. No DSD entity is ever registered on the legacy data source, and no
 * legacy entity is registered here — invariants 1 and 2.
 */

/** Entities are added by Task 3. Kept explicit so the list cannot drift. */
export const DSD_ENTITIES: DataSourceOptions['entities'] = [];

export function dsdDataSourceOptions(
  role: DsdRole,
  config: DsdCorpusConfig = buildDsdCorpusConfig(),
): DataSourceOptions {
  const connection = requireDsdConnection(config, role);

  return {
    type: 'postgres',
    host: connection.host,
    port: connection.port,
    username: connection.username,
    // The password stays in the URL rather than being copied into config
    // objects that get logged.
    url: connection.url,
    database: connection.database,
    entities: DSD_ENTITIES,
    migrations: DSD_MIGRATIONS,
    migrationsTableName: DSD_MIGRATIONS_TABLE,
    migrationsTransactionMode: 'each',
    synchronize: false,
    logging: ['error', 'schema'],
  };
}

export function createDsdDataSource(
  role: DsdRole,
  config: DsdCorpusConfig = buildDsdCorpusConfig(),
): DataSource {
  return new DataSource(dsdDataSourceOptions(role, config));
}
