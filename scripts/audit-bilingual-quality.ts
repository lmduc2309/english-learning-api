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
import { LearnerEntry } from '../src/dictionary/entities/learner-entry.entity';
import { LearnerSense } from '../src/dictionary/entities/learner-sense.entity';
import { LearnerSenseTranslation } from '../src/dictionary/entities/learner-sense-translation.entity';
import { LearnerExample } from '../src/dictionary/entities/learner-example.entity';
import { LearnerPronunciation } from '../src/dictionary/entities/learner-pronunciation.entity';

dotenv.config();

const OUTPUT_DIR = path.resolve(
  process.cwd(),
  process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : 'reports/bilingual-audit-2026-07-20',
);

const focusWords = [
  'be', 'have', 'do', 'get', 'go', 'make', 'take', 'come', 'see', 'know',
  'think', 'look', 'want', 'give', 'use', 'find', 'tell', 'ask', 'work', 'seem',
  'study', 'learn', 'language', 'meaning', 'definition', 'love', 'home', 'hard',
  'right', 'run', 'set', 'light', 'book', 'present', 'record', 'close', 'live',
];

function dataSource() {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [
      Word,
      Definition,
      Example,
      Pronunciation,
      WordForm,
      Synonym,
      LearnerEntry,
      LearnerSense,
      LearnerSenseTranslation,
      LearnerExample,
      LearnerPronunciation,
    ],
    synchronize: false,
    logging: false,
  });
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value).replace(/\r?\n/g, ' ');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const body = [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
  fs.writeFileSync(path.join(OUTPUT_DIR, name), `${body.join('\n')}\n`);
}

