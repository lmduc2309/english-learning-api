/**
 * Translate Vietnamese meanings using Google Translate (unofficial, no API key needed).
 * Uses separator-based batching to minimize API calls.
 *
 * Usage:
 *   npx ts-node scripts/translate-google.ts [options]
 *
 * Options:
 *   --type definitions|examples|all   What to translate (default: all)
 *   --batch-size <n>                  Items per request (default: 30)
 *   --limit <n>                       Max items (0 = unlimited)
 *   --word <word>                     Only translate a specific word
 *   --stats                           Show stats and exit
 *   --delay <ms>                      Delay between requests in ms (default: 300)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { translate } from '@vitalets/google-translate-api';
import { DbConnector } from './ai-translate/db-connector';

const SEPARATOR = '\n|||###|||\n';
const DEFAULT_BATCH_SIZE = 10;   // 10 items per request
const DEFAULT_DELAY_MS = 8000;   // 8s between requests = ~450 req/hour (safe limit)
const MAX_CHARS_PER_REQUEST = 3000;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60_000; // wait 30min when rate limited

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    type: 'all' as 'definitions' | 'examples' | 'all',
    batchSize: DEFAULT_BATCH_SIZE,
    limit: 0,
    word: null as string | null,
    stats: false,
    delayMs: DEFAULT_DELAY_MS,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stats') opts.stats = true;
    else if (a === '--type' && args[i + 1]) opts.type = args[++i] as any;
    else if (a === '--batch-size' && args[i + 1]) opts.batchSize = parseInt(args[++i]);
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (a === '--word' && args[i + 1]) opts.word = args[++i];
    else if (a === '--delay' && args[i + 1]) opts.delayMs = parseInt(args[++i]);
  }

  return opts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(text: string): string {
  return text
    .replace(/\|/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // strip control chars
    .trim();
}

function calcETA(startedAt: number, done: number, total: number): string {
  if (done === 0) return '—';
  const elapsed = Date.now() - startedAt;
  const remaining = total - done;
  const msPerItem = elapsed / done;
  const remainingMs = remaining * msPerItem;
  if (remainingMs < 60_000) return `${Math.ceil(remainingMs / 1000)}s`;
  if (remainingMs < 3_600_000) return `${Math.ceil(remainingMs / 60_000)}m`;
  if (remainingMs < 86_400_000) return `${(remainingMs / 3_600_000).toFixed(1)}h`;
  return `${(remainingMs / 86_400_000).toFixed(1)}d`;
}

// ─── Google Translate with batching ──────────────────────────────────────────

let consecutiveRateLimits = 0;

async function translateBatch(texts: string[], retries = 3): Promise<string[]> {
  const joined = texts.map(cleanText).join(SEPARATOR);

  let attempt = 0;
  while (attempt < retries * 4) {
    attempt++;
    try {
      const { text: translated } = await translate(joined, { to: 'vi', from: 'en' });
      const parts = translated.split(SEPARATOR.trim()).map((s) => s.trim());

      consecutiveRateLimits = 0; // reset on success

      if (parts.length === texts.length) {
        return parts;
      }

      // Fallback: translate individually
      const results: string[] = [];
      for (const t of texts) {
        const { text } = await translate(cleanText(t), { to: 'vi', from: 'en' });
        results.push(text);
        await sleep(500);
      }
      return results;
    } catch (err: any) {
      const isRateLimit = err.message?.includes('Too Many Requests') || err.message?.includes('429');

      if (isRateLimit) {
        consecutiveRateLimits++;
        const cooldown = RATE_LIMIT_COOLDOWN_MS * Math.min(consecutiveRateLimits, 5);
        process.stdout.write(` 🚦 rate limited, cooling ${cooldown / 1000}s...`);
        await sleep(cooldown);
        continue; // retry after cooldown, don't count as a normal attempt
      }

      if (attempt < retries) {
        const wait = attempt * 3000;
        process.stdout.write(` ⚠️ retry ${attempt}/${retries} in ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }

  return [];
}

// ─── Translation runner ───────────────────────────────────────────────────────

async function runTranslation(
  type: 'definitions' | 'examples',
  db: DbConnector,
  opts: ReturnType<typeof parseArgs>,
) {
  const label = type === 'definitions' ? 'definitions' : 'examples';
  console.log(`\n📝 Translating ${label}...`);

  const items =
    type === 'definitions'
      ? await db.fetchUntranslatedDefinitions(opts.limit, new Set(), opts.word)
      : await db.fetchUntranslatedExamples(opts.limit, new Set(), opts.word);

  if (items.length === 0) {
    console.log(`   ✨ All ${label} already have Vietnamese!\n`);
    return { translated: 0, failed: 0 };
  }

  console.log(`   📊 Found ${items.length.toLocaleString()} ${label} to translate\n`);

  // Build size-aware batches (respect max char limit)
  const batches: typeof items[] = [];
  let current: typeof items = [];
  let currentChars = 0;

  for (const item of items) {
    const text = cleanText(type === 'definitions' ? (item as any).en : (item as any).en);
    const charCount = text.length + SEPARATOR.length;

    if (current.length >= opts.batchSize || (current.length > 0 && currentChars + charCount > MAX_CHARS_PER_REQUEST)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += charCount;
  }
  if (current.length > 0) batches.push(current);

  let translated = 0;
  let failed = 0;
  let aborted = false;
  const startedAt = Date.now();

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping... (progress is saved, re-run to resume)');
    aborted = true;
  });

  for (let i = 0; i < batches.length; i++) {
    if (aborted) break;

    const batch = batches[i];
    const done = translated + failed;
    const pct = items.length > 0 ? ((done / items.length) * 100).toFixed(1) : '0.0';
    const eta = calcETA(startedAt, done, items.length);

    process.stdout.write(
      `   [${i + 1}/${batches.length}] ${done.toLocaleString()}/${items.length.toLocaleString()} (${pct}%) | ` +
        `${translated} ✅ ${failed} ❌ | ETA: ${eta} `,
    );

    try {
      const texts = batch.map((b) => (b as any).en as string);
      const viTexts = await translateBatch(texts);

      const updates = batch.map((b, idx) => ({
        id: b.id,
        vi: viTexts[idx] || '',
      })).filter((u) => u.vi.length > 0);

      if (updates.length > 0) {
        if (type === 'definitions') {
          await db.updateDefinitionVietnamese(updates);
        } else {
          await db.updateExampleVietnamese(updates);
        }
      }

      translated += updates.length;
      failed += batch.length - updates.length;

      process.stdout.write(`→ ${updates.length} ✅\n`);
    } catch (err: any) {
      failed += batch.length;
      process.stdout.write(`→ ❌ ${err.message?.slice(0, 60)}\n`);
    }

    if (opts.delayMs > 0) {
      // Add ±30% jitter to avoid robotic patterns
      const jitter = (Math.random() - 0.5) * opts.delayMs * 0.6;
      await sleep(Math.max(1000, opts.delayMs + jitter));
    }
  }

  return { translated, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('\n🇻🇳 Vietnamese Translation — Google Translate');
  console.log('═══════════════════════════════════════════════');
  console.log(`   Type:       ${opts.type}`);
  console.log(`   Batch size: ${opts.batchSize}`);
  console.log(`   Delay:      ${opts.delayMs}ms between requests`);
  if (opts.limit) console.log(`   Limit:      ${opts.limit}`);
  if (opts.word) console.log(`   Word:       ${opts.word}`);

  const db = new DbConnector();
  await db.connect();
  console.log('\n   ✅ Connected to PostgreSQL');

  if (opts.stats) {
    const counts = await db.getCounts();
    console.log('\n📊 Current Stats:');
    console.log(`   Definitions: ${counts.defsWithVi.toLocaleString()} / ${counts.totalDefs.toLocaleString()} (${((counts.defsWithVi / counts.totalDefs) * 100).toFixed(1)}%)`);
    console.log(`   Examples:    ${counts.examplesWithVi.toLocaleString()} / ${counts.totalExamples.toLocaleString()} (${((counts.examplesWithVi / counts.totalExamples) * 100).toFixed(1)}%)`);
    await db.disconnect();
    return;
  }

  const startedAt = Date.now();
  let totalTranslated = 0;
  let totalFailed = 0;

  if (opts.type === 'definitions' || opts.type === 'all') {
    const r = await runTranslation('definitions', db, opts);
    totalTranslated += r.translated;
    totalFailed += r.failed;
  }

  if (opts.type === 'examples' || opts.type === 'all') {
    const r = await runTranslation('examples', db, opts);
    totalTranslated += r.translated;
    totalFailed += r.failed;
  }

  await db.disconnect();

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n' + '═'.repeat(48));
  console.log('📋 Summary:');
  console.log(`   Translated: ${totalTranslated.toLocaleString()} ✅`);
  console.log(`   Failed:     ${totalFailed.toLocaleString()} ❌`);
  console.log(`   Time:       ${elapsed}s`);
  console.log('═'.repeat(48) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
