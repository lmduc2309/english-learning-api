import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from 'redis';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { definitionQualityFlags, exampleQualityFlags, isUnsafeVietnamese } from '../src/dictionary/dictionary-quality';
import { LearnerEntry } from '../src/dictionary/entities/learner-entry.entity';
import { LearnerExample } from '../src/dictionary/entities/learner-example.entity';
import { LearnerPronunciation } from '../src/dictionary/entities/learner-pronunciation.entity';
import { LearnerSenseTranslation } from '../src/dictionary/entities/learner-sense-translation.entity';
import { LearnerSense } from '../src/dictionary/entities/learner-sense.entity';
import { Word } from '../src/dictionary/entities/word.entity';
import { renderCurationReviewWorksheet } from './lib/curation-review';
import { validateDefinitionProvenance } from './lib/learner-definition-provenance';
import { normalizeVietnameseSearch } from '../src/dictionary/vietnamese-gloss-search';

dotenv.config();

type PublicationStatus = 'draft' | 'published' | 'retired';
type ReviewStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

interface CurationExampleInput {
  example_order?: number;
  source_example_id?: number;
  en: string;
  vi: string;
  review_status?: ReviewStatus;
  source: string;
  source_url?: string;
  source_license: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

interface CurationPronunciationInput {
  accent: string;
  ipa: string;
  priority?: number;
  review_status?: ReviewStatus;
  source: string;
  source_url?: string;
  source_license: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

interface CurationRow {
  word: string;
  entry_status?: PublicationStatus;
  sense_order: number;
  source_definition_id?: number;
  sense_key: string;
  part_of_speech: string;
  definition_en: string;
  definition_vi: string;
  status?: PublicationStatus;
  usage_labels?: string[];
  cefr_level?: CefrLevel;
  cefr_source?: string;
  cefr_source_url?: string;
  cefr_source_version?: string;
  cefr_source_license?: string;
  cefr_basis?: string;
  cefr_confidence?: number;
  learner_rank?: number;
  learner_band?: string;
  rank_source?: string;
  rank_source_url?: string;
  rank_source_version?: string;
  rank_source_license?: string;
  definition_source?: string;
  definition_source_url?: string;
  definition_source_license?: string;
  definition_source_version?: string;
  definition_source_artifact_sha256?: string;
  translation_method: string;
  translation_source: string;
  translation_source_url?: string;
  translation_source_license: string;
  translation_confidence?: number;
  translation_review_status?: ReviewStatus;
  translation_reviewed_by?: string;
  translation_reviewed_at?: string;
  examples?: CurationExampleInput[];
  pronunciations?: CurationPronunciationInput[];
  review_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;

  // Temporary aliases accepted from the first P1 draft format.
  frequency_rank?: number;
  source?: string;
  source_url?: string;
  source_license?: string;
  ipa_us?: string;
  ipa_uk?: string;
}

interface WordGroup {
  normalizedWord: string;
  rows: CurationRow[];
}

const command = process.argv[2] || 'stats';
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'dictionary_user',
  password: process.env.DB_PASSWORD || 'dictionary_pass',
  database: process.env.DB_DATABASE || 'english_learning_db',
  entities: [path.resolve(process.cwd(), 'src/**/*.entity.ts')],
  synchronize: false,
  logging: false,
});

