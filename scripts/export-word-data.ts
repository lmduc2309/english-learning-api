import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { once } from 'events';
import { Client, QueryResult } from 'pg';

dotenv.config();

interface ExportSpec {
  file: string;
  description: string;
  query: string;
}

interface ExportResult {
  file: string;
  rows: number;
  bytes: number;
  sha256: string;
  description: string;
}

const dateStamp = new Date().toISOString().slice(0, 10);
const outputArgIndex = process.argv.indexOf('--output');
const outputDirectory = path.resolve(
  process.cwd(),
  outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
    ? process.argv[outputArgIndex + 1]
    : `reports/word-data-export-${dateStamp}`,
);
const pageSizeArgIndex = process.argv.indexOf('--page-size');
const pageSize = Number(
  pageSizeArgIndex >= 0 && process.argv[pageSizeArgIndex + 1]
    ? process.argv[pageSizeArgIndex + 1]
    : 5_000,
);

if (!Number.isSafeInteger(pageSize) || pageSize < 100 || pageSize > 50_000) {
  throw new Error('--page-size must be an integer between 100 and 50000');
}

const exportsToCreate: ExportSpec[] = [
  {
    file: '01_dictionary_review.csv',
    description:
      'One row per legacy definition with headword metadata, Vietnamese meaning, provenance, quality flags, and related-item summaries.',
    query: `
      WITH pronunciation_summary AS (
        SELECT word_id,
          string_agg(
            concat_ws(' ', accent, ipa, nullif(audio_url, '')),
            ' | ' ORDER BY accent, id
          ) AS pronunciations
        FROM pronunciations
        GROUP BY word_id
      ), form_summary AS (
        SELECT word_id,
          string_agg(concat(form_type, ': ', form_word), ' | ' ORDER BY form_type, id) AS word_forms
        FROM word_forms
        GROUP BY word_id
      ), synonym_summary AS (
        SELECT word_id,
          string_agg(
            concat_ws(' ', synonym_word, similarity_score::text),
            ' | ' ORDER BY similarity_score DESC NULLS LAST, synonym_word, id
          ) AS synonyms
        FROM synonyms
        GROUP BY word_id
      ), example_summary AS (
        SELECT definition_id, count(*)::int AS example_count
        FROM examples
        GROUP BY definition_id
      )
      SELECT
        w.id::text AS word_id,
        w.word,
        w.word_normalized,
        w.language,
        w.frequency_rank,
        array_to_string(w.part_of_speech, ' | ') AS headword_parts_of_speech,
        d.id::text AS definition_id,
        d.definition_order,
        d.part_of_speech,
        d.level,
        d.definition_en,
        d.definition_vi,
        d.source,
        d.source_sense_id,
        d.translation_method,
        d.translation_confidence,
        d.review_status,
        array_to_string(d.quality_flags, ' | ') AS quality_flags,
        d.is_learner_visible,
        coalesce(es.example_count, 0) AS example_count,
        ps.pronunciations,
        fs.word_forms,
        ss.synonyms,
        d.created_at AS definition_created_at,
        w.created_at AS word_created_at,
        w.updated_at AS word_updated_at
      FROM words w
      JOIN definitions d ON d.word_id = w.id
      LEFT JOIN pronunciation_summary ps ON ps.word_id = w.id
      LEFT JOIN form_summary fs ON fs.word_id = w.id
      LEFT JOIN synonym_summary ss ON ss.word_id = w.id
      LEFT JOIN example_summary es ON es.definition_id = d.id
      ORDER BY w.id, d.definition_order, d.id
    `,
  },
  {
    file: '02_examples_review.csv',
    description:
      'Every legacy example with its headword and parent definition for bilingual review.',
    query: `
      SELECT
        w.id::text AS word_id,
        w.word,
        d.id::text AS definition_id,
        d.definition_order,
        d.part_of_speech,
        d.definition_en,
        d.definition_vi,
        e.id::text AS example_id,
        e.example_en,
        e.example_vi,
        e.source,
        e.translation_method,
        e.translation_confidence,
        e.review_status,
        array_to_string(e.quality_flags, ' | ') AS quality_flags,
        e.is_learner_visible,
        e.created_at
      FROM examples e
      JOIN definitions d ON d.id = e.definition_id
      JOIN words w ON w.id = d.word_id
      ORDER BY w.id, d.definition_order, d.id, e.id
    `,
  },
  {
    file: '03_words.csv',
    description: 'Every dictionary headword and its base metadata.',
    query: `
      SELECT id::text AS id, word, language, word_normalized, frequency_rank,
        array_to_string(part_of_speech, ' | ') AS part_of_speech,
        created_at, updated_at
      FROM words
      ORDER BY id
    `,
  },
  {
    file: '04_pronunciations.csv',
    description: 'Every pronunciation row with headword context.',
    query: `
      SELECT p.id::text AS id, p.word_id::text AS word_id, w.word,
        p.accent, p.ipa, p.audio_url, p.created_at
      FROM pronunciations p
      JOIN words w ON w.id = p.word_id
      ORDER BY p.word_id, p.accent, p.id
    `,
  },
  {
    file: '05_word_forms.csv',
    description: 'Every inflected or related word form with headword context.',
    query: `
      SELECT wf.id::text AS id, wf.word_id::text AS word_id, w.word,
        wf.form_type, wf.form_word, wf.created_at
      FROM word_forms wf
      JOIN words w ON w.id = wf.word_id
      ORDER BY wf.word_id, wf.form_type, wf.id
    `,
  },
  {
    file: '06_synonyms.csv',
    description: 'Every synonym relationship with headword context.',
    query: `
      SELECT s.id::text AS id, s.word_id::text AS word_id, w.word,
        s.synonym_word, s.similarity_score, s.created_at
      FROM synonyms s
      JOIN words w ON w.id = s.word_id
      ORDER BY s.word_id, s.similarity_score DESC NULLS LAST, s.id
    `,
  },
  {
    file: '07_learner_entries.csv',
    description: 'Every normalized learner-overlay entry, including draft and retired rows.',
    query: `
      SELECT le.id::text AS id, le.word_id::text AS word_id, w.word,
        le.learner_rank, le.learner_band, le.rank_source,
        le.rank_source_version, le.rank_source_url, le.rank_source_license,
        le.status, le.created_at, le.updated_at
      FROM learner_entries le
      JOIN words w ON w.id = le.word_id
      ORDER BY le.learner_rank NULLS LAST, w.word, le.id
    `,
  },
  {
    file: '08_learner_senses.csv',
    description: 'Every learner sense with headword context and review/provenance fields.',
    query: `
      SELECT ls.id::text AS id, ls.learner_entry_id::text AS learner_entry_id,
        le.word_id::text AS word_id, w.word,
        ls.source_definition_id::text AS source_definition_id,
        ls.sense_key, ls.sense_order, ls.part_of_speech, ls.definition_en,
        ls.cefr_level, ls.cefr_source, ls.cefr_source_url,
        ls.cefr_source_version, ls.cefr_source_license, ls.cefr_basis,
        ls.cefr_confidence, array_to_string(ls.usage_labels, ' | ') AS usage_labels,
        ls.status, ls.definition_source, ls.definition_source_url,
        ls.definition_source_license, ls.definition_source_version,
        ls.definition_source_artifact_sha256, ls.review_notes,
        ls.reviewed_by, ls.reviewed_at, ls.created_at, ls.updated_at
      FROM learner_senses ls
      JOIN learner_entries le ON le.id = ls.learner_entry_id
      JOIN words w ON w.id = le.word_id
      ORDER BY le.learner_rank NULLS LAST, w.word, ls.sense_order, ls.id
    `,
  },
  {
    file: '09_learner_translations.csv',
    description: 'Every learner sense translation with headword and sense context.',
    query: `
      SELECT lst.id::text AS id,
        lst.learner_sense_id::text AS learner_sense_id,
        le.word_id::text AS word_id, w.word, ls.sense_key, ls.sense_order,
        ls.part_of_speech, ls.definition_en,
        lst.locale, lst.text, lst.text_normalized, lst.method,
        lst.source, lst.source_url, lst.source_license, lst.confidence,
        lst.review_status, lst.reviewed_by, lst.reviewed_at,
        lst.created_at, lst.updated_at
      FROM learner_sense_translations lst
      JOIN learner_senses ls ON ls.id = lst.learner_sense_id
      JOIN learner_entries le ON le.id = ls.learner_entry_id
      JOIN words w ON w.id = le.word_id
      ORDER BY le.learner_rank NULLS LAST, w.word, ls.sense_order, lst.locale, lst.id
    `,
  },
  {
    file: '10_learner_examples.csv',
    description: 'Every learner example with bilingual text, headword, and sense context.',
    query: `
      SELECT lex.id::text AS id,
        lex.learner_sense_id::text AS learner_sense_id,
        le.word_id::text AS word_id, w.word, ls.sense_key, ls.sense_order,
        ls.part_of_speech, ls.definition_en,
        lex.example_order, lex.source_example_id::text AS source_example_id,
        lex.example_en, lex.example_vi, lex.review_status,
        lex.source, lex.source_url, lex.source_license,
        lex.reviewed_by, lex.reviewed_at, lex.created_at, lex.updated_at
      FROM learner_examples lex
      JOIN learner_senses ls ON ls.id = lex.learner_sense_id
      JOIN learner_entries le ON le.id = ls.learner_entry_id
      JOIN words w ON w.id = le.word_id
      ORDER BY le.learner_rank NULLS LAST, w.word, ls.sense_order, lex.example_order, lex.id
    `,
  },
  {
    file: '11_learner_pronunciations.csv',
    description: 'Every reviewed/draft learner pronunciation with headword context.',
    query: `
      SELECT lp.id::text AS id,
        lp.learner_entry_id::text AS learner_entry_id,
        le.word_id::text AS word_id, w.word,
        lp.accent, lp.ipa, lp.priority, lp.source, lp.source_url,
        lp.source_license, lp.review_status, lp.reviewed_by,
        lp.reviewed_at, lp.created_at, lp.updated_at
      FROM learner_pronunciations lp
      JOIN learner_entries le ON le.id = lp.learner_entry_id
      JOIN words w ON w.id = le.word_id
      ORDER BY le.learner_rank NULLS LAST, w.word, lp.accent, lp.priority, lp.id
    `,
  },
  {
    file: '12_categories.csv',
    description: 'Every vocabulary category/topic, including hierarchy metadata.',
    query: `
      SELECT c.id::text AS id, c.name, c.display_name, c.description,
        c.icon, c.topic, c.display_order, c.parent_id::text AS parent_id,
        parent.name AS parent_name, c.created_at, c.updated_at
      FROM categories c
      LEFT JOIN categories parent ON parent.id = c.parent_id
      ORDER BY c.topic, c.display_order, c.id
    `,
  },
  {
    file: '13_category_words.csv',
    description: 'Every category-to-word membership with display ordering.',
    query: `
      SELECT cw.id::text AS id, cw.category_id::text AS category_id,
        c.name AS category_name, c.display_name AS category_display_name,
        c.topic, cw.word_id::text AS word_id, w.word,
        cw.display_order, cw.added_at
      FROM category_words cw
      JOIN categories c ON c.id = cw.category_id
      JOIN words w ON w.id = cw.word_id
      ORDER BY c.topic, c.display_order, c.id, cw.display_order, w.word, cw.id
    `,
  },
];

