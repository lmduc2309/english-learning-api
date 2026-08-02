/**
 * Exports the human-review queues produced by the corpus cleanup as CSV.
 *
 *   reports/review-queues-<date>/example-vi-conflicts.csv
 *   reports/review-queues-<date>/vi-echoes.csv
 *
 * These are the files a bilingual reviewer actually works from. Neither table
 * is a rollback snapshot — both are retained findings awaiting a decision.
 *
 * USAGE:
 *   npm run export-review-queues
 *   npm run export-review-queues -- --output ../review-queues
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
// Word has a OneToOne to LearnerEntry and that graph reaches the rest of the
// overlay. Omitting any of them fails with "Entity metadata for
// Word#learnerEntry was not found" before a single query runs.
import { LearnerEntry } from '../src/dictionary/entities/learner-entry.entity';
import { LearnerSense } from '../src/dictionary/entities/learner-sense.entity';
import { LearnerSenseTranslation } from '../src/dictionary/entities/learner-sense-translation.entity';
import { LearnerExample } from '../src/dictionary/entities/learner-example.entity';
import { LearnerPronunciation } from '../src/dictionary/entities/learner-pronunciation.entity';

dotenv.config();

export interface ConflictGroup {
  definition_id: number;
  example_en_digest: string;
  example_ids: number[];
  variant_count: number;
}

export interface ExampleText {
  example_en: string;
  example_vi: string | null;
}

export interface ConflictRow {
  group_key: string;
  definition_id: number;
  example_id: number;
  example_en: string;
  example_vi: string | null;
  variant_count: number;
  reviewer_decision: string;
}

export interface EchoRecord {
  table_name: string;
  row_id: number;
  kind: string;
  english: string | null;
  vietnamese: string | null;
}

export interface EchoRow extends EchoRecord {
  reviewer_decision: string;
}

/** Quote every value, double internal quotes, and neutralise formula prefixes. */
export function toCsvCell(value: string | null | undefined): string {
  const raw = value ?? '';
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function buildConflictRows(
  groups: ConflictGroup[],
  examplesById: Map<number, ExampleText>,
): ConflictRow[] {
  const rows: ConflictRow[] = [];
  for (const group of groups) {
    const groupKey = `${group.definition_id}:${group.example_en_digest}`;
    for (const rawId of group.example_ids) {
      // node-postgres returns bigint and bigint[] as strings, because a bigint
      // does not fit a JS number safely. Coercing here rather than at the call
      // site keeps the function correct whatever the driver hands back —
      // without it every lookup misses and the queue exports empty.
      const id = Number(rawId);
      const example = examplesById.get(id);
      // A missing id means the example was removed after the report was built.
      // Emitting a blank row would look like missing content rather than a
      // stale report, so skip it.
      if (!example) continue;
      rows.push({
        group_key: groupKey,
        definition_id: group.definition_id,
        example_id: id,
        example_en: example.example_en,
        example_vi: example.example_vi,
        variant_count: group.variant_count,
        reviewer_decision: '',
      });
    }
  }
  return rows;
}

export function buildEchoRows(records: EchoRecord[]): EchoRow[] {
  return records.map((record) => ({ ...record, reviewer_decision: '' }));
}

function writeCsv(
  file: string,
  headers: string[],
  rows: ReadonlyArray<Record<string, unknown>> | ReadonlyArray<object>,
): void {
  const lines = [headers.map(toCsvCell).join(',')];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(
      headers
        .map((h) => toCsvCell(record[h] === null || record[h] === undefined ? '' : String(record[h])))
        .join(','),
    );
  }
  // BOM so Excel reads the Vietnamese correctly.
  fs.writeFileSync(file, '﻿' + lines.join('\n') + '\n', 'utf8');
}

function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [
      Word, Definition, Example, Pronunciation, WordForm, Synonym,
      LearnerEntry, LearnerSense, LearnerSenseTranslation,
      LearnerExample, LearnerPronunciation,
    ],
    synchronize: false,
    logging: false,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outputIndex = argv.indexOf('--output');
  const dateStamp = new Date().toISOString().slice(0, 10);
  const outputDir = path.resolve(
    process.cwd(),
    outputIndex >= 0 && argv[outputIndex + 1]
      ? argv[outputIndex + 1]
      : `reports/review-queues-${dateStamp}`,
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const ds = createDataSource();
  await ds.initialize();
  try {
    const groups: ConflictGroup[] = await ds.query(
      `SELECT "definition_id", "example_en_digest", "example_ids", "variant_count"
         FROM "cleanup_review_example_vi_conflicts"
        ORDER BY "definition_id", "example_en_digest"`,
    );

    const ids = groups.flatMap((g) => g.example_ids);
    const examples: Array<{ id: number } & ExampleText> = ids.length
      ? await ds.query(
          `SELECT "id", "example_en", "example_vi" FROM "examples" WHERE "id" = ANY($1::bigint[])`,
          [ids],
        )
      : [];
    const byId = new Map<number, ExampleText>(
      examples.map((e) => [Number(e.id), { example_en: e.example_en, example_vi: e.example_vi }]),
    );

    const conflictRows = buildConflictRows(groups, byId);
    writeCsv(
      path.join(outputDir, 'example-vi-conflicts.csv'),
      ['group_key', 'definition_id', 'example_id', 'example_en', 'example_vi', 'variant_count', 'reviewer_decision'],
      conflictRows,
    );

    const echoes: EchoRecord[] = await ds.query(
      `SELECT "table_name", "row_id", "kind", "english", "vietnamese"
         FROM "cleanup_review_vi_echoes"
        ORDER BY "kind", "table_name", "row_id"`,
    );
    const echoRows = buildEchoRows(echoes);
    writeCsv(
      path.join(outputDir, 'vi-echoes.csv'),
      ['kind', 'table_name', 'row_id', 'english', 'vietnamese', 'reviewer_decision'],
      echoRows,
    );

    const dropped = ids.length - conflictRows.length;
    console.log(`Wrote ${outputDir}`);
    console.log(`  example-vi-conflicts.csv  ${groups.length} groups, ${conflictRows.length} rows`);
    if (dropped > 0) {
      console.log(`    (${dropped} id(s) skipped: no longer present in examples)`);
    }
    console.log(`  vi-echoes.csv             ${echoRows.length} rows`);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
