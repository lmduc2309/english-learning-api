import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Client } from 'pg';

dotenv.config();

const outputArg = process.argv.indexOf('--output');
const output = path.resolve(
  outputArg >= 0 && process.argv[outputArg + 1]
    ? process.argv[outputArg + 1]
    : `reports/commercial-data-${new Date().toISOString().slice(0, 10)}`,
);

if (fs.existsSync(output)) {
  throw new Error(`Refusing to overwrite existing export directory: ${output}`);
}

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME || 'dictionary_user',
  password: process.env.DB_PASSWORD || 'dictionary_pass',
  database: process.env.DB_DATABASE || 'english_learning_db',
});

const registry = JSON.parse(
  fs.readFileSync(path.resolve('data/commercial-source-registry.json'), 'utf8'),
) as {
  sources: Array<{
    canonical_name: string;
    aliases: string[];
    scope: string[];
    commercial_status: string;
  }>;
};
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');
const approvedByScope = new Map<string, Set<string>>();
for (const source of registry.sources.filter((row) => row.commercial_status === 'approved')) {
  for (const scope of source.scope) {
    const names = approvedByScope.get(scope) ?? new Set<string>();
    names.add(normalize(source.canonical_name));
    source.aliases.forEach((alias) => names.add(normalize(alias)));
    approvedByScope.set(scope, names);
  }
}

const specs = [
  {
    file: '01_learner_entries.csv',
    query: `SELECT le.id, le.word_id, w.word, le.learner_rank, le.learner_band,
      le.rank_source, le.rank_source_version, le.rank_source_url,
      le.rank_source_license, le.status
      FROM learner_entries le JOIN words w ON w.id=le.word_id
      WHERE le.status='published'
      ORDER BY le.learner_rank NULLS LAST, w.word, le.id`,
  },
  {
    file: '02_learner_senses.csv',
    query: `SELECT s.id, s.learner_entry_id, s.sense_key, s.sense_order,
      s.part_of_speech, s.definition_en, s.cefr_level, s.cefr_source,
      s.cefr_source_url, s.cefr_source_version, s.cefr_source_license,
      s.cefr_basis, s.definition_source, s.definition_source_url,
      s.definition_source_license, s.definition_source_version,
      s.definition_source_artifact_sha256, s.reviewed_by, s.reviewed_at
      FROM learner_senses s JOIN learner_entries le ON le.id=s.learner_entry_id
      WHERE s.status='published' AND le.status='published'
        AND EXISTS (SELECT 1 FROM learner_sense_translations t
          WHERE t.learner_sense_id=s.id AND lower(t.locale)='vi'
            AND t.review_status='approved')
      ORDER BY s.learner_entry_id, s.sense_order, s.id`,
  },
  {
    file: '03_learner_translations.csv',
    query: `SELECT t.id, t.learner_sense_id, t.locale, t.text, t.method,
      t.source, t.source_url, t.source_license, t.confidence,
      t.reviewed_by, t.reviewed_at
      FROM learner_sense_translations t
      JOIN learner_senses s ON s.id=t.learner_sense_id
      JOIN learner_entries le ON le.id=s.learner_entry_id
      WHERE t.review_status='approved' AND s.status='published'
        AND le.status='published'
      ORDER BY t.learner_sense_id, t.locale, t.id`,
  },
  {
    file: '04_learner_examples.csv',
    query: `SELECT e.id, e.learner_sense_id, e.example_order, e.example_en,
      e.example_vi, e.source, e.source_url, e.source_license,
      e.reviewed_by, e.reviewed_at
      FROM learner_examples e
      JOIN learner_senses s ON s.id=e.learner_sense_id
      JOIN learner_entries le ON le.id=s.learner_entry_id
      WHERE e.review_status='approved' AND s.status='published'
        AND le.status='published'
      ORDER BY e.learner_sense_id, e.example_order, e.id`,
  },
  {
    file: '05_learner_pronunciations.csv',
    query: `SELECT p.id, p.learner_entry_id, p.accent, p.ipa, p.priority,
      p.source, p.source_url, p.source_license, p.reviewed_by, p.reviewed_at
      FROM learner_pronunciations p
      JOIN learner_entries le ON le.id=p.learner_entry_id
      WHERE p.review_status='approved' AND le.status='published'
      ORDER BY p.learner_entry_id, p.accent, p.priority, p.id`,
  },
];

