import { OpenRouterClient } from './openrouter-client';
import { ProgressTracker } from './progress-tracker';
import { DbConnector } from './db-connector';
import { buildDefinitionPrompt, buildExamplePrompt } from './prompts';
import { config } from './config';
import { validateTranslation, type RejectionReason } from './validate-output';
import type {
  TranslationItem,
  TranslationResult,
  ExampleItem,
  TranslationType,
  RunStats,
} from './types';

export class BatchProcessor {
  private client: OpenRouterClient;
  private tracker: ProgressTracker;
  private db: DbConnector;
  private aborted = false;
  private stats: RunStats;

  constructor(client: OpenRouterClient, tracker: ProgressTracker, db: DbConnector) {
    this.client = client;
    this.tracker = tracker;
    this.db = db;
    this.stats = {
      totalToTranslate: 0,
      alreadyDone: 0,
      translated: 0,
      failed: 0,
      startedAt: new Date(),
      requestsMade: 0,
      rejectedByReason: {},
    };
  }

  setupGracefulShutdown(): void {
    const handler = () => {
      console.log('\n\n🛑 Graceful shutdown requested. Finishing current batch...');
      this.aborted = true;
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  async translateDefinitions(options: {
    limit: number;
    batchSize: number;
    dryRun: boolean;
    word: string | null;
  }): Promise<RunStats> {
    return this.runTranslation('definitions', options);
  }

  async translateExamples(options: {
    limit: number;
    batchSize: number;
    dryRun: boolean;
    word: string | null;
  }): Promise<RunStats> {
    return this.runTranslation('examples', options);
  }

  private async runTranslation(
    type: TranslationType,
    options: { limit: number; batchSize: number; dryRun: boolean; word: string | null },
  ): Promise<RunStats> {
    this.stats = {
      totalToTranslate: 0,
      alreadyDone: 0,
      translated: 0,
      failed: 0,
      startedAt: new Date(),
      requestsMade: 0,
      rejectedByReason: {},
    };

    const label = type === 'definitions' ? 'definitions' : 'examples';
    console.log(`\n📝 Translating ${label}...`);
    if (options.dryRun) console.log('   (DRY RUN — no changes will be saved)\n');

    // Get already-done IDs from progress tracker
    const doneIds = this.tracker.getDoneIds(type);
    this.stats.alreadyDone = doneIds.size;

    if (doneIds.size > 0) {
      console.log(`   ✅ ${doneIds.size} already translated (resuming)\n`);
    }

    // Fetch items from database
    const items =
      type === 'definitions'
        ? await this.db.fetchUntranslatedDefinitions(options.limit, doneIds, options.word)
        : await this.db.fetchUntranslatedExamples(options.limit, doneIds, options.word);

    this.stats.totalToTranslate = items.length;

    if (items.length === 0) {
      console.log(`   ✨ Nothing to translate — all ${label} already have Vietnamese!\n`);
      return this.stats;
    }

    console.log(`   📊 Found ${items.length} ${label} to translate\n`);

    // Start a run in progress tracker
    const runId = this.tracker.startRun(type, items.length);

    // Process in batches
    const batches = this.chunk(items, options.batchSize);

    for (let i = 0; i < batches.length; i++) {
      if (this.aborted) {
        console.log('\n   ⏹️  Stopped. Progress saved — resume anytime.\n');
        break;
      }

      const batch = batches[i];
      const batchNum = i + 1;
      const progress = this.stats.translated + this.stats.failed;
      const pct = ((progress / this.stats.totalToTranslate) * 100).toFixed(1);
      const eta = this.calculateETA();

      process.stdout.write(
        `   [${batchNum}/${batches.length}] ${progress}/${this.stats.totalToTranslate} (${pct}%) | ` +
          `${this.stats.translated} ✅ ${this.stats.failed} ❌ | ETA: ${eta} `,
      );

      try {
        const results = await this.translateBatch(batch, type);
        this.stats.requestsMade++;

        // Validate before persisting. The pipeline previously accepted any
        // non-empty string, which is how Chinese reached definition_vi.
        const rejections = new Map<number, RejectionReason>();
        const successful = results.filter((r) => {
          const source = batch.find((b) => b.id === r.id);
          const verdict = validateTranslation(source?.en ?? '', r.vi ?? '');
          if (!verdict.ok) {
            rejections.set(r.id, verdict.reason!);
            this.stats.rejectedByReason[verdict.reason!] =
              (this.stats.rejectedByReason[verdict.reason!] ?? 0) + 1;
            return false;
          }
          return true;
        });
        const failedCount = results.length - successful.length;

        if (!options.dryRun && successful.length > 0) {
          // Write to PostgreSQL
          if (type === 'definitions') {
            await this.db.updateDefinitionVietnamese(successful);
          } else {
            await this.db.updateExampleVietnamese(successful);
          }

          // Update progress tracker
          this.tracker.markBatch(successful, type);
        }

        // Mark failed items
        for (const item of batch) {
          const result = results.find((r) => r.id === item.id);
          const rejection = rejections.get(item.id);
          if (rejection) {
            this.tracker.markFailed(item.id, type, `Rejected: ${rejection}`);
          } else if (!result || !result.vi || result.vi.trim().length === 0) {
            this.tracker.markFailed(item.id, type, 'Empty translation');
          }
        }

        this.stats.translated += successful.length;
        this.stats.failed += failedCount;
        this.tracker.logBatch(type, batch.length, successful.length, failedCount);

        console.log(`→ ${successful.length} ✅`);
      } catch (error: any) {
        console.log(`→ ❌ ${error.message}`);
        this.stats.failed += batch.length;
        this.tracker.logBatch(type, batch.length, 0, batch.length, error.message);

        // Mark all items in batch as failed
        for (const item of batch) {
          this.tracker.markFailed(item.id, type, error.message);
        }
      }

      // Update run stats
      this.tracker.updateRun(runId, this.stats.translated, this.stats.failed, this.stats.requestsMade);

      // Delay between requests
      if (i < batches.length - 1 && !this.aborted) {
        await this.sleep(config.batch.delayBetweenRequests);
      }
    }

    return this.stats;
  }

  private async translateBatch(
    items: (TranslationItem | ExampleItem)[],
    type: TranslationType,
  ): Promise<TranslationResult[]> {
    const messages =
      type === 'definitions'
        ? buildDefinitionPrompt(items as TranslationItem[])
        : buildExamplePrompt(items as ExampleItem[]);

    const responseText = await this.client.translate(messages);

    // Parse JSON response
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error('Invalid JSON in API response');
      }
    }

    const results: TranslationResult[] = parsed.results || parsed;

    if (!Array.isArray(results)) {
      throw new Error('API response is not an array');
    }

    // Validate: ensure all IDs from input are present in output
    const inputIds = new Set(items.map((item) => item.id));
    const validResults = results.filter(
      (r) => inputIds.has(r.id) && typeof r.vi === 'string' && r.vi.trim().length > 0,
    );

    return validResults;
  }

  private calculateETA(): string {
    const elapsed = Date.now() - this.stats.startedAt.getTime();
    const done = this.stats.translated + this.stats.failed;
    if (done === 0) return '—';

    const remaining = this.stats.totalToTranslate - done;
    const msPerItem = elapsed / done;
    const remainingMs = remaining * msPerItem;

    if (remainingMs < 60_000) return `${Math.ceil(remainingMs / 1000)}s`;
    if (remainingMs < 3_600_000) return `${Math.ceil(remainingMs / 60_000)}m`;
    if (remainingMs < 86_400_000) return `${(remainingMs / 3_600_000).toFixed(1)}h`;
    return `${(remainingMs / 86_400_000).toFixed(1)}d`;
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
