/**
 * DSD full-corpus target contract.
 *
 * The legacy database contributes one integer and nothing else. Keeping the
 * contract deliberately tiny makes the clean-room boundary mechanically
 * reviewable: if a future edit adds a word, identifier, rank, or content field,
 * validation refuses the file before any generation job can use it.
 *
 * USAGE:
 *   npm run dsd:target:validate -- --file data/dsd/targets/legacy-parity-2026-08-09.json
 *   npm run dsd:target:status   -- --file data/dsd/targets/legacy-parity-2026-08-09.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';

dotenv.config();

export const TARGET_ID = 'DSD-TARGET-LEGACY-PARITY-20260809';
export const TARGET_LANGUAGE = 'en';
export const TARGET_UNIQUE_ENTRIES = 475_153;
export const TARGET_EVIDENCE_ID = 'LEGACY-CORPUS-AGGREGATE-COUNT-2026-08-09';

const ALLOWED_KEYS = [
  '$schema',
  'target_id',
  'language',
  'unique_normalized_entries',
  'evidence_id',
  'legacy_inventory_used',
] as const;

export const FORBIDDEN_TARGET_FIELDS = [
  'headword', 'headwords', 'word', 'words', 'word_id', 'legacy_id',
  'legacy_ids', 'order', 'position', 'rank', 'frequency', 'coverage',
  'definition', 'definition_en', 'definition_vi', 'translation',
  'example', 'example_en', 'example_vi', 'ipa', 'pronunciation',
  'source_rows', 'source_hash', 'source_digest', 'inventory',
] as const;

export interface CorpusTarget {
  $schema?: string;
  target_id: string;
  language: string;
  unique_normalized_entries: number;
  evidence_id: string;
  legacy_inventory_used: boolean;
}

export interface TargetStatus {
  target: number;
  inventory: number;
  textComplete: number;
  ipaComplete: number;
  audioComplete: number;
  releaseEligible: number;
  published: number;
  deficit: number;
  overTarget: boolean;
}

export function validateTargetDocument(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['target must be a JSON object'];
  }

  const doc = value as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if ((FORBIDDEN_TARGET_FIELDS as readonly string[]).includes(key)) {
      errors.push(`forbidden field '${key}': the target may carry a scalar count only`);
    } else if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown field '${key}'`);
    }
  }

  if (doc.target_id !== TARGET_ID) {
    errors.push(`target_id must be '${TARGET_ID}'`);
  }
  if (doc.language !== TARGET_LANGUAGE) {
    errors.push(`language must be '${TARGET_LANGUAGE}'`);
  }
  if (doc.unique_normalized_entries !== TARGET_UNIQUE_ENTRIES) {
    errors.push(`unique_normalized_entries must be ${TARGET_UNIQUE_ENTRIES}`);
  }
  if (doc.evidence_id !== TARGET_EVIDENCE_ID) {
    errors.push(`evidence_id must be '${TARGET_EVIDENCE_ID}'`);
  }
  if (doc.legacy_inventory_used !== false) {
    errors.push('legacy_inventory_used must be false');
  }
  return errors;
}

export function loadTarget(file: string): CorpusTarget {
  const resolved = path.resolve(process.cwd(), file);
  const doc: unknown = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const errors = validateTargetDocument(doc);
  if (errors.length > 0) {
    throw new Error(`Invalid corpus target:\n  - ${errors.join('\n  - ')}`);
  }
  return doc as CorpusTarget;
}

export function buildTargetStatus(target: CorpusTarget, row: Record<string, unknown>): TargetStatus {
  const number = (key: string): number => Number(row[key] ?? 0);
  const inventory = number('inventory');
  return {
    target: target.unique_normalized_entries,
    inventory,
    textComplete: number('text_complete'),
    ipaComplete: number('ipa_complete'),
    audioComplete: number('audio_complete'),
    releaseEligible: number('release_eligible'),
    published: number('published'),
    deficit: target.unique_normalized_entries - inventory,
    overTarget: inventory > target.unique_normalized_entries,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export const TARGET_STATUS_SQL = `
WITH entry_status AS (
  SELECT e.id, e.status,
         EXISTS (
           SELECT 1 FROM dsd_senses s
            WHERE s.entry_id = e.id AND s.status IN ('approved', 'published')
              AND EXISTS (
                SELECT 1 FROM dsd_translations t
                 WHERE t.sense_id = s.id AND t.locale = 'vi'
                   AND t.status IN ('approved', 'published')
              )
              AND EXISTS (
                SELECT 1 FROM dsd_examples x
                 WHERE x.sense_id = s.id AND x.status IN ('approved', 'published')
              )
         ) AS text_complete,
         EXISTS (
           SELECT 1 FROM dsd_pronunciations p
            WHERE p.entry_id = e.id AND p.accent = 'en-US'
              AND p.status IN ('approved', 'published')
         ) AS ipa_complete,
         EXISTS (
           SELECT 1 FROM dsd_audio_assets a
            WHERE a.dsd_entry_id = e.id AND a.public_voice_id = 'en-aria'
              AND a.review_status = 'accepted'
              AND a.training_dataset_status = 'approved'
              AND jsonb_array_length(a.qa_findings) = 0
         ) AND EXISTS (
           SELECT 1 FROM dsd_audio_assets a
            WHERE a.dsd_entry_id = e.id AND a.public_voice_id = 'en-guy'
              AND a.review_status = 'accepted'
              AND a.training_dataset_status = 'approved'
              AND jsonb_array_length(a.qa_findings) = 0
         ) AS audio_complete
    FROM dsd_entries e
   WHERE e.language = 'en'
), counts AS (
  SELECT
    (SELECT count(DISTINCT headword_normalized) FROM dsd_entries WHERE language = 'en')::int AS inventory,
    count(*) FILTER (WHERE text_complete)::int AS text_complete,
    count(*) FILTER (WHERE ipa_complete)::int AS ipa_complete,
    count(*) FILTER (WHERE audio_complete)::int AS audio_complete,
    count(*) FILTER (WHERE text_complete AND ipa_complete AND audio_complete)::int AS release_eligible,
    count(*) FILTER (WHERE status = 'published' AND text_complete AND ipa_complete AND audio_complete)::int AS published
  FROM entry_status
)
SELECT * FROM counts`;

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['validate', 'status'].includes(command)) {
    throw new Error('Usage: target.ts <validate|status> --file <target.json>');
  }
  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const target = loadTarget(file);

  if (command === 'validate') {
    console.log(`Target valid: ${target.target_id} = ${target.unique_normalized_entries}`);
    return;
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }
  const ds = createDsdDataSource('audit', config);
  await ds.initialize();
  try {
    const [row] = await ds.query(TARGET_STATUS_SQL);
    const status = buildTargetStatus(target, row ?? {});
    console.log(JSON.stringify(status, null, 2));
    if (status.overTarget) {
      throw new Error(
        `DSD inventory exceeds target by ${status.inventory - status.target}; ` +
        'refusing to hide the error with deletion',
      );
    }
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