function databaseClient(): Client {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
  });
}

function normalizeCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }
  const text = String(value);
  // Prevent formula execution when a CSV is opened in Excel/Sheets. The
  // apostrophe is visible in raw CSV but treated as a text marker by sheets.
  return /^[\t ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  const text = normalizeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

async function writeChunk(
  stream: fs.WriteStream,
  hash: ReturnType<typeof createHash>,
  chunk: string,
): Promise<number> {
  const bytes = Buffer.byteLength(chunk);
  hash.update(chunk);
  if (!stream.write(chunk)) await once(stream, 'drain');
  return bytes;
}

async function closeStream(stream: fs.WriteStream): Promise<void> {
  stream.end();
  await once(stream, 'finish');
}

async function exportQuery(
  client: Client,
  spec: ExportSpec,
  index: number,
): Promise<ExportResult> {
  const cursorName = `word_export_${index}`;
  const filePath = path.join(outputDirectory, spec.file);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  const hash = createHash('sha256');
  let rowCount = 0;
  let byteCount = 0;
  let columns: string[] | null = null;

  await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${spec.query}`);
  try {
    while (true) {
      const result: QueryResult = await client.query(
        `FETCH FORWARD ${pageSize} FROM ${cursorName}`,
      );
      if (!columns) {
        columns = result.fields.map((field) => field.name);
        byteCount += await writeChunk(
          stream,
          hash,
          `\uFEFF${csvRow(columns)}`,
        );
      }
      if (!result.rows.length) break;

      const chunks: string[] = [];
      for (const row of result.rows) {
        chunks.push(csvRow(columns.map((column) => row[column])));
      }
      const chunk = chunks.join('');
      byteCount += await writeChunk(stream, hash, chunk);
      rowCount += result.rows.length;
      process.stdout.write(`\r${spec.file}: ${rowCount.toLocaleString()} rows`);
    }
  } finally {
    await client.query(`CLOSE ${cursorName}`).catch(() => undefined);
    await closeStream(stream);
  }
  process.stdout.write('\n');

  return {
    file: spec.file,
    rows: rowCount,
    bytes: byteCount,
    sha256: hash.digest('hex'),
    description: spec.description,
  };
}

function writeManifest(results: ExportResult[], generatedAt: string): void {
  const manifestRows = [
    ['file', 'rows', 'bytes', 'sha256', 'description'],
    ...results.map((result) => [
      result.file,
      result.rows,
      result.bytes,
      result.sha256,
      result.description,
    ]),
  ];
  fs.writeFileSync(
    path.join(outputDirectory, '00_manifest.csv'),
    `\uFEFF${manifestRows.map(csvRow).join('')}`,
    'utf8',
  );

  const totalRows = results.reduce((sum, result) => sum + result.rows, 0);
  const totalBytes = results.reduce((sum, result) => sum + result.bytes, 0);
  fs.writeFileSync(
    path.join(outputDirectory, 'README.md'),
    `# DSD English word-data export\n\n` +
      `Generated: ${generatedAt}\n\n` +
      `This is a read-only, repeatable-read snapshot of dictionary and ` +
      `curriculum tables. It excludes users, saved-word lists, lookup history, ` +
      `authentication data, and review progress.\n\n` +
      `Start with \`01_dictionary_review.csv\` for meanings/definitions and ` +
      `\`02_examples_review.csv\` for bilingual examples. The remaining files ` +
      `preserve related normalized tables.\n\n` +
      `Empty CSV files still include their headers and mean that the source ` +
      `table had no rows in this snapshot. Files with more than 1,048,575 ` +
      `data rows exceed Excel's per-sheet row limit; filter or split those ` +
      `files before opening them in Excel.\n\n` +
      `Total exported data rows: ${totalRows.toLocaleString()}\n\n` +
      `Total uncompressed CSV bytes: ${totalBytes.toLocaleString()}\n\n` +
      `All CSV files are UTF-8 with a BOM for Vietnamese compatibility. ` +
      `Cells beginning with spreadsheet formula characters are prefixed with ` +
      `an apostrophe to prevent formula injection. Row totals and SHA-256 ` +
      `checksums are recorded in \`00_manifest.csv\`.\n`,
    'utf8',
  );
}

async function main(): Promise<void> {
  if (fs.existsSync(outputDirectory) && fs.readdirSync(outputDirectory).length) {
    throw new Error(`Refusing to overwrite non-empty output directory: ${outputDirectory}`);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });

  const client = databaseClient();
  await client.connect();
  const results: ExportResult[] = [];
  const generatedAt = new Date().toISOString();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '0'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '0'");

    for (let index = 0; index < exportsToCreate.length; index += 1) {
      results.push(await exportQuery(client, exportsToCreate[index], index + 1));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  writeManifest(results, generatedAt);
  console.log(`Word data exported to ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
