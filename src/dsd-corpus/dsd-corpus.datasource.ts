import { DataSource, DataSourceOptions } from 'typeorm';
import {
  DSD_MIGRATIONS_TABLE,
  DsdCorpusConfig,
  DsdRole,
  buildDsdCorpusConfig,
  requireDsdConnection,
} from './dsd-corpus.config';
import { DSD_MIGRATIONS } from './migrations';
import { DsdEntry } from './entities/dsd-entry.entity';
import { DsdSense } from './entities/dsd-sense.entity';
import { DsdTranslation } from './entities/dsd-translation.entity';
import { DsdExample } from './entities/dsd-example.entity';
import { DsdPronunciation } from './entities/dsd-pronunciation.entity';
import { DsdProvenanceEvent } from './entities/dsd-provenance-event.entity';
import { DsdSimilarityResult } from './entities/dsd-similarity-result.entity';
import { DsdAudioAsset } from './entities/dsd-audio-asset.entity';

/**
 * TypeORM data sources for the DSD corpus.
 *
 * Deliberately separate from the legacy connector in every respect: its own
 * database, its own roles, its own `dsd_migrations` table, and its own entity
 * list. No DSD entity is ever registered on the legacy data source, and no
 * legacy entity is registered here — invariants 1 and 2.
 */

/**
 * Registered explicitly so the list cannot drift, and so no legacy entity can
 * arrive here by a glob (invariants 1 and 2).
 */
export const DSD_ENTITIES: DataSourceOptions['entities'] = [
  DsdEntry,
  DsdSense,
  DsdTranslation,
  DsdExample,
  DsdPronunciation,
  DsdProvenanceEvent,
  DsdSimilarityResult,
  DsdAudioAsset,
];

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
