/**
 * Translate Vietnamese meanings using multiple free providers in rotation.
 * Providers: LibreTranslate (multiple instances) + MyMemory + Lingva
 * Rotates providers to avoid rate limits on any single service.
 *
 * Usage:
 *   npx ts-node scripts/translate-multi.ts [options]
 *
 * Options:
 *   --type definitions|examples|all
 *   --limit <n>        Max items (0 = unlimited)
 *   --word <word>      Only translate a specific word
 *   --stats            Show stats and exit
 *   --delay <ms>       Base delay between requests (default: 800)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { DbConnector } from './ai-translate/db-connector';

const DEFAULT_DELAY_MS = 800;
const DB_FLUSH_EVERY = 50;

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    type: 'all' as 'definitions' | 'examples' | 'all',
    limit: 0,
    word: null as string | null,
    stats: false,
    delayMs: DEFAULT_DELAY_MS,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stats') opts.stats = true;
    else if (a === '--type' && args[i + 1]) opts.type = args[++i] as any;
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i]);
    else if (a === '--word' && args[i + 1]) opts.word = args[++i];
    else if (a === '--delay' && args[i + 1]) opts.delayMs = parseInt(args[++i]);
  }
  return opts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function cleanText(text: string): string {
  return text
    .replace(/\|/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .slice(0, 480)
    .trim();
}

function calcETA(startedAt: number, done: number, total: number): string {
  if (done === 0) return '—';
  const ms = ((Date.now() - startedAt) / done) * (total - done);
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function httpRequest(url: string, opts: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: opts.timeoutMs || 15000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 100)}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ─── Provider implementations ─────────────────────────────────────────────────

interface Provider {
  name: string;
  cooldownUntil: number;
  failCount: number;
  successCount: number;
  translate(text: string): Promise<string>;
}

function makeLibreTranslate(host: string): Provider {
  return {
    name: `LibreTranslate(${host})`,
    cooldownUntil: 0,
    failCount: 0,
    successCount: 0,
    async translate(text: string): Promise<string> {
      const body = JSON.stringify({ q: text, source: 'en', target: 'vi', format: 'text' });
      const raw = await httpRequest(`${host}/translate`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() },
        timeoutMs: 12000,
      });
      const json = JSON.parse(raw);
      if (!json.translatedText) throw new Error(`No translation: ${raw.slice(0, 80)}`);
      return json.translatedText;
    },
  };
}

function makeMyMemory(): Provider {
  return {
    name: 'MyMemory',
    cooldownUntil: 0,
    failCount: 0,
    successCount: 0,
    async translate(text: string): Promise<string> {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`;
      const raw = await httpRequest(url, { timeoutMs: 12000 });
      const json = JSON.parse(raw);
      if (json.responseStatus === 429 || json?.responseData?.translatedText?.includes('MYMEMORY WARNING')) {
        throw new Error('429 quota exceeded');
      }
      const t = json?.responseData?.translatedText;
      if (!t) throw new Error(`Empty: ${raw.slice(0, 80)}`);
      return t;
    },
  };
}

function makeLingva(): Provider {
  // Lingva Translate — open-source Google Translate frontend
  const hosts = [
    'https://lingva.ml',
    'https://lingva.thedaviddelta.com',
  ];
  let hostIdx = 0;
  return {
    name: 'Lingva',
    cooldownUntil: 0,
    failCount: 0,
    successCount: 0,
    async translate(text: string): Promise<string> {
      const host = hosts[hostIdx % hosts.length];
      const url = `${host}/api/v1/en/vi/${encodeURIComponent(text)}`;
      const raw = await httpRequest(url, { timeoutMs: 12000 });
      const json = JSON.parse(raw);
      if (!json.translation) throw new Error(`No translation: ${raw.slice(0, 80)}`);
      hostIdx++;
      return json.translation;
    },
  };
}

// ─── Provider pool ────────────────────────────────────────────────────────────

class ProviderPool {
  private providers: Provider[];
  private idx = 0;

  constructor() {
    this.providers = [
      makeLibreTranslate('https://libretranslate.com'),
      makeLibreTranslate('https://translate.argosopentech.com'),
      makeLibreTranslate('https://libretranslate.de'),
      makeMyMemory(),
      makeLingva(),
    ];
  }

  async translate(text: string): Promise<string> {
    const now = Date.now();
    const available = this.providers.filter((p) => p.cooldownUntil <= now);

    if (available.length === 0) {
      // All in cooldown — wait for the earliest one
      const earliest = Math.min(...this.providers.map((p) => p.cooldownUntil));
      const wait = earliest - now + 500;
      process.stdout.write(` ⏳all cooling(${Math.ceil(wait / 1000)}s)...`);
      await sleep(wait);
      return this.translate(text);
    }

    // Round-robin across available providers
    const provider = available[this.idx % available.length];
    this.idx++;

    try {
      const result = await provider.translate(text);
      provider.successCount++;
      provider.failCount = 0;
      return result;
    } catch (err: any) {
      provider.failCount++;
      const isRateLimit = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('Too Many');
      const isMissing = err.message?.includes('404') || err.message?.includes('No translation');

      if (isRateLimit) {
        // Exponential backoff: 5min, 10min, 20min...
        const cooldown = Math.min(5 * 60_000 * Math.pow(2, provider.failCount - 1), 60 * 60_000);
        provider.cooldownUntil = Date.now() + cooldown;
        process.stdout.write(` [${provider.name} →cooldown ${Math.ceil(cooldown / 60000)}m]`);
      } else if (!isMissing && provider.failCount >= 3) {
        // Non-rate-limit errors: short cooldown
        provider.cooldownUntil = Date.now() + 30_000;
      }

      // Try next provider
      const nextAvailable = this.providers.filter((p) => p.cooldownUntil <= Date.now() && p !== provider);
      if (nextAvailable.length > 0) {
        const fallback = nextAvailable[0];
        try {
          const result = await fallback.translate(text);
          fallback.successCount++;
          return result;
        } catch {
          // All tried, give up on this item
        }
      }

      throw err;
    }
  }

  printStatus() {
    const now = Date.now();
    for (const p of this.providers) {
      const status = p.cooldownUntil > now
        ? `🔴 cooldown ${Math.ceil((p.cooldownUntil - now) / 60000)}m`
        : `🟢 ok`;
      console.log(`   ${p.name.padEnd(35)} ${status} (✅${p.successCount} ❌${p.failCount})`);
    }
  }
}

// ─── Translation runner ───────────────────────────────────────────────────────

async function runTranslation(
  type: 'definitions' | 'examples',
  db: DbConnector,
  pool: ProviderPool,
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
    console.log('\n\n🛑 Stopped. Re-run to resume.\n');
    aborted = true;
  });

  for (let i = 0; i < items.length; i++) {
    if (aborted) break;

    const item = items[i];
    const text = cleanText((item as any).en as string);

    if (i % 50 === 0) {
      process.stdout.write(
        `\r   [${(i + 1).toLocaleString()}/${items.length.toLocaleString()}] (${((i / items.length) * 100).toFixed(1)}%) | ` +
          `${translated} ✅ ${failed} ❌ | ETA: ${calcETA(startedAt, i, items.length)}    `,
      );
    }

    try {
      const vi = await pool.translate(text);
      if (vi && vi.trim().length > 0) {
        batchUpdates.push({ id: item.id, vi: vi.trim() });
        translated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // Flush to DB periodically
    if (batchUpdates.length >= DB_FLUSH_EVERY) {
      if (type === 'definitions') await db.updateDefinitionVietnamese([...batchUpdates]);
      else await db.updateExampleVietnamese([...batchUpdates]);
      batchUpdates.length = 0;
    }

    await sleep(opts.delayMs);
  }

  // Flush remaining
  if (batchUpdates.length > 0) {
    if (type === 'definitions') await db.updateDefinitionVietnamese([...batchUpdates]);
    else await db.updateExampleVietnamese([...batchUpdates]);
  }

  process.stdout.write('\n');
  return { translated, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('\n🇻🇳 Vietnamese Translation — Multi-Provider');
  console.log('═════════════════════════════════════════════');
  console.log(`   Type:       ${opts.type}`);
  console.log(`   Delay:      ${opts.delayMs}ms between requests`);
  if (opts.limit) console.log(`   Limit:      ${opts.limit}`);

  const db = new DbConnector();
  await db.connect();
  console.log('   ✅ Connected to PostgreSQL');

  if (opts.stats) {
    const counts = await db.getCounts();
    console.log('\n📊 Current Stats:');
    console.log(`   Definitions: ${counts.defsWithVi.toLocaleString()} / ${counts.totalDefs.toLocaleString()} (${((counts.defsWithVi / counts.totalDefs) * 100).toFixed(1)}%)`);
    console.log(`   Examples:    ${counts.examplesWithVi.toLocaleString()} / ${counts.totalExamples.toLocaleString()} (${((counts.examplesWithVi / counts.totalExamples) * 100).toFixed(1)}%)`);
    await db.disconnect();
    return;
  }

  const pool = new ProviderPool();
  const startedAt = Date.now();
  let totalTranslated = 0;
  let totalFailed = 0;

  if (opts.type === 'definitions' || opts.type === 'all') {
    const r = await runTranslation('definitions', db, pool, opts);
    totalTranslated += r.translated;
    totalFailed += r.failed;
  }

  if (opts.type === 'examples' || opts.type === 'all') {
    const r = await runTranslation('examples', db, pool, opts);
    totalTranslated += r.translated;
    totalFailed += r.failed;
  }

  await db.disconnect();

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log('\n' + '═'.repeat(46));
  console.log('📋 Summary:');
  console.log(`   Translated: ${totalTranslated.toLocaleString()} ✅`);
  console.log(`   Failed:     ${totalFailed.toLocaleString()} ❌`);
  console.log(`   Time:       ${elapsed}s`);
  console.log('\n📡 Provider stats:');
  pool.printStatus();
  console.log('═'.repeat(46) + '\n');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