async function count(ds: DataSource, sql: string): Promise<number> {
  const row = (await ds.query(sql))[0];
  return Number(row.count ?? Object.values(row)[0]);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ds = dataSource();
  await ds.initialize();

  const metrics: Array<{ metric: string; value: number; note: string }> = [];
  const add = async (metric: string, sql: string, note: string) => {
    metrics.push({ metric, value: await count(ds, sql), note });
  };

  await add('words_total', 'SELECT count(*) FROM words', 'All headwords in the audited database snapshot');
  await add('definitions_total', 'SELECT count(*) FROM definitions', 'All English senses');
  await add('examples_total', 'SELECT count(*) FROM examples', 'All bilingual example rows');
  await add('pronunciations_total', 'SELECT count(*) FROM pronunciations', 'All pronunciation rows');
  await add('words_without_definitions', 'SELECT count(*) FROM words w WHERE NOT EXISTS (SELECT 1 FROM definitions d WHERE d.word_id=w.id)', 'Unusable dictionary entries');
  await add('words_without_pronunciation', 'SELECT count(*) FROM words w WHERE NOT EXISTS (SELECT 1 FROM pronunciations p WHERE p.word_id=w.id)', 'No IPA/accent row');
  await add('words_without_frequency_rank', 'SELECT count(*) FROM words WHERE frequency_rank IS NULL', 'Cannot reliably order learning priority');
  await add('definitions_missing_vi', "SELECT count(*) FROM definitions WHERE definition_vi IS NULL OR definition_vi !~ '\\S'", 'Missing or blank Vietnamese');
  await add('examples_missing_vi', "SELECT count(*) FROM examples WHERE example_en IS NOT NULL AND (example_vi IS NULL OR example_vi !~ '\\S')", 'Missing or blank Vietnamese');
  await add('definitions_vi_contains_cjk', "SELECT count(*) FROM definitions WHERE quality_flags @> ARRAY['vi_contains_cjk']::text[]", 'CJK script/punctuation/full-width contamination in the Vietnamese field');
  await add('examples_vi_contains_cjk', "SELECT count(*) FROM examples WHERE quality_flags @> ARRAY['vi_contains_cjk']::text[]", 'CJK script/punctuation/full-width contamination in the Vietnamese field');
  await add('definitions_vi_equals_en', "SELECT count(*) FROM definitions WHERE lower(trim(definition_vi))=lower(trim(definition_en))", 'Likely untranslated fallback');
  await add('examples_vi_equals_en', "SELECT count(*) FROM examples WHERE lower(trim(example_vi))=lower(trim(example_en))", 'Likely untranslated fallback');
  await add('duplicate_definitions', `SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM definitions GROUP BY word_id, part_of_speech, lower(trim(definition_en)) HAVING count(*)>1) x`, 'Duplicate senses beyond first copy');
  await add('duplicate_examples', `SELECT coalesce(sum(c-1),0) FROM (SELECT count(*) c FROM examples GROUP BY definition_id, lower(trim(example_en)) HAVING count(*)>1) x`, 'Duplicate examples beyond first copy');
  await add('definitions_raw_markup', "SELECT count(*) FROM definitions WHERE definition_en ~ '\\([^)]*\\|[^)]*\\)' OR definition_en ILIKE '%thumb|%' OR definition_en ~ '<[^>]+>'", 'Raw Wiktionary/template/HTML markup');
  await add('definitions_over_400_chars', 'SELECT count(*) FROM definitions WHERE length(definition_en)>400', 'Too long for concise learner definitions');
  await add('examples_over_300_chars', 'SELECT count(*) FROM examples WHERE length(example_en)>300', 'Likely literary, noisy, or multi-sentence example');
  await add('non_lexical_headwords', "SELECT count(*) FROM words WHERE word !~ '^[A-Za-z][A-Za-z ''’.-]*$'", 'Symbols, markup, numbers, or non-Latin headwords');
  await add('definitions_flagged', 'SELECT count(*) FROM definitions WHERE cardinality(quality_flags)>0', 'Rows carrying one or more persisted quality flags');
  await add('legacy_definitions_reference_only', 'SELECT count(*) FROM definitions WHERE is_learner_visible=false', 'Legacy raw rows correctly excluded from trusted learner content');
  await add('legacy_definitions_learner_visible', 'SELECT count(*) FROM definitions WHERE is_learner_visible=true', 'Critical invariant: expected zero; reviewed content belongs in learner_senses');
  await add('examples_flagged', 'SELECT count(*) FROM examples WHERE cardinality(quality_flags)>0', 'Rows carrying one or more persisted quality flags');
  await add('legacy_examples_reference_only', 'SELECT count(*) FROM examples WHERE is_learner_visible=false', 'Legacy raw examples correctly excluded from trusted learner content');
  await add('legacy_examples_learner_visible', 'SELECT count(*) FROM examples WHERE is_learner_visible=true', 'Critical invariant: expected zero; reviewed content belongs in learner_examples');

  await add('learner_entries_total', 'SELECT count(*) FROM learner_entries', 'Normalized learner-overlay headwords in any workflow state');
  await add('learner_entries_published', "SELECT count(*) FROM learner_entries WHERE status='published'", 'Headwords eligible for learner presentation when they contain publishable senses');
  await add('learner_senses_total', 'SELECT count(*) FROM learner_senses', 'Normalized sense-level curation records in any workflow state');
  await add('learner_senses_published', "SELECT count(*) FROM learner_senses WHERE status='published'", 'Reviewed learner senses eligible for presentation');
  await add('learner_vi_translations_approved', "SELECT count(*) FROM learner_sense_translations WHERE lower(locale)='vi' AND review_status='approved'", 'Independently approved Vietnamese sense translations');
  await add('learner_examples_approved', "SELECT count(*) FROM learner_examples WHERE review_status='approved'", 'Independently approved bilingual learner examples');
  await add('learner_pronunciations_approved', "SELECT count(*) FROM learner_pronunciations WHERE review_status='approved'", 'Reviewed learner pronunciations');
  await add('published_senses_missing_approved_vi', `
    SELECT count(*) FROM learner_senses ls
    JOIN learner_entries le ON le.id=ls.learner_entry_id
    WHERE le.status='published' AND ls.status='published'
      AND NOT EXISTS (
        SELECT 1 FROM learner_sense_translations lst
        WHERE lst.learner_sense_id=ls.id
          AND lower(lst.locale)='vi'
          AND lst.review_status='approved'
      )`, 'Critical publication invariant: expected zero');
  await add('published_entries_without_published_sense', `
    SELECT count(*) FROM learner_entries le
    WHERE le.status='published'
      AND NOT EXISTS (
        SELECT 1 FROM learner_senses ls
        WHERE ls.learner_entry_id=le.id AND ls.status='published'
      )`, 'Critical publication invariant: expected zero');

  writeCsv('summary.csv', metrics);

  const issueSql = `
    SELECT * FROM (
      SELECT 'definition_vi_cjk' issue, w.word, d.part_of_speech pos, d.definition_en english, d.definition_vi vietnamese, d.id::text row_id
      FROM definitions d JOIN words w ON w.id=d.word_id
      WHERE d.quality_flags @> ARRAY['vi_contains_cjk']::text[]
      LIMIT 500
    ) a
    UNION ALL
    SELECT * FROM (
      SELECT 'definition_raw_markup', w.word, d.part_of_speech, d.definition_en, d.definition_vi, d.id::text
      FROM definitions d JOIN words w ON w.id=d.word_id
      WHERE d.definition_en ~ '\\([^)]*\\|[^)]*\\)' OR d.definition_en ILIKE '%thumb|%' OR d.definition_en ~ '<[^>]+>'
      LIMIT 500
    ) b
    UNION ALL
    SELECT * FROM (
      SELECT 'definition_vi_equals_en', w.word, d.part_of_speech, d.definition_en, d.definition_vi, d.id::text
      FROM definitions d JOIN words w ON w.id=d.word_id
      WHERE lower(trim(d.definition_vi))=lower(trim(d.definition_en))
      LIMIT 500
    ) c
    UNION ALL
    SELECT * FROM (
      SELECT 'definition_duplicate', w.word, d.part_of_speech, d.definition_en, d.definition_vi, d.id::text
      FROM definitions d JOIN words w ON w.id=d.word_id
      WHERE EXISTS (SELECT 1 FROM definitions d2 WHERE d2.word_id=d.word_id AND d2.id<d.id AND d2.part_of_speech=d.part_of_speech AND lower(trim(d2.definition_en))=lower(trim(d.definition_en)))
      LIMIT 500
    ) d`;
  writeCsv('flagged_definitions.csv', await ds.query(issueSql));

  const examples = await ds.query(`
    SELECT w.word, d.part_of_speech pos, e.id::text row_id, e.example_en english, e.example_vi vietnamese,
      concat_ws(';',
        CASE WHEN e.example_vi IS NULL OR e.example_vi !~ '\\S' THEN 'missing_vi' END,
        CASE WHEN e.quality_flags @> ARRAY['vi_contains_cjk']::text[] THEN 'vi_cjk' END,
        CASE WHEN lower(trim(e.example_vi))=lower(trim(e.example_en)) THEN 'vi_equals_en' END,
        CASE WHEN length(e.example_en)>300 THEN 'too_long' END
      ) issue
    FROM examples e JOIN definitions d ON d.id=e.definition_id JOIN words w ON w.id=d.word_id
    WHERE e.example_vi IS NULL OR e.example_vi !~ '\\S' OR e.quality_flags @> ARRAY['vi_contains_cjk']::text[]
       OR lower(trim(e.example_vi))=lower(trim(e.example_en)) OR length(e.example_en)>300
    ORDER BY w.word, e.id
    LIMIT 3000`);
  writeCsv('flagged_examples.csv', examples);

  const focus = await ds.query(`
    SELECT w.word, w.frequency_rank, d.definition_order, d.part_of_speech pos, d.level,
      d.definition_en, d.definition_vi,
      (SELECT string_agg(p.accent || ':' || p.ipa, ' | ' ORDER BY p.accent) FROM pronunciations p WHERE p.word_id=w.id) pronunciations,
      (SELECT e.example_en FROM examples e WHERE e.definition_id=d.id ORDER BY e.id LIMIT 1) example_en,
      (SELECT e.example_vi FROM examples e WHERE e.definition_id=d.id ORDER BY e.id LIMIT 1) example_vi
    FROM words w JOIN definitions d ON d.word_id=w.id
    WHERE lower(w.word)=ANY($1)
    ORDER BY array_position($1, lower(w.word)), d.definition_order, d.id`,
    [focusWords],
  );
  writeCsv('focus_words.csv', focus);

  const distributions = await ds.query(`
    SELECT 'part_of_speech' dimension, part_of_speech value, count(*)::int count FROM definitions GROUP BY part_of_speech
    UNION ALL SELECT 'level', level, count(*)::int FROM definitions GROUP BY level
    UNION ALL SELECT 'pronunciation_accent', accent, count(*)::int FROM pronunciations GROUP BY accent
    UNION ALL SELECT 'definition_quality_flag', flag, count(*)::int FROM definitions CROSS JOIN LATERAL unnest(quality_flags) flag GROUP BY flag
    UNION ALL SELECT 'example_quality_flag', flag, count(*)::int FROM examples CROSS JOIN LATERAL unnest(quality_flags) flag GROUP BY flag
    UNION ALL SELECT 'definition_review_status', review_status, count(*)::int FROM definitions GROUP BY review_status
    UNION ALL SELECT 'example_review_status', review_status, count(*)::int FROM examples GROUP BY review_status
    UNION ALL SELECT 'learner_entry_status', status, count(*)::int FROM learner_entries GROUP BY status
    UNION ALL SELECT 'learner_sense_status', status, count(*)::int FROM learner_senses GROUP BY status
    UNION ALL SELECT 'learner_sense_cefr', coalesce(cefr_level, 'unassigned'), count(*)::int FROM learner_senses GROUP BY cefr_level
    UNION ALL SELECT 'learner_translation_status', review_status, count(*)::int FROM learner_sense_translations GROUP BY review_status
    UNION ALL SELECT 'learner_example_status', review_status, count(*)::int FROM learner_examples GROUP BY review_status
    UNION ALL SELECT 'learner_pronunciation_status', review_status, count(*)::int FROM learner_pronunciations GROUP BY review_status
    ORDER BY dimension, count DESC`);
  writeCsv('distributions.csv', distributions);

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), metrics }, null, 2));
  await ds.destroy();
  console.log(`Bilingual audit exported to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
