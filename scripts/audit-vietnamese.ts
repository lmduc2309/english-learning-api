/**
 * Audit missing Vietnamese meanings + normalize blank values.
 *
 * Reports how many definitions/examples lack a Vietnamese value (NULL or blank),
 * with a frequency breakdown and a sample of the most-common missing words.
 * `--normalize-empty` converts blank ('' / whitespace) definition_vi/example_vi
 * to NULL so the existing fillers will pick them up.
 *
 * USAGE:
 *   npm run audit-vi                    # report only (no writes)
 *   npm run audit-vi -- --normalize-empty
 *   npm run audit-vi -- --limit 50
 *
 * FILL RUNBOOK (uses existing scripts; run in order):
 *   1. npm run clean-cjk                 # remove Chinese glosses (nulls them)
 *   2. npm run audit-vi                  # baseline gap
 *   3. npm run audit-vi -- --normalize-empty   # blanks -> NULL (fillable)
 *   4. npm run import-vi                 # offline dict fill (free, exact)
 *   5. npm run ai-translate:defs && npm run ai-translate:examples   # OpenRouter LLM (needs OPENROUTER_API_KEY)
 *   6. npm run audit-vi                  # confirm gap shrank; repeat step 5 as needed
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
import { missingViSql, blankViSql } from './lib/missing-vi';

dotenv.config();

const FREQ_BANDS = ['1-1000', '1001-5000', '5001-20000', '20001+', 'no rank'];

interface Args {
  normalizeEmpty: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const parsed = i !== -1 && i + 1 < argv.length ? parseInt(argv[i + 1], 10) : NaN;
  return {
    normalizeEmpty: argv.includes('--normalize-empty'),
    limit: Number.isFinite(parsed) ? parsed : 20,
  };
}

function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    logging: false,
  });
}

async function scalar(ds: DataSource, sql: string, params: unknown[] = []): Promise<number> {
  const rows = await ds.query(sql, params);
  return Number(rows[0].c);
}

function pct(part: number, total: number): string {
  return total === 0 ? '100.0' : ((part / total) * 100).toFixed(1);
}

async function reportColumn(
  ds: DataSource,
  table: string,
  viCol: string,
  enCol: string,
) {
  const base = `FROM ${table} WHERE ${enCol} IS NOT NULL`;
  const total = await scalar(ds, `SELECT count(*)::int c ${base}`);
  const missing = await scalar(ds, `SELECT count(*)::int c ${base} AND ${missingViSql(viCol)}`);
  const blank = await scalar(ds, `SELECT count(*)::int c ${base} AND ${blankViSql(viCol)}`);
  const has = total - missing;
  console.log(`\n${table}.${viCol} (rows with ${enCol}):`);
  console.log(`  total=${total}  has-VN=${has} (${pct(has, total)}%)  missing=${missing} (${pct(missing, total)}%)  [of which blank='': ${blank}]`);
}

async function reportFrequencyBands(ds: DataSource) {
  const rows: Array<{ band: string; total: number; missing: number }> = await ds.query(
    `SELECT
       CASE WHEN w.frequency_rank IS NULL THEN 'no rank'
            WHEN w.frequency_rank <= 1000 THEN '1-1000'
            WHEN w.frequency_rank <= 5000 THEN '1001-5000'
            WHEN w.frequency_rank <= 20000 THEN '5001-20000'
            ELSE '20001+' END AS band,
       count(*)::int AS total,
       count(*) FILTER (WHERE ${missingViSql('d.definition_vi')})::int AS missing
     FROM definitions d JOIN words w ON w.id = d.word_id
     WHERE d.definition_en IS NOT NULL
     GROUP BY band`,
  );
  const byBand = new Map(rows.map((r) => [r.band, r]));
  console.log(`\ndefinition_vi missing by word frequency:`);
  for (const band of FREQ_BANDS) {
    const r = byBand.get(band) || { total: 0, missing: 0 };
    console.log(`  ${band.padEnd(12)} missing ${r.missing}/${r.total} (${pct(r.missing, r.total)}%)`);
  }
}

async function reportSamples(ds: DataSource, limit: number) {
  const rows: Array<{ word: string; pos: string }> = await ds.query(
    `SELECT w.word, d.part_of_speech AS pos
     FROM definitions d JOIN words w ON w.id = d.word_id
     WHERE d.definition_en IS NOT NULL AND ${missingViSql('d.definition_vi')}
     ORDER BY w.frequency_rank ASC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  console.log(`\nTop ${limit} most-frequent missing words:`);
  for (const r of rows) console.log(`  ${r.word} (${r.pos})`);
  if (rows.length === 0) console.log('  (none)');
}

async function normalizeEmpty(ds: DataSource) {
  const defBlank = await scalar(ds, `SELECT count(*)::int c FROM definitions WHERE ${blankViSql('definition_vi')}`);
  const exBlank = await scalar(ds, `SELECT count(*)::int c FROM examples WHERE ${blankViSql('example_vi')}`);
  await ds.transaction(async (m) => {
    await m.query(`UPDATE definitions SET definition_vi = NULL WHERE ${blankViSql('definition_vi')}`);
    await m.query(`UPDATE examples SET example_vi = NULL WHERE ${blankViSql('example_vi')}`);
  });
  console.log(`\nNormalized blanks -> NULL: definition_vi=${defBlank}, example_vi=${exBlank}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ds = createDataSource();
  await ds.initialize();

  console.log(`Vietnamese coverage audit${args.normalizeEmpty ? ' (with --normalize-empty)' : ''}`);
  await reportColumn(ds, 'definitions', 'definition_vi', 'definition_en');
  await reportColumn(ds, 'examples', 'example_vi', 'example_en');
  await reportFrequencyBands(ds);
  await reportSamples(ds, args.limit);

  if (args.normalizeEmpty) await normalizeEmpty(ds);

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
