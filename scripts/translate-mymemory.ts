/**
 * Translate Vietnamese meanings using MyMemory API (free, no key needed).
 * Endpoint: https://api.mymemory.translated.net/get
 * Limits: ~10,000 words/day per IP (free), more with email param.
 *
 * Usage:
 *   npx ts-node scripts/translate-mymemory.ts [options]
 *
 * Options:
 *   --type definitions|examples|all   What to translate (default: all)
 *   --batch-size <n>                  Items per request (default: 5)
 *   --limit <n>                       Max items (0 = unlimited)
 *   --word <word>                     Only translate a specific word
 *   --stats                           Show stats and exit
 *   --delay <ms>                      Delay between requests in ms (default: 500)
 *   --email <email>                   Optional email for higher quota
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as https from 'https';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { DbConnector } from './ai-translate/db-connector';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_DELAY_MS = 500;
const MAX_CHARS_PER_REQUEST = 500; // MyMemory limit per request
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const SEPARATOR = ' ||| '; // separator that MyMemory preserves well

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
    email: process.env.MYMEMORY_EMAIL || '',
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stats') opts.stats = true;
    else if (a === '--type' && args[i + 1]) opts.type = args[++i] as any;
    else if (a === '--batch-size' && args[i + 1]) opts.batchSize = parseInt(args[++i]);
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (a === '--word' && args[i + 1]) opts.word = args[++i];
    else if (a === '--delay' && args[i + 1]) opts.delayMs = parseInt(args[++i]);
    else if (a === '--email' && args[i + 1]) opts.email = args[++i];
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
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .slice(0, 490) // stay under MyMemory 500 char limit
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

// ─── MyMemory API client ──────────────────────────────────────────────────────

async function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error(`429 Too Many Requests`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

let consecutiveErrors = 0;

async function translateText(text: string, email: string, retries = 4): Promise<string> {
  const cleaned = cleanText(text);
  if (!cleaned) return '';

  const encoded = encodeURIComponent(cleaned);
  let url = `${MYMEMORY_URL}?q=${encoded}&langpair=en|vi`;
  if (email) url += `&de=${encodeURIComponent(email)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const json = await httpGet(url);

      // Check for quota exceeded
      if (json?.responseStatus === 429 || json?.responseData?.translatedText?.includes('MYMEMORY WARNING')) {
        const wait = 60_000 * Math.min(++consecutiveErrors, 5);
        process.stdout.write(` 🚦 quota, wait ${wait / 1000}s...`);
        await sleep(wait);
        attempt--; // retry without consuming attempt count
        continue;
      }

      const translated = json?.responseData?.translatedText;
      if (translated && typeof translated === 'string' && translated.length > 0) {
        consecutiveErrors = 0;
        return translated;
      }

      throw new Error(`Empty response: ${JSON.stringify(json).slice(0, 80)}`);
    } catch (err: any) {
      if (err.message?.includes('429')) {
        const wait = 60_000 * Math.min(++consecutiveErrors, 5);
        process.stdout.write(` 🚦 rate limit, wait ${wait / 1000}s...`);
        await sleep(wait);
        attempt--;
        continue;
      }
      if (attempt < retries) {
        await sleep(attempt * 2000);
      } else {
        throw err;
      }
    }
  }

  return '';
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

  let translated = 0;
  let failed = 0;
  let aborted = false;
  const startedAt = Date.now();
  const batchUpdates: { id: number; vi: string }[] = [];

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping... (progress is saved, re-run to resume)');
    aborted = true;
  });

  for (let i = 0; i < items.length; i++) {
    if (aborted) break;

    const item = items[i];
    const text = (item as any).en as string;
    const pct = ((i / items.length) * 100).toFixed(1);
    const eta = calcETA(startedAt, i, items.length);

    if (i % 50 === 0) {
      process.stdout.write(
        `\r   [${(i + 1).toLocaleString()}/${items.length.toLocaleString()}] (${pct}%) | ` +
          `${translated} ✅ ${failed} ❌ | ETA: ${eta}    `,
      );
    }

    try {
      const vi = await translateText(text, opts.email);
      if (vi) {
        batchUpdates.push({ id: item.id, vi });
        translated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // Flush to DB every 50 items
    if (batchUpdates.length >= 50) {
      if (type === 'definitions') {
        await db.updateDefinitionVietnamese([...batchUpdates]);
      } else {
        await db.updateExampleVietnamese([...batchUpdates]);
      }
      batchUpdates.length = 0;
    }

    if (opts.delayMs > 0) await sleep(opts.delayMs);
  }

  // Flush remaining
  if (batchUpdates.length > 0) {
    if (type === 'definitions') {
      await db.updateDefinitionVietnamese([...batchUpdates]);
    } else {
      await db.updateExampleVietnamese([...batchUpdates]);
    }
  }

  process.stdout.write('\n');
  return { translated, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('\n🇻🇳 Vietnamese Translation — MyMemory API');
  console.log('═══════════════════════════════════════════');
  console.log(`   Type:       ${opts.type}`);
  console.log(`   Batch size: ${opts.batchSize} (per-item mode)`);
  console.log(`   Delay:      ${opts.delayMs}ms between requests`);
  console.log(`   Email:      ${opts.email || '(none — limited quota)'}`);
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
  console.log('\n' + '═'.repeat(44));
  console.log('📋 Summary:');
  console.log(`   Translated: ${totalTranslated.toLocaleString()} ✅`);
  console.log(`   Failed:     ${totalFailed.toLocaleString()} ❌`);
  console.log(`   Time:       ${elapsed}s`);
  console.log('═'.repeat(44) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
