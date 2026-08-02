/**
 * DSD migration CLI for local and rehearsal use.
 *
 *   npm run dsd:migration:show
 *   npm run dsd:migration:run
 *   npm run dsd:migration:revert     # local/rehearsal only
 *
 * `revert` exists here and deliberately not in the production runner. Recovery
 * from a partially completed cross-database sequence is a reviewed forward
 * migration or the Task 2A restore runbook — never an automatic rollback.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';

dotenv.config();

const PRODUCTION_BLOCKED = new Set(['revert']);

async function main(): Promise<void> {
  const command = process.argv[2] || 'show';
  if (!['show', 'run', 'revert'].includes(command)) {
    throw new Error('Usage: ts-node scripts/dsd/migrations.ts <show|run|revert>');
  }

  if (PRODUCTION_BLOCKED.has(command) && process.env.NODE_ENV === 'production') {
    throw new Error(
      `'${command}' is a local and rehearsal command only. In production, recover with a ` +
        'reviewed forward migration or the Task 2A restore runbook.',
    );
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error(
      'DSD corpus configuration is invalid:\n  - ' + config.errors.join('\n  - '),
    );
  }

  const dataSource = createDsdDataSource('migrator', config);
  await dataSource.initialize();
  try {
    if (command === 'show') {
      const pending = await dataSource.showMigrations();
      console.log(pending ? 'Pending DSD migrations exist.' : 'DSD migrations are current.');
    } else if (command === 'run') {
      const applied = await dataSource.runMigrations({ transaction: 'each' });
      console.log(
        applied.length === 0
          ? 'No DSD migrations to apply.'
          : `Applied ${applied.length}: ${applied.map((m) => m.name).join(', ')}`,
      );
    } else {
      await dataSource.undoLastMigration({ transaction: 'each' });
      console.log('Reverted the latest DSD migration.');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
