import { config, validateConfig } from './config';
import { OpenRouterClient } from './openrouter-client';
import { ProgressTracker } from './progress-tracker';
import { DbConnector } from './db-connector';
import { BatchProcessor } from './batch-processor';
import type { CLIOptions, TranslationType } from './types';

/**
 * AI Vietnamese Translation Script
 *
 * Uses OpenRouter (Qwen3.6 Plus) to translate English definitions
 * and examples to Vietnamese in batch.
 *
 * Usage:
 *   ts-node scripts/ai-translate/index.ts                       # Translate all definitions
 *   ts-node scripts/ai-translate/index.ts --type examples        # Translate examples
 *   ts-node scripts/ai-translate/index.ts --limit 100            # Limit to 100 items
 *   ts-node scripts/ai-translate/index.ts --batch-size 20        # Custom batch size
 *   ts-node scripts/ai-translate/index.ts --dry-run              # Preview only
 *   ts-node scripts/ai-translate/index.ts --word love            # Specific word
 *   ts-node scripts/ai-translate/index.ts --stats                # Show progress stats
 *   ts-node scripts/ai-translate/index.ts --reset                # Reset failed items
 */

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);

  const getArg = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  return {
    type: (getArg('--type') as TranslationType) || 'definitions',
    limit: parseInt(getArg('--limit') || '0', 10),
    batchSize: parseInt(getArg('--batch-size') || String(config.batch.size), 10),
    dryRun: args.includes('--dry-run'),
    word: getArg('--word'),
    showStats: args.includes('--stats'),
    reset: args.includes('--reset'),
  };
}

async function showStats(tracker: ProgressTracker, db: DbConnector): Promise<void> {
  await db.connect();
  const counts = await db.getCounts();
  const defStats = tracker.getStats('definitions');
  const exStats = tracker.getStats('examples');

  console.log('\n📊 Translation Progress');
  console.log('═══════════════════════════════════════════');

  console.log('\n📖 Definitions:');
  console.log(`   Total in DB:       ${counts.totalDefs.toLocaleString()}`);
  console.log(`   With Vietnamese:   ${counts.defsWithVi.toLocaleString()} (${((counts.defsWithVi / counts.totalDefs) * 100).toFixed(1)}%)`);
  console.log(`   AI Translated:     ${defStats.done.toLocaleString()}`);
  console.log(`   AI Failed:         ${defStats.failed.toLocaleString()}`);

  console.log('\n📝 Examples:');
  console.log(`   Total in DB:       ${counts.totalExamples.toLocaleString()}`);
  console.log(`   With Vietnamese:   ${counts.examplesWithVi.toLocaleString()} (${((counts.examplesWithVi / counts.totalExamples) * 100).toFixed(1)}%)`);
  console.log(`   AI Translated:     ${exStats.done.toLocaleString()}`);
  console.log(`   AI Failed:         ${exStats.failed.toLocaleString()}`);

  console.log('\n═══════════════════════════════════════════\n');
  await db.disconnect();
}

async function resetFailed(tracker: ProgressTracker, type: TranslationType): Promise<void> {
  const count = tracker.resetFailed(type);
  console.log(`\n🔄 Reset ${count} failed ${type} — they will be retried.\n`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('');
  console.log('🇻🇳 AI Vietnamese Translation');
  console.log(`   Model:      ${config.openRouter.model}`);
  console.log(`   Type:       ${options.type}`);
  console.log(`   Batch size: ${options.batchSize}`);
  if (options.limit) console.log(`   Limit:      ${options.limit}`);
  if (options.word) console.log(`   Word:       ${options.word}`);
  if (options.dryRun) console.log('   Mode:       DRY RUN');
  console.log('');

  const tracker = new ProgressTracker();
  const db = new DbConnector();

  try {
    // Handle --stats
    if (options.showStats) {
      await showStats(tracker, db);
      return;
    }

    // Handle --reset
    if (options.reset) {
      await resetFailed(tracker, options.type);
      return;
    }

    // Validate API key for actual translation
    validateConfig();

    await db.connect();
    console.log('   ✅ Connected to PostgreSQL');

    const client = new OpenRouterClient();
    const processor = new BatchProcessor(client, tracker, db);
    processor.setupGracefulShutdown();

    let stats;
    if (options.type === 'definitions') {
      stats = await processor.translateDefinitions(options);
    } else {
      stats = await processor.translateExamples(options);
    }

    // Summary
    const elapsed = ((Date.now() - stats.startedAt.getTime()) / 1000).toFixed(0);
    console.log('\n═══════════════════════════════════════════');
    console.log('📋 Summary:');
    console.log(`   Total processed:   ${(stats.translated + stats.failed).toLocaleString()}`);
    console.log(`   Translated:        ${stats.translated.toLocaleString()} ✅`);
    console.log(`   Failed:            ${stats.failed.toLocaleString()} ❌`);
    console.log(`   Previously done:   ${stats.alreadyDone.toLocaleString()} ⏭️`);
    console.log(`   API requests:      ${stats.requestsMade}`);
    console.log(`   Time elapsed:      ${elapsed}s`);
    if (options.dryRun) {
      console.log('\n   (DRY RUN — no changes were saved)');
    }
    console.log('═══════════════════════════════════════════\n');
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  } finally {
    tracker.close();
    await db.disconnect();
  }
}

main();
