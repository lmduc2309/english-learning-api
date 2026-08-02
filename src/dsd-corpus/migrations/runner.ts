import 'reflect-metadata';
import { createDsdDataSource } from '../dsd-corpus.datasource';
import { buildDsdCorpusConfig } from '../dsd-corpus.config';

/**
 * Production DSD migration runner, compiled to `dist/dsd-corpus/migrations/runner.js`.
 *
 * Supports `show` and `run` only. Reverting in production is deliberately not
 * available here: recovery from a partially completed cross-database sequence
 * is a reviewed forward migration or the Task 2A restore runbook, never an
 * automatic rollback that the deploy pipeline could trigger on its own.
 *
 * Always authenticates as `dsd_migrator`. It cannot borrow another role.
 */
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'show' && command !== 'run') {
    throw new Error('Usage: node dist/src/dsd-corpus/migrations/runner.js <show|run>');
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
      console.log(
        pending ? 'Pending DSD migrations exist.' : 'DSD migrations are current.',
      );
      return;
    }

    const applied = await dataSource.runMigrations({ transaction: 'each' });
    console.log(
      applied.length === 0
        ? 'No DSD migrations to apply.'
        : `Applied ${applied.length} DSD migration(s): ${applied.map((m) => m.name).join(', ')}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
