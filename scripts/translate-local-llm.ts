/**
 * Translate Vietnamese meanings using the local LLM endpoint.
 * Usage:
 *   npx ts-node scripts/translate-local-llm.ts [options]
 *
 * Options:
 *   --type definitions|examples|all   What to translate (default: definitions)
 *   --batch-size <n>                  Items per LLM request (default: 20)
 *   --limit <n>                       Max items to translate (0 = unlimited)
 *   --word <word>                     Only translate a specific word
 *   --stats                           Show current stats and exit
 *   --llm-url <url>                   Override LLM endpoint URL
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { LocalLlmClient } from './ai-translate/local-llm-client';
import { DbConnector } from './ai-translate/db-connector';

const DEFAULT_LLM_URL = process.env.LOCAL_LLM_URL || 'http://113.160.225.76:8558/serious/llm/chat';
const DEFAULT_BATCH_SIZE = 20;

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    type: 'definitions' as 'definitions' | 'examples' | 'all',
    batchSize: DEFAULT_BATCH_SIZE,
    limit: 0,
    word: null as string | null,
    stats: false,
    llmUrl: DEFAULT_LLM_URL,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stats') opts.stats = true;
    else if (a === '--type' && args[i + 1]) opts.type = args[++i] as any;
    else if (a === '--batch-size' && args[i + 1]) opts.batchSize = parseInt(args[++i]);
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (a === '--word' && args[i + 1]) opts.word = args[++i];
    else if (a === '--llm-url' && args[i + 1]) opts.llmUrl = args[++i];
  }

  return opts;
}

// ─── Text cleaner ─────────────────────────────────────────────────────────────

function cleanDefinition(text: string): string {
  // Remove Wiktionary markup: (archaic|dialectal) → (archaic, dialectal)
  return text
    .replace(/\|/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildDefinitionPrompt(items: { id: number; word: string; pos: string; en: string }[]): string {
  const input = items.map((i) => ({ id: i.id, word: i.word, pos: i.pos, en: cleanDefinition(i.en) }));
  return (
    `Translate these English word definitions to Vietnamese. ` +
    `Return ONLY a JSON object: {"results": [{"id": <id>, "vi": "<Vietnamese translation>"}]}\n\n` +
    `Rules:\n` +
    `- Translate accurately and naturally in dictionary style\n` +
    `- Preserve part-of-speech nuance\n` +
    `- Return exactly one result per input item\n\n` +
    `Input:\n${JSON.stringify(input)}`
  );
}

function buildExamplePrompt(items: { id: number; word: string; en: string }[]): string {
  const input = items.map((i) => ({ id: i.id, word: i.word, en: cleanDefinition(i.en) }));
  return (
    `Translate these English example sentences to Vietnamese. ` +
    `Return ONLY a JSON object: {"results": [{"id": <id>, "vi": "<Vietnamese translation>"}]}\n\n` +
    `Rules:\n` +
    `- Translate naturally, not word-by-word\n` +
    `- Preserve tone and register\n` +
    `- Return exactly one result per input item\n\n` +
    `Input:\n${JSON.stringify(input)}`
  );
}

// ─── JSON extractor (handles extra text after JSON) ───────────────────────────

function extractResults(responseText: string, inputIds: number[]): { id: number; vi: string }[] {
  // Try direct parse first
  let parsed: any = null;

  // Strip common LLM suffixes like <|note|>...</|note|>
  const cleaned = responseText.replace(/<\|.*?\|>[\s\S]*?<\/\|.*?\|>/g, '').trim();

  // Try to find the first complete JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    // Try markdown code block
    const codeBlock = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      try { parsed = JSON.parse(codeBlock[1].trim()); } catch { return []; }
    } else {
      return [];
    }
  }

  const results: { id: number; vi: string }[] = parsed?.results || parsed;
  if (!Array.isArray(results)) return [];

  const idSet = new Set(inputIds);
  return results.filter(
    (r) => r && idSet.has(r.id) && typeof r.vi === 'string' && r.vi.trim().length > 0,
  );
}

// ─── Translation runner ───────────────────────────────────────────────────────

interface RunStats {
  translated: number;
  failed: number;
  requests: number;
  startedAt: number;
}

async function runTranslation(
  type: 'definitions' | 'examples',
  db: DbConnector,
  llm: LocalLlmClient,
  opts: ReturnType<typeof parseArgs>,
): Promise<RunStats> {
  const stats: RunStats = { translated: 0, failed: 0, requests: 0, startedAt: Date.now() };
  const label = type === 'definitions' ? 'definitions' : 'examples';

  console.log(`\n📝 Translating ${label}...`);

  const items =
    type === 'definitions'
      ? await db.fetchUntranslatedDefinitions(opts.limit, new Set(), opts.word)
      : await db.fetchUntranslatedExamples(opts.limit, new Set(), opts.word);

  if (items.length === 0) {
    console.log(`   ✨ All ${label} already have Vietnamese!\n`);
    return stats;
  }

  console.log(`   📊 Found ${items.length.toLocaleString()} ${label} to translate\n`);

  const batches: typeof items[] = [];
  for (let i = 0; i < items.length; i += opts.batchSize) {
    batches.push(items.slice(i, i + opts.batchSize));
  }

  let aborted = false;
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping... finishing current batch.');
    aborted = true;
  });

  for (let i = 0; i < batches.length; i++) {
    if (aborted) {
      console.log('   ⏹️  Stopped. Run again to resume (already-translated items are saved).\n');
      break;
    }

    const batch = batches[i];
    const done = stats.translated + stats.failed;
    const pct = items.length > 0 ? ((done / items.length) * 100).toFixed(1) : '0.0';
    const eta = calcETA(stats, done, items.length);

    process.stdout.write(
      `   [${i + 1}/${batches.length}] ${done.toLocaleString()}/${items.length.toLocaleString()} (${pct}%) | ` +
        `${stats.translated} ✅ ${stats.failed} ❌ | ETA: ${eta} `,
    );

    try {
      const prompt =
        type === 'definitions'
          ? buildDefinitionPrompt(batch as any)
          : buildExamplePrompt(batch as any);

      const responseText = await llm.translate(prompt, 2000);
      stats.requests++;

      const inputIds = batch.map((b) => b.id);
      let results = extractResults(responseText, inputIds);

      // If full batch failed, retry in smaller chunks of 5
      if (results.length === 0 && batch.length > 5) {
        const miniChunks: typeof batch[] = [];
        for (let j = 0; j < batch.length; j += 5) miniChunks.push(batch.slice(j, j + 5));
        results = [];
        for (const mini of miniChunks) {
          try {
            const miniPrompt =
              type === 'definitions'
                ? buildDefinitionPrompt(mini as any)
                : buildExamplePrompt(mini as any);
            const miniText = await llm.translate(miniPrompt, 800);
            stats.requests++;
            results.push(...extractResults(miniText, mini.map((b) => b.id)));
          } catch {
            // ignore mini-batch errors
          }
        }
      }

      const failedCount = batch.length - results.length;
      stats.translated += results.length;
      stats.failed += failedCount;

      if (results.length > 0) {
        if (type === 'definitions') {
          await db.updateDefinitionVietnamese(results);
        } else {
          await db.updateExampleVietnamese(results);
        }
      }

      process.stdout.write(`→ ${results.length} ✅\n`);
    } catch (error: any) {
      stats.failed += batch.length;
      process.stdout.write(`→ ❌ ${error.message}\n`);
    }
  }

  return stats;
}

function calcETA(stats: RunStats, done: number, total: number): string {
  if (done === 0) return '—';
  const elapsed = Date.now() - stats.startedAt;
  const remaining = total - done;
  const msPerItem = elapsed / done;
  const remainingMs = remaining * msPerItem;

  if (remainingMs < 60_000) return `${Math.ceil(remainingMs / 1000)}s`;
  if (remainingMs < 3_600_000) return `${Math.ceil(remainingMs / 60_000)}m`;
  if (remainingMs < 86_400_000) return `${(remainingMs / 3_600_000).toFixed(1)}h`;
  return `${(remainingMs / 86_400_000).toFixed(1)}d`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('\n🇻🇳 Vietnamese Translation — Local LLM');
  console.log('════════════════════════════════════════');
  console.log(`   LLM URL:    ${opts.llmUrl}`);
  console.log(`   Type:       ${opts.type}`);
  console.log(`   Batch size: ${opts.batchSize}`);
  if (opts.limit) console.log(`   Limit:      ${opts.limit}`);
  if (opts.word) console.log(`   Word:       ${opts.word}`);

  const db = new DbConnector();
  await db.connect();
  console.log('\n   ✅ Connected to PostgreSQL');

  if (opts.stats) {
    const counts = await db.getCounts();
    console.log('\n📊 Current Stats:');
    console.log(`   Definitions: ${counts.defsWithVi.toLocaleString()} / ${counts.totalDefs.toLocaleString()} with Vietnamese (${((counts.defsWithVi/counts.totalDefs)*100).toFixed(1)}%)`);
    console.log(`   Examples:    ${counts.examplesWithVi.toLocaleString()} / ${counts.totalExamples.toLocaleString()} with Vietnamese (${((counts.examplesWithVi/counts.totalExamples)*100).toFixed(1)}%)`);
    await db.disconnect();
    return;
  }

  const llm = new LocalLlmClient(opts.llmUrl);

  const allStats: RunStats[] = [];

  if (opts.type === 'definitions' || opts.type === 'all') {
    allStats.push(await runTranslation('definitions', db, llm, opts));
  }

  if (opts.type === 'examples' || opts.type === 'all') {
    allStats.push(await runTranslation('examples', db, llm, opts));
  }

  await db.disconnect();

  // Summary
  const total = allStats.reduce((a, s) => ({ translated: a.translated + s.translated, failed: a.failed + s.failed, requests: a.requests + s.requests, startedAt: a.startedAt }), { translated: 0, failed: 0, requests: 0, startedAt: allStats[0]?.startedAt || Date.now() });
  const elapsed = Math.round((Date.now() - (allStats[0]?.startedAt || Date.now())) / 1000);

  console.log('\n' + '═'.repeat(43));
  console.log('📋 Summary:');
  console.log(`   Translated: ${total.translated.toLocaleString()} ✅`);
  console.log(`   Failed:     ${total.failed.toLocaleString()} ❌`);
  console.log(`   Requests:   ${total.requests.toLocaleString()}`);
  console.log(`   Time:       ${elapsed}s`);
  console.log('═'.repeat(43) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