function csvCell(value: unknown): string {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  if (process.env.COMMERCIAL_SAFE_MODE !== 'true') {
    throw new Error('Commercial export blocked: COMMERCIAL_SAFE_MODE must be exactly true');
  }
  if (process.env.COMMERCIAL_ALLOW_GENERATED_CONTENT === 'true') {
    throw new Error('Commercial export blocked: generated content is enabled');
  }
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const countResult = await client.query<{ count: string }>(
      `SELECT count(*) FROM learner_entries WHERE status='published'`,
    );
    if (Number(countResult.rows[0].count) === 0) {
      throw new Error('Commercial export blocked: there are no published learner entries');
    }

    const sourceQueries: Array<[string, string]> = [
      ['definition', `SELECT DISTINCT definition_source source FROM learner_senses WHERE status='published'`],
      ['rank', `SELECT DISTINCT rank_source source FROM learner_entries WHERE status='published' AND learner_rank IS NOT NULL`],
      ['translation', `SELECT DISTINCT source FROM learner_sense_translations WHERE review_status='approved'`],
      ['example', `SELECT DISTINCT source FROM learner_examples WHERE review_status='approved'`],
      ['pronunciation', `SELECT DISTINCT source FROM learner_pronunciations WHERE review_status='approved'`],
    ];
    for (const [scope, query] of sourceQueries) {
      const sources = await client.query<{ source: string }>(query);
      for (const row of sources.rows) {
        if (!approvedByScope.get(scope)?.has(normalize(row.source))) {
          throw new Error(
            `Commercial export blocked: ${scope} source is not approved: ${row.source}`,
          );
        }
      }
    }

    fs.mkdirSync(output, { recursive: false });
    const manifest: Array<{ file: string; rows: number; bytes: number; sha256: string }> = [];
    for (const spec of specs) {
      const result = await client.query(spec.query);
      const columns = result.fields.map((field) => field.name);
      const csv = `\uFEFF${columns.map(csvCell).join(',')}\n${result.rows
        .map((row) => columns.map((column) => csvCell(row[column])).join(','))
        .join('\n')}${result.rows.length ? '\n' : ''}`;
      const bytes = Buffer.from(csv, 'utf8');
      fs.writeFileSync(path.join(output, spec.file), bytes);
      manifest.push({
        file: spec.file,
        rows: result.rows.length,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    for (const [file, target] of [
      ['DATA-LICENSES.md', 'DATA-LICENSES.md'],
      ['data/commercial-source-registry.json', 'commercial-source-registry.json'],
      ['data/learner-core/NOTICE.md', 'THIRD-PARTY-NOTICES.md'],
      ['data/learner-core/licenses/oewn-2025/LICENSE.md', 'OEWN-LICENSE.md'],
      ['data/learner-core/licenses/oewn-2025/WNDB_License.txt', 'WORDNET-LICENSE.txt'],
    ]) {
      fs.copyFileSync(path.resolve(file), path.join(output, target));
    }
    fs.writeFileSync(
      path.join(output, '00_manifest.json'),
      `${JSON.stringify({ generated_at: new Date().toISOString(), files: manifest }, null, 2)}\n`,
    );
    await client.query('COMMIT');
    console.log(`Commercial-safe data exported to ${output}`);
  } catch (error) {
    await client.query('ROLLBACK');
    if (fs.existsSync(output)) {
      console.error(`Incomplete export left at ${output}; inspect before removing it`);
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => client.end());
