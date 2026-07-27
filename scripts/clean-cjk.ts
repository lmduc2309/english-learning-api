/**
 * Remove CJK (Chinese) content from Vietnamese fields.
 *
 * Cleans definitions.definition_vi and examples.example_vi (sets them to NULL
 * when they contain CJK characters). Reports — but never modifies — CJK found
 * in definition_en / example_en.
 *
 * USAGE:
 *   npm run clean-cjk:dry     # report counts + samples, write nothing
 *   npm run clean-cjk         # perform the nulling
 *   npm run clean-cjk -- --limit 50
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import { containsCjk } from './lib/cjk';

dotenv.config();

// Postgres POSIX-regex character class matching the CJK ranges, built from
// explicit codepoints (not literal boundary characters) to avoid the
// Unicode-confusable bug fixed in Task 1's CJK_REGEX. Used only to PREFILTER
// candidate rows; containsCjk is the authoritative check applied in JS
// afterwards.
const cjkRange = (a: number, b: number) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`;
const PG_CJK =
  `[${cjkRange(0x3000, 0x303f)}${cjkRange(0x3400, 0x4dbf)}${cjkRange(0x4e00, 0x9fff)}` +
  `${cjkRange(0xf900, 0xfaff)}${cjkRange(0xff00, 0xffef)}]`;

interface Args {
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const limit = i !== -1 && i + 1 < argv.length ? parseInt(argv[i + 1], 10) : 20;
  return { dryRun: argv.includes('--dry-run'), limit };
}

// DataSource config copied verbatim from scripts/import-vietnamese-meanings.ts.
function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    synchronize: false,
    logging: false,
  });
}

function printSamples(rows: Array<{ id: string; label: string; val: string }>, limit: number) {
  for (const r of rows.slice(0, limit)) {
    const val = r.val.length > 80 ? r.val.slice(0, 80) + '…' : r.val;
    console.log(`    #${r.id} ${r.label}: ${val}`);
  }
  if (rows.length > limit) console.log(`    …and ${rows.length - limit} more`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`clean-cjk — ${args.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);

  const ds = createDataSource();
  await ds.initialize();

  // --- definitions.definition_vi (CLEAN) ---
  const defRows: Array<{ id: string; word: string; val: string }> = await ds.query(
    `SELECT d.id::text AS id, w.word, d.definition_vi AS val
       FROM definitions d JOIN words w ON w.id = d.word_id
      WHERE d.definition_vi ~ $1`,
    [PG_CJK],
  );
  const defHits = defRows.filter((r) => containsCjk(r.val));
  console.log(`\ndefinitions.definition_vi: ${defHits.length} rows contain CJK`);
  printSamples(defHits.map((r) => ({ id: r.id, label: r.word, val: r.val })), args.limit);

  // --- examples.example_vi (CLEAN) ---
  const exRows: Array<{ id: string; val: string }> = await ds.query(
    `SELECT e.id::text AS id, e.example_vi AS val FROM examples e WHERE e.example_vi ~ $1`,
    [PG_CJK],
  );
  const exHits = exRows.filter((r) => containsCjk(r.val));
  console.log(`examples.example_vi: ${exHits.length} rows contain CJK`);
  printSamples(exHits.map((r) => ({ id: r.id, label: 'ex', val: r.val })), args.limit);

  // --- Apply nulling in one transaction ---
  if (!args.dryRun && (defHits.length || exHits.length)) {
    await ds.transaction(async (m) => {
      const chunk = <T>(a: T[], n: number) =>
        Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));
      for (const ids of chunk(defHits.map((r) => r.id), 500)) {
        await m.query(
          `UPDATE definitions SET definition_vi = NULL, review_status = 'raw', is_learner_visible = false WHERE id = ANY($1::bigint[])`,
          [ids],
        );
      }
      for (const ids of chunk(exHits.map((r) => r.id), 500)) {
        await m.query(
          `UPDATE examples SET example_vi = NULL, review_status = 'raw', is_learner_visible = false WHERE id = ANY($1::bigint[])`,
          [ids],
        );
      }
    });
    console.log(`\nCleaned: definition_vi=${defHits.length}, example_vi=${exHits.length}`);
  }

  // --- English columns: REPORT ONLY (never modified) ---
  const defEn: Array<{ id: string; word: string; val: string }> = await ds.query(
    `SELECT d.id::text AS id, w.word, d.definition_en AS val
       FROM definitions d JOIN words w ON w.id = d.word_id
      WHERE d.definition_en ~ $1`,
    [PG_CJK],
  );
  const defEnHits = defEn.filter((r) => containsCjk(r.val));
  console.log(`\n[report-only] definitions.definition_en: ${defEnHits.length} rows contain CJK`);
  printSamples(defEnHits.map((r) => ({ id: r.id, label: r.word, val: r.val })), args.limit);

  const exEn: Array<{ id: string; val: string }> = await ds.query(
    `SELECT e.id::text AS id, e.example_en AS val FROM examples e WHERE e.example_en ~ $1`,
    [PG_CJK],
  );
  const exEnHits = exEn.filter((r) => containsCjk(r.val));
  console.log(`[report-only] examples.example_en: ${exEnHits.length} rows contain CJK`);
  printSamples(exEnHits.map((r) => ({ id: r.id, label: 'ex', val: r.val })), args.limit);

  console.log(
    `\nSummary — VN ${args.dryRun ? 'would clean' : 'cleaned'}: definition_vi=${defHits.length}, ` +
      `example_vi=${exHits.length}; EN report-only: definition_en=${defEnHits.length}, example_en=${exEnHits.length}.`,
  );

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