function normalizeWord(value: string): string {
  return (value || '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value: unknown): value is string {
  return isNonEmpty(value) && !Number.isNaN(Date.parse(value));
}

function inUnitInterval(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateMaxLength(at: string, field: string, value: unknown, max: number, errors: string[]) {
  if (isNonEmpty(value) && value.length > max) errors.push(`${at}: ${field} must be at most ${max} characters`);
}

function definitionSource(row: CurationRow): string | undefined {
  return row.definition_source || row.source;
}

function definitionSourceUrl(row: CurationRow): string | undefined {
  return row.definition_source_url || row.source_url;
}

function definitionSourceLicense(row: CurationRow): string | undefined {
  return row.definition_source_license || row.source_license;
}

function learnerRank(row: CurationRow): number | undefined {
  return row.learner_rank ?? row.frequency_rank;
}

function validateReview(
  at: string,
  status: ReviewStatus,
  reviewedBy: string | undefined,
  reviewedAt: string | undefined,
  errors: string[],
) {
  if (status !== 'approved') return;
  if (!isNonEmpty(reviewedBy)) errors.push(`${at}: approved content requires reviewed_by`);
  if (!isValidDate(reviewedAt)) errors.push(`${at}: approved content requires a valid reviewed_at timestamp`);
}

function validateRow(row: CurationRow, index: number): string[] {
  const at = `row ${index + 1} (${row.word || 'missing word'})`;
  const errors: string[] = [];
  const status = row.status || 'draft';
  const translationStatus = row.translation_review_status || 'draft';

  if (!isNonEmpty(row.word)) errors.push(`${at}: word is required`);
  if (!Number.isInteger(row.sense_order) || row.sense_order < 1) {
    errors.push(`${at}: sense_order must be a positive integer`);
  }
  if (row.source_definition_id != null && (!Number.isInteger(row.source_definition_id) || row.source_definition_id < 1)) {
    errors.push(`${at}: source_definition_id must be a positive integer when supplied`);
  }
  if (!isNonEmpty(row.sense_key)) errors.push(`${at}: sense_key is required and must be stable within its source`);
  if (!isNonEmpty(row.part_of_speech)) errors.push(`${at}: part_of_speech is required`);
  if (!isNonEmpty(row.definition_en)) errors.push(`${at}: definition_en is required`);
  if (!isNonEmpty(row.definition_vi)) errors.push(`${at}: definition_vi is required`);
  if (!['draft', 'published', 'retired'].includes(status)) errors.push(`${at}: invalid status`);
  if (row.entry_status && !['draft', 'published', 'retired'].includes(row.entry_status)) {
    errors.push(`${at}: invalid entry_status`);
  }

  const flags = definitionQualityFlags(row.definition_en, row.definition_vi);
  if (isUnsafeVietnamese(flags)) errors.push(`${at}: unsafe Vietnamese (${flags.join(', ')})`);
  if (flags.includes('raw_markup') || flags.includes('empty_definition')) {
    errors.push(`${at}: unsafe English definition (${flags.join(', ')})`);
  }
  if (!isNonEmpty(definitionSource(row)) || !isNonEmpty(definitionSourceLicense(row))) {
    errors.push(`${at}: definition_source and definition_source_license are required`);
  }
  validateMaxLength(at, 'sense_key', row.sense_key, 255, errors);
  validateMaxLength(at, 'part_of_speech', row.part_of_speech, 50, errors);
  validateMaxLength(at, 'definition_source', definitionSource(row), 80, errors);
  validateMaxLength(at, 'definition_source_license', definitionSourceLicense(row), 80, errors);
  errors.push(...validateDefinitionProvenance({
    definitionSource: definitionSource(row),
    definitionSourceVersion: row.definition_source_version,
    definitionSourceArtifactSha256: row.definition_source_artifact_sha256,
  }, at));
  validateMaxLength(at, 'reviewed_by', row.reviewed_by, 255, errors);

  if (!isNonEmpty(row.translation_method)) errors.push(`${at}: translation_method is required`);
  if (!isNonEmpty(row.translation_source) || !isNonEmpty(row.translation_source_license)) {
    errors.push(`${at}: translation_source and translation_source_license are required`);
  }
  validateMaxLength(at, 'translation_method', row.translation_method, 40, errors);
  validateMaxLength(at, 'translation_source', row.translation_source, 80, errors);
  validateMaxLength(at, 'translation_source_license', row.translation_source_license, 80, errors);
  validateMaxLength(at, 'translation_reviewed_by', row.translation_reviewed_by, 255, errors);
  if (!['draft', 'in_review', 'approved', 'rejected'].includes(translationStatus)) {
    errors.push(`${at}: invalid translation_review_status`);
  }
  if (row.translation_confidence != null && !inUnitInterval(row.translation_confidence)) {
    errors.push(`${at}: translation_confidence must be between 0 and 1`);
  }
  validateReview(
    `${at} translation`,
    translationStatus,
    row.translation_reviewed_by,
    row.translation_reviewed_at,
    errors,
  );

  if (row.cefr_level && !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(row.cefr_level)) {
    errors.push(`${at}: invalid cefr_level`);
  }
  if (row.cefr_level && !isNonEmpty(row.cefr_source)) errors.push(`${at}: cefr_level requires cefr_source`);
  if (row.cefr_level && (
    !isNonEmpty(row.cefr_source_url)
    || !isNonEmpty(row.cefr_source_version)
    || !isNonEmpty(row.cefr_source_license)
    || !isNonEmpty(row.cefr_basis)
  )) {
    errors.push(`${at}: cefr_level requires cefr_source_url, cefr_source_version, cefr_source_license, and cefr_basis`);
  }
  if (row.cefr_confidence != null && !inUnitInterval(row.cefr_confidence)) {
    errors.push(`${at}: cefr_confidence must be between 0 and 1`);
  }
  validateMaxLength(at, 'cefr_source', row.cefr_source, 80, errors);
  validateMaxLength(at, 'cefr_source_version', row.cefr_source_version, 40, errors);
  validateMaxLength(at, 'cefr_source_license', row.cefr_source_license, 80, errors);
  validateMaxLength(at, 'cefr_basis', row.cefr_basis, 40, errors);
  if (row.usage_labels && (!Array.isArray(row.usage_labels) || row.usage_labels.some((label) => !isNonEmpty(label)))) {
    errors.push(`${at}: usage_labels must contain only non-empty strings`);
  }

  const rank = learnerRank(row);
  if (rank != null && (!Number.isInteger(rank) || rank < 1)) errors.push(`${at}: learner_rank must be a positive integer`);
  if ((rank != null || isNonEmpty(row.learner_band)) && (!isNonEmpty(row.rank_source) || !isNonEmpty(row.rank_source_version) || !isNonEmpty(row.rank_source_license))) {
    errors.push(`${at}: learner_rank or learner_band requires rank_source, rank_source_version, and rank_source_license`);
  }
  validateMaxLength(at, 'learner_band', row.learner_band, 24, errors);
  validateMaxLength(at, 'rank_source', row.rank_source, 80, errors);
  validateMaxLength(at, 'rank_source_version', row.rank_source_version, 40, errors);
  validateMaxLength(at, 'rank_source_license', row.rank_source_license, 80, errors);
  if (isNonEmpty(row.ipa_us) || isNonEmpty(row.ipa_uk)) {
    errors.push(`${at}: ipa_us/ipa_uk are deprecated; use pronunciations with independent source and review metadata`);
  }

  if (row.examples != null && !Array.isArray(row.examples)) errors.push(`${at}: examples must be an array`);
  const examples = Array.isArray(row.examples) ? row.examples : [];
  const exampleOrders = new Set<number>();
  for (const [exampleIndex, example] of examples.entries()) {
    const exampleAt = `${at} example ${exampleIndex + 1}`;
    if (!example || typeof example !== 'object' || Array.isArray(example)) {
      errors.push(`${exampleAt}: must be an object`);
      continue;
    }
    const exampleOrder = example.example_order ?? exampleIndex + 1;
    const reviewStatus = example.review_status || 'draft';
    if (!Number.isInteger(exampleOrder) || exampleOrder < 1) errors.push(`${exampleAt}: example_order must be a positive integer`);
    if (exampleOrders.has(exampleOrder)) errors.push(`${exampleAt}: duplicate example_order ${exampleOrder}`);
    exampleOrders.add(exampleOrder);
    if (example.source_example_id != null && (!Number.isInteger(example.source_example_id) || example.source_example_id < 1)) {
      errors.push(`${exampleAt}: source_example_id must be a positive integer when supplied`);
    }
    if (!isNonEmpty(example.en) || !isNonEmpty(example.vi)) errors.push(`${exampleAt}: en and vi are required`);
    const exampleFlags = exampleQualityFlags(example.en, example.vi);
    if (exampleFlags.length) errors.push(`${exampleAt}: quality flags ${exampleFlags.join(', ')}`);
    if (!isNonEmpty(example.source) || !isNonEmpty(example.source_license)) {
      errors.push(`${exampleAt}: source and source_license are required`);
    }
    validateMaxLength(exampleAt, 'source', example.source, 80, errors);
    validateMaxLength(exampleAt, 'source_license', example.source_license, 80, errors);
    validateMaxLength(exampleAt, 'reviewed_by', example.reviewed_by, 255, errors);
    if (!['draft', 'in_review', 'approved', 'rejected'].includes(reviewStatus)) {
      errors.push(`${exampleAt}: invalid review_status`);
    }
    validateReview(exampleAt, reviewStatus, example.reviewed_by, example.reviewed_at, errors);
  }

  if (row.pronunciations != null && !Array.isArray(row.pronunciations)) errors.push(`${at}: pronunciations must be an array`);
  const pronunciationKeys = new Set<string>();
  for (const [pronunciationIndex, pronunciation] of (Array.isArray(row.pronunciations) ? row.pronunciations : []).entries()) {
    const pronunciationAt = `${at} pronunciation ${pronunciationIndex + 1}`;
    if (!pronunciation || typeof pronunciation !== 'object' || Array.isArray(pronunciation)) {
      errors.push(`${pronunciationAt}: must be an object`);
      continue;
    }
    const priority = pronunciation.priority ?? 1;
    const reviewStatus = pronunciation.review_status || 'draft';
    const key = `${pronunciation.accent?.trim().toLowerCase()}:${priority}`;
    if (!isNonEmpty(pronunciation.accent)) errors.push(`${pronunciationAt}: accent is required`);
    if (!isNonEmpty(pronunciation.ipa)) errors.push(`${pronunciationAt}: ipa is required`);
    if (!Number.isInteger(priority) || priority < 1) errors.push(`${pronunciationAt}: priority must be a positive integer`);
    if (pronunciationKeys.has(key)) errors.push(`${pronunciationAt}: duplicate accent/priority ${key}`);
    pronunciationKeys.add(key);
    if (!isNonEmpty(pronunciation.source) || !isNonEmpty(pronunciation.source_license)) {
      errors.push(`${pronunciationAt}: source and source_license are required`);
    }
    validateMaxLength(pronunciationAt, 'accent', pronunciation.accent, 20, errors);
    validateMaxLength(pronunciationAt, 'source', pronunciation.source, 80, errors);
    validateMaxLength(pronunciationAt, 'source_license', pronunciation.source_license, 80, errors);
    validateMaxLength(pronunciationAt, 'reviewed_by', pronunciation.reviewed_by, 255, errors);
    if (!['draft', 'in_review', 'approved', 'rejected'].includes(reviewStatus)) {
      errors.push(`${pronunciationAt}: invalid review_status`);
    }
    validateReview(pronunciationAt, reviewStatus, pronunciation.reviewed_by, pronunciation.reviewed_at, errors);
  }

  if (status === 'published') {
    if (!isNonEmpty(row.reviewed_by)) errors.push(`${at}: published senses require reviewed_by`);
    if (!isValidDate(row.reviewed_at)) errors.push(`${at}: published senses require a valid reviewed_at timestamp`);
    if (translationStatus !== 'approved') errors.push(`${at}: published senses require an approved Vietnamese translation`);
    if (!examples.some((example) => example && typeof example === 'object' && example.review_status === 'approved')) {
      errors.push(`${at}: published senses require at least one approved bilingual example`);
    }
  }

  return errors;
}

function groupRows(rows: CurationRow[]): WordGroup[] {
  const groups = new Map<string, CurationRow[]>();
  for (const row of rows) {
    const key = normalizeWord(row.word);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.entries()].map(([normalizedWord, groupedRows]) => ({ normalizedWord, rows: groupedRows }));
}

function equalOptionalValues(values: unknown[]): boolean {
  const present = values.filter((value) => value != null);
  return present.length < 2 || present.every((value) => JSON.stringify(value) === JSON.stringify(present[0]));
}

function validateAcrossRows(rows: CurationRow[]): string[] {
  const errors: string[] = [];
  const seenSenseOrders = new Set<string>();
  const seenSenseKeys = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const word = normalizeWord(row.word);
    const orderKey = `${word}:${row.sense_order}`;
    const senseKey = `${word}:${row.sense_key?.trim()}`;
    if (seenSenseOrders.has(orderKey)) errors.push(`row ${index + 1} (${row.word}): duplicate word/sense_order in file`);
    if (seenSenseKeys.has(senseKey)) errors.push(`row ${index + 1} (${row.word}): duplicate word/sense_key in file`);
    seenSenseOrders.add(orderKey);
    seenSenseKeys.add(senseKey);
  }

  for (const group of groupRows(rows)) {
    const metadata: Array<[string, unknown[]]> = [
      ['entry_status', group.rows.map((row) => row.entry_status)],
      ['learner_rank', group.rows.map(learnerRank)],
      ['learner_band', group.rows.map((row) => row.learner_band)],
      ['rank_source', group.rows.map((row) => row.rank_source)],
      ['rank_source_url', group.rows.map((row) => row.rank_source_url)],
      ['rank_source_version', group.rows.map((row) => row.rank_source_version)],
      ['rank_source_license', group.rows.map((row) => row.rank_source_license)],
    ];
    for (const [field, values] of metadata) {
      if (!equalOptionalValues(values)) errors.push(`${group.normalizedWord}: conflicting ${field} values across senses`);
    }
    if (group.rows.some((row) => row.entry_status === 'published') && !group.rows.some((row) => row.status === 'published')) {
      errors.push(`${group.normalizedWord}: entry_status published requires at least one published sense in the same file`);
    }
    const pronunciations = new Map<string, string>();
    for (const row of group.rows) {
      for (const pronunciation of row.pronunciations || []) {
        const key = `${pronunciation.accent.trim().toLowerCase()}:${pronunciation.priority ?? 1}`;
        const value = JSON.stringify({
          ipa: pronunciation.ipa.trim(),
          reviewStatus: pronunciation.review_status || 'draft',
          source: pronunciation.source.trim(),
          sourceUrl: pronunciation.source_url?.trim() || null,
          sourceLicense: pronunciation.source_license.trim(),
          reviewedBy: pronunciation.reviewed_by?.trim() || null,
          reviewedAt: pronunciation.reviewed_at || null,
        });
        const existing = pronunciations.get(key);
        if (existing && existing !== value) {
          errors.push(`${group.normalizedWord}: conflicting entry-level pronunciation ${key} across senses`);
        }
        pronunciations.set(key, value);
      }
    }
  }
  return errors;
}

function readRows(): CurationRow[] {
  const file = arg('--file');
  if (!file) throw new Error('Use --file <curation.json>.');
  const resolved = path.resolve(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${resolved}: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Curation file must contain a JSON array.');
  if (!parsed.length) throw new Error('Curation file must contain at least one row.');
  const invalidRows = parsed.flatMap((row, index) => (
    row && typeof row === 'object' && !Array.isArray(row) ? [] : [`row ${index + 1}: must be an object`]
  ));
  if (invalidRows.length) throw new Error(`Curation validation failed:\n${invalidRows.join('\n')}`);
  const rows = parsed as CurationRow[];
  const errors = [
    ...rows.flatMap(validateRow),
    ...validateAcrossRows(rows),
  ];
  if (errors.length) throw new Error(`Curation validation failed:\n${errors.join('\n')}`);
  return rows;
}

async function invalidateWords(words: string[]) {
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const dictionaryKeys = [...new Set(words.map(normalizeWord))]
      .map((word) => `dict:word:${word}`);
    // Publishing a learner entry changes category/topic eligibility as well as
    // the dictionary response. Clear both learner and compatibility variants;
    // otherwise a previously cached empty learner catalog can survive for up
    // to an hour after a successful curation import.
    const catalogKeys = (
      await Promise.all([
        redis.keys('category:*'),
        redis.keys('topic:*'),
      ])
    ).flat();
    const keys = [...new Set([...dictionaryKeys, ...catalogKeys])];
    if (keys.length) await redis.unlink(keys);
    await redis.quit();
  } catch {
    if (redis.isOpen) await redis.quit();
    console.warn('Redis unavailable; restart API or clear dict:word:*, category:*, and topic:* before verifying published data.');
  }
}

async function findWords(repository: Repository<Word>, groups: WordGroup[]): Promise<Map<string, Word>> {
  const headwords = groups.map((group) => group.normalizedWord);
  const words = await repository
    .createQueryBuilder('word')
    .where('lower(word.word) IN (:...headwords)', { headwords })
    .orWhere('lower(word.word_normalized) IN (:...headwords)', { headwords })
    .getMany();
  const byHeadword = new Map<string, Word>();
  for (const word of words) {
    byHeadword.set(normalizeWord(word.word), word);
    byHeadword.set(normalizeWord(word.wordNormalized), word);
  }
  return byHeadword;
}

function firstDefined<T>(rows: CurationRow[], pick: (row: CurationRow) => T | undefined): T | undefined {
  for (const row of rows) {
    const value = pick(row);
    if (value != null) return value;
  }
  return undefined;
}

function desiredEntryStatus(rows: CurationRow[], existing?: string): PublicationStatus {
  const explicit = firstDefined(rows, (row) => row.entry_status);
  if (explicit === 'retired') return 'retired';
  if (explicit === 'published' || rows.some((row) => row.status === 'published')) return 'published';
  if (existing === 'published' || existing === 'retired') return existing;
  return explicit || 'draft';
}

function date(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

async function upsertEntry(manager: EntityManager, word: Word, rows: CurationRow[]): Promise<LearnerEntry> {
  const entries = manager.getRepository(LearnerEntry);
  const existing = await entries.findOne({ where: { wordId: word.id } });
  const rank = firstDefined(rows, learnerRank);
  const nextStatus = desiredEntryStatus(rows, existing?.status);
  if (existing?.status === 'published' && nextStatus === 'published' && !rows.some((row) => row.status === 'published')) {
    const incomingMetadata = [
      [rank, existing.learnerRank],
      [firstDefined(rows, (row) => row.learner_band), existing.learnerBand],
      [firstDefined(rows, (row) => row.rank_source), existing.rankSource],
      [firstDefined(rows, (row) => row.rank_source_url), existing.rankSourceUrl],
      [firstDefined(rows, (row) => row.rank_source_version), existing.rankSourceVersion],
      [firstDefined(rows, (row) => row.rank_source_license), existing.rankSourceLicense],
    ];
    if (incomingMetadata.some(([incoming, current]) => incoming != null && incoming !== current)) {
      throw new Error(`${word.word}: refusing to change published rank/band metadata from a draft-only batch`);
    }
  }
  const next = entries.create({
    ...existing,
    wordId: word.id,
    learnerRank: rank ?? existing?.learnerRank,
    learnerBand: firstDefined(rows, (row) => row.learner_band) ?? existing?.learnerBand,
    rankSource: firstDefined(rows, (row) => row.rank_source) ?? existing?.rankSource,
    rankSourceUrl: firstDefined(rows, (row) => row.rank_source_url) ?? existing?.rankSourceUrl,
    rankSourceVersion: firstDefined(rows, (row) => row.rank_source_version) ?? existing?.rankSourceVersion,
    rankSourceLicense: firstDefined(rows, (row) => row.rank_source_license) ?? existing?.rankSourceLicense,
    status: nextStatus,
  });
  return entries.save(next);
}

async function findExistingSense(
  repository: Repository<LearnerSense>,
  learnerEntryId: string,
  row: CurationRow,
): Promise<LearnerSense | null> {
  const [byKey, byOrder] = await Promise.all([
    repository.findOne({ where: { learnerEntryId, senseKey: row.sense_key } }),
    repository.findOne({ where: { learnerEntryId, senseOrder: row.sense_order } }),
  ]);
  if (byKey && byOrder && byKey.id !== byOrder.id) {
    throw new Error(`${row.word}: sense_key ${row.sense_key} and sense_order ${row.sense_order} identify different existing senses`);
  }
  if (byOrder?.senseKey && byOrder.senseKey !== row.sense_key) {
    throw new Error(`${row.word}: refusing to replace stable sense_key ${byOrder.senseKey} at sense_order ${row.sense_order}`);
  }
  return byKey || byOrder;
}

function guardApprovedOverwrite(kind: string, existingStatus: string | undefined, nextStatus: string) {
  if (existingStatus === 'approved' && (nextStatus === 'draft' || nextStatus === 'in_review')) {
    throw new Error(`${kind}: refusing to overwrite approved content with ${nextStatus} content; use approved or rejected explicitly`);
  }
}

async function upsertRow(manager: EntityManager, entry: LearnerEntry, row: CurationRow) {
  const senses = manager.getRepository(LearnerSense);
  const translations = manager.getRepository(LearnerSenseTranslation);
  const examples = manager.getRepository(LearnerExample);
  const pronunciations = manager.getRepository(LearnerPronunciation);
  const existingSense = await findExistingSense(senses, entry.id, row);
  const status = row.status || 'draft';
  if (existingSense?.status === 'published' && status === 'draft') {
    throw new Error(`${row.word} sense ${row.sense_order}: refusing to overwrite a published sense with a draft`);
  }

  const sense = await senses.save(senses.create({
    ...existingSense,
    learnerEntryId: entry.id,
    sourceDefinitionId: row.source_definition_id,
    senseKey: row.sense_key.trim(),
    senseOrder: row.sense_order,
    partOfSpeech: row.part_of_speech.trim(),
    definitionEn: row.definition_en.trim(),
    cefrLevel: row.cefr_level,
    cefrSource: row.cefr_source?.trim(),
    cefrSourceUrl: row.cefr_source_url?.trim(),
    cefrSourceVersion: row.cefr_source_version?.trim(),
    cefrSourceLicense: row.cefr_source_license?.trim(),
    cefrBasis: row.cefr_basis?.trim(),
    cefrConfidence: row.cefr_confidence,
    usageLabels: (row.usage_labels || []).map((label) => label.trim()),
    status,
    definitionSource: definitionSource(row)!.trim(),
    definitionSourceUrl: definitionSourceUrl(row)?.trim(),
    definitionSourceLicense: definitionSourceLicense(row)!.trim(),
    definitionSourceVersion: row.definition_source_version!.trim(),
    definitionSourceArtifactSha256: row.definition_source_artifact_sha256!.trim(),
    reviewNotes: row.review_notes?.trim(),
    reviewedBy: row.reviewed_by?.trim(),
    reviewedAt: date(row.reviewed_at),
  }));

  const translationStatus = row.translation_review_status || 'draft';
  const existingTranslation = await translations.findOne({
    where: { learnerSenseId: sense.id, locale: 'vi' },
  });
  guardApprovedOverwrite(`${row.word} sense ${row.sense_order} Vietnamese translation`, existingTranslation?.reviewStatus, translationStatus);
  await translations.save(translations.create({
    ...existingTranslation,
    learnerSenseId: sense.id,
    locale: 'vi',
    text: row.definition_vi.trim(),
    textNormalized: normalizeVietnameseSearch(row.definition_vi),
    method: row.translation_method.trim(),
    source: row.translation_source.trim(),
    sourceUrl: row.translation_source_url?.trim(),
    sourceLicense: row.translation_source_license.trim(),
    confidence: row.translation_confidence,
    reviewStatus: translationStatus,
    reviewedBy: row.translation_reviewed_by?.trim(),
    reviewedAt: date(row.translation_reviewed_at),
  }));

  for (const [index, input] of (row.examples || []).entries()) {
    const exampleOrder = input.example_order ?? index + 1;
    const reviewStatus = input.review_status || 'draft';
    const existing = await examples.findOne({ where: { learnerSenseId: sense.id, exampleOrder } });
    guardApprovedOverwrite(`${row.word} sense ${row.sense_order} example ${exampleOrder}`, existing?.reviewStatus, reviewStatus);
    await examples.save(examples.create({
      ...existing,
      learnerSenseId: sense.id,
      exampleOrder,
      sourceExampleId: input.source_example_id,
      exampleEn: input.en.trim(),
      exampleVi: input.vi.trim(),
      reviewStatus,
      source: input.source.trim(),
      sourceUrl: input.source_url?.trim(),
      sourceLicense: input.source_license.trim(),
      reviewedBy: input.reviewed_by?.trim(),
      reviewedAt: date(input.reviewed_at),
    }));
  }

  for (const input of row.pronunciations || []) {
    const accent = input.accent.trim().toLowerCase();
    const priority = input.priority ?? 1;
    const reviewStatus = input.review_status || 'draft';
    const existing = await pronunciations.findOne({
      where: { learnerEntryId: entry.id, accent, priority },
    });
    guardApprovedOverwrite(`${row.word} ${accent} pronunciation ${priority}`, existing?.reviewStatus, reviewStatus);
    await pronunciations.save(pronunciations.create({
      ...existing,
      learnerEntryId: entry.id,
      accent,
      ipa: input.ipa.trim(),
      priority,
      source: input.source.trim(),
      sourceUrl: input.source_url?.trim(),
      sourceLicense: input.source_license.trim(),
      reviewStatus,
      reviewedBy: input.reviewed_by?.trim(),
      reviewedAt: date(input.reviewed_at),
    }));
  }
}

async function inspectHeadwords(rows: CurationRow[]): Promise<{ matched: number; missing: string[] }> {
  const groups = groupRows(rows);
  const wordsByHeadword = await findWords(ds.getRepository(Word), groups);
  const missing = groups.filter((group) => !wordsByHeadword.has(group.normalizedWord)).map((group) => group.normalizedWord);
  return { matched: groups.length - missing.length, missing };
}

async function importRows() {
  const rows = readRows();
  const write = has('--write');
  if (write && has('--dry-run')) throw new Error('Choose either --write or --dry-run, not both.');

  const inspection = await inspectHeadwords(rows);
  for (const word of inspection.missing) console.warn(`Missing dictionary headword: ${word}`);
  if (!write) {
    console.log(`Dry run passed for ${rows.length} senses across ${inspection.matched} matched headwords; missing=${inspection.missing.length}; writes=false.`);
    return;
  }
  if (inspection.missing.length) {
    throw new Error(`Import aborted before writes: ${inspection.missing.length} headwords are missing from words.`);
  }

  await ds.transaction(async (manager) => {
    const groups = groupRows(rows);
    const wordsByHeadword = await findWords(manager.getRepository(Word), groups);
    for (const group of groups) {
      const word = wordsByHeadword.get(group.normalizedWord);
      if (!word) throw new Error(`Import aborted: headword disappeared during transaction: ${group.normalizedWord}`);
      const entry = await upsertEntry(manager, word, group.rows);
      for (const row of group.rows) await upsertRow(manager, entry, row);
    }
  });

  await invalidateWords(rows.map((row) => row.word));
  console.log(`Imported ${rows.length} senses across ${groupRows(rows).length} headwords in one transaction; writes=true.`);
}

function csv(value: unknown) {
  const valueAsText = value == null ? '' : String(value).replace(/\r?\n/g, ' ');
  return `"${valueAsText.replace(/"/g, '""')}"`;
}

async function exportQueue() {
  const wordsFile = path.resolve(arg('--words') || 'data/learner-core/candidate-words.txt');
  const output = path.resolve(arg('--output') || 'reports/learner-curation-queue.csv');
  const limit = parseInt(arg('--limit') || '5000', 10);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
  if (!fs.existsSync(wordsFile)) throw new Error(`Candidate word file does not exist: ${wordsFile}`);
  const candidates = [...new Set(fs.readFileSync(wordsFile, 'utf8')
    .split(/\r?\n/)
    .map(normalizeWord)
    .filter(Boolean))]
    .slice(0, limit);
  if (!candidates.length) throw new Error(`Candidate word file is empty: ${wordsFile}`);

  const rows = await ds.query(`
    SELECT w.word, w.id::text word_id, d.id::text source_definition_id, d.definition_order,
      d.part_of_speech, d.definition_en, d.definition_vi raw_definition_vi, d.level legacy_level,
      array_to_string(d.quality_flags, ';') quality_flags,
      COALESCE(ls.status, 'unstarted') curation_status,
      ls.sense_key existing_sense_key,
      lst.review_status translation_review_status,
      lst.text reviewed_definition_vi
    FROM words w
    LEFT JOIN definitions d ON d.word_id=w.id
    LEFT JOIN learner_entries le ON le.word_id=w.id
    LEFT JOIN learner_senses ls ON ls.learner_entry_id=le.id AND ls.source_definition_id=d.id
    LEFT JOIN learner_sense_translations lst ON lst.learner_sense_id=ls.id AND lst.locale='vi'
    WHERE lower(w.word)=ANY($1)
    ORDER BY array_position($1, lower(w.word)), d.definition_order, d.id`, [candidates]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const columns = [
    'word',
    'word_id',
    'source_definition_id',
    'definition_order',
    'part_of_speech',
    'definition_en',
    'raw_definition_vi',
    'legacy_level',
    'quality_flags',
    'curation_status',
    'existing_sense_key',
    'translation_review_status',
    'reviewed_definition_vi',
  ];
  fs.writeFileSync(
    output,
    `${columns.map(csv).join(',')}\n${rows.map((row: Record<string, unknown>) => columns.map((column) => csv(row[column])).join(',')).join('\n')}\n`,
  );
  console.log(`Exported ${rows.length} raw sense candidates for ${candidates.length} requested words to ${output}`);
}

function exportReviewWorksheet(rows: CurationRow[]) {
  const outputArg = arg('--output');
  if (!outputArg) throw new Error('Use --output <review.csv>.');
  const output = path.resolve(outputArg);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderCurationReviewWorksheet(rows));
  console.log(
    `Exported ${rows.length} draft senses across ${groupRows(rows).length} headwords `
    + `to reviewer worksheet ${output}; decisions remain blank.`,
  );
}

async function stats() {
  const counts = await ds.query(`
    SELECT 'entry' kind, status, count(*)::int count FROM learner_entries GROUP BY status
    UNION ALL
    SELECT 'sense' kind, status, count(*)::int count FROM learner_senses GROUP BY status
    UNION ALL
    SELECT 'translation' kind, review_status status, count(*)::int count FROM learner_sense_translations GROUP BY review_status
    UNION ALL
    SELECT 'example' kind, review_status status, count(*)::int count FROM learner_examples GROUP BY review_status
    UNION ALL
    SELECT 'pronunciation' kind, review_status status, count(*)::int count FROM learner_pronunciations GROUP BY review_status
    ORDER BY kind, status`);
  const publicationChecks = await ds.query(`
    SELECT
      count(*) FILTER (WHERE ls.status='published')::int published_senses,
      count(*) FILTER (
        WHERE ls.status='published' AND NOT EXISTS (
          SELECT 1 FROM learner_sense_translations lst
          WHERE lst.learner_sense_id=ls.id AND lst.locale='vi' AND lst.review_status='approved'
        )
      )::int published_missing_approved_vi,
      count(*) FILTER (
        WHERE ls.status='published' AND NOT EXISTS (
          SELECT 1 FROM learner_examples lex
          WHERE lex.learner_sense_id=ls.id AND lex.review_status='approved'
        )
      )::int published_missing_approved_example,
      count(*) FILTER (
        WHERE ls.status='published' AND (ls.reviewed_by IS NULL OR ls.reviewed_at IS NULL)
      )::int published_missing_review_metadata,
      count(*) FILTER (
        WHERE ls.status='published' AND (
          ls.definition_source_version IS NULL
          OR length(btrim(ls.definition_source_version)) = 0
          OR ls.definition_source_artifact_sha256 IS NULL
          OR ls.definition_source_artifact_sha256 !~ '^[0-9a-f]{64}$'
        )
      )::int published_missing_definition_provenance
    FROM learner_senses ls`);
  console.table(counts);
  console.table(publicationChecks);
}

function printHelp() {
  console.log(`Learner curation commands:
  validate --file <curation.json>              Validate JSON only; never connects or writes
  review --file <curation.json> --output <csv> Validate and export a human-review worksheet; never connects or writes
  import --file <curation.json> [--dry-run]     Validate and match dictionary headwords; never writes
  import --file <curation.json> --write         Transactional, idempotent import and cache invalidation
  queue [--words <txt>] [--output <csv>] [--limit <n>]
  stats

Only import --write mutates PostgreSQL. Approved/published content must include explicit reviewer and timestamp metadata.`);
}

async function main() {
  if (has('--write') && command !== 'import') throw new Error('--write is accepted only by the import command.');
  if (command === 'help' || has('--help') || has('-h')) {
    printHelp();
    return;
  }
  if (command === 'validate') {
    const rows = readRows();
    console.log(`Validated ${rows.length} senses across ${groupRows(rows).length} headwords; database not opened; writes=false.`);
    return;
  }
  if (command === 'review') {
    exportReviewWorksheet(readRows());
    return;
  }
  if (!['import', 'queue', 'stats'].includes(command)) throw new Error(`Unknown command: ${command}. Use help for usage.`);

  await ds.initialize();
  try {
    if (command === 'import') await importRows();
    else if (command === 'queue') await exportQueue();
    else await stats();
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
}

main().catch(async (error) => {
  const detail = error instanceof Error
    ? error.stack || error.message || error.name
    : JSON.stringify(error) || String(error);
  console.error(detail || 'Unknown learner-curation failure.');
  if (ds.isInitialized) await ds.destroy();
  process.exit(1);
});
