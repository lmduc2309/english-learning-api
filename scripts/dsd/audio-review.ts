/**
 * The per-asset listening queue and the decisions taken from it.
 *
 * Audio is the one DSD artifact where automated checks are least able to stand
 * in for a person. QA can prove a clip decodes, is the right length and is not
 * silent; it cannot hear that the voice said "rehearsal" when the headword was
 * "rehearse", or that the stress landed on the wrong syllable. So every asset
 * gets an individual accept or reject from someone who played it.
 *
 * The mechanism that makes that real rather than nominal:
 *
 *   - A decisions file names the asset, its audio hash, and a `listened: true`
 *     acknowledgement. The hash binds the decision to the bytes that were
 *     played, so an asset regenerated afterwards falls out of the decision.
 *   - Batch verdicts are refused. One file may carry many decisions, but each
 *     needs its own entry, and a file where every note is identical is rejected
 *     as a rubber stamp.
 *   - The reviewer may not be the generator, and may not hold only an author
 *     role.
 *
 * USAGE:
 *   npm run dsd:audio:review -- queue --batch B-001 --output data/dsd/audio
 *   npm run dsd:audio:review -- apply --file data/dsd/audio/decisions-001.json [--write]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { RegistrySnapshot, loadRegistries, snapshotRegistries } from './lib/registry';

dotenv.config();

/** Roles that may take a listening decision. Authoring is not one of them. */
export const AUDIO_REVIEWER_ROLES = ['reviewer', 'linguistic_reviewer', 'audio_reviewer'];

export const AUDIO_DECISIONS = ['accept', 'reject'] as const;
export type AudioDecisionType = (typeof AUDIO_DECISIONS)[number];

/**
 * Fields a decisions file may not carry.
 *
 * `review_status` and the QA fields are here because a reviewer who could edit
 * them would be able to clear their own blocker; `audio_sha256` overrides
 * because the hash is what binds a decision to the bytes played.
 */
export const FORBIDDEN_AUDIO_DECISION_FIELDS = [
  'review_status', 'reviewed_at', 'qa_findings', 'training_dataset_status',
  'storage_key', 'audio_sha256_override', 'logical_asset_key',
  'generator_actor', 'engine_voice', 'model_sha256',
] as const;

const FILE_KEYS = ['$schema', 'decisions_version', 'queue_id', 'batch_id', 'reviewer_id', 'decisions'];
const DECISION_KEYS = ['asset_id', 'audio_sha256', 'listened', 'decision', 'notes'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface AudioDecision {
  asset_id: string;
  /** The bytes that were played. Binds the verdict to what was heard. */
  audio_sha256: string;
  listened: boolean;
  decision: AudioDecisionType;
  notes?: string;
}

export interface AudioDecisionsFile {
  decisions_version: number;
  queue_id: string;
  batch_id: string;
  reviewer_id: string;
  decisions: AudioDecision[];
}

export interface QueueAsset {
  assetId: string;
  headword: string;
  publicVoiceId: string;
  storageKey: string;
  audioSha256: string;
  durationMs: number;
  reviewStatus: string;
  generatorActor: string;
  qaFindings: Array<{ rule: string; detail: string }>;
}

export interface AudioQueueFile {
  queue_version: number;
  queue_id: string;
  batch_id: string;
  generated_at: string;
  items: Array<{
    asset_id: string;
    headword: string;
    voice: string;
    /** Where to fetch the bytes to play. */
    storage_key: string;
    audio_sha256: string;
    duration_ms: number;
  }>;
}

/**
 * Build a listening queue.
 *
 * Only assets that passed QA and came from the release runtime appear. A clip
 * that failed QA would waste a reviewer's attention on a defect already known,
 * and a test candidate is not reviewable at all.
 */
export function buildAudioQueue(
  batchId: string,
  generatedAt: string,
  assets: QueueAsset[],
): AudioQueueFile {
  return {
    queue_version: 1,
    queue_id: `QA-${batchId}-${generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
    batch_id: batchId,
    generated_at: generatedAt,
    items: assets
      .filter((asset) => asset.reviewStatus === 'awaiting_review' && asset.qaFindings.length === 0)
      .map((asset) => ({
        asset_id: asset.assetId,
        headword: asset.headword,
        // The neutral label, never the model name.
        voice: asset.publicVoiceId,
        storage_key: asset.storageKey,
        audio_sha256: asset.audioSha256,
        duration_ms: asset.durationMs,
      })),
  };
}

function checkKeys(value: unknown, allowed: string[], where: string, errors: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if ((FORBIDDEN_AUDIO_DECISION_FIELDS as readonly string[]).includes(key)) {
      errors.push(
        `${where}: forbidden field '${key}' — a listening decision records accept or reject, ` +
          'never review state, QA results or asset identity',
      );
    } else if (!allowed.includes(key)) {
      errors.push(`${where}: unknown field '${key}'`);
    }
  }
}

/** Pure. Validates the file alone; opens no connection. */
export function validateAudioDecisions(
  doc: AudioDecisionsFile,
  registry: RegistrySnapshot,
): string[] {
  const errors: string[] = [];
  checkKeys(doc, FILE_KEYS, 'decisions', errors);

  if (doc.decisions_version !== 1) errors.push('decisions: decisions_version must be 1');
  if (!(doc.queue_id ?? '').trim()) errors.push('decisions: queue_id is required');
  if (!(doc.batch_id ?? '').trim()) errors.push('decisions: batch_id is required');

  const reviewer = registry.contributors[(doc.reviewer_id ?? '').trim()];
  if (!reviewer) {
    errors.push(`decisions: reviewer '${doc.reviewer_id}' is not in the contributor registry`);
  } else {
    if (reviewer.status !== 'active') {
      errors.push(`decisions: reviewer '${doc.reviewer_id}' is not active`);
    }
    if (!reviewer.roles.some((role) => AUDIO_REVIEWER_ROLES.includes(role))) {
      errors.push(
        `decisions: '${doc.reviewer_id}' does not hold a listening-review role ` +
          `(${AUDIO_REVIEWER_ROLES.join(', ')})`,
      );
    }
  }

  const decisions = Array.isArray(doc.decisions) ? doc.decisions : [];
  if (decisions.length === 0) errors.push('decisions: no decisions');

  const seen = new Set<string>();
  const notes: string[] = [];

  decisions.forEach((decision, index) => {
    const where = `decision ${index + 1}`;
    checkKeys(decision, DECISION_KEYS, where, errors);

    if (!UUID_RE.test((decision.asset_id ?? '').trim())) {
      errors.push(`${where}: asset_id is not a UUID`);
    }
    if (seen.has(decision.asset_id)) {
      errors.push(`${where}: asset ${decision.asset_id} already has a decision in this file`);
    }
    seen.add(decision.asset_id);

    if (!SHA256_RE.test((decision.audio_sha256 ?? '').trim())) {
      // Without the hash there is nothing tying the verdict to what was played.
      errors.push(`${where}: audio_sha256 is required, and names the bytes that were played`);
    }
    if (decision.listened !== true) {
      errors.push(
        `${where}: listened must be true — an audio decision means somebody played the clip`,
      );
    }
    if (!(AUDIO_DECISIONS as readonly string[]).includes(decision.decision)) {
      errors.push(`${where}: decision must be accept or reject`);
    }
    if (decision.decision === 'reject' && !(decision.notes ?? '').trim()) {
      errors.push(`${where}: a rejection needs notes saying what was wrong`);
    }
    if ((decision.notes ?? '').trim()) notes.push(decision.notes!.trim());
  });

  // Every note identical across a multi-asset file is the signature of a batch
  // verdict typed once and copied, which is what per-asset review forbids.
  if (decisions.length > 2 && notes.length === decisions.length && new Set(notes).size === 1) {
    errors.push(
      'decisions: every note is identical across ' +
        `${decisions.length} assets, which reads as one batch verdict rather than ` +
        'individual listening decisions',
    );
  }

  return errors;
}

export interface AudioAssetRow {
  assetId: string;
  audioSha256: string;
  reviewStatus: string;
  generatorActor: string;
  trainingDatasetStatus: string;
  qaFindings: Array<{ rule: string; detail: string }>;
  hasQuarantinedConflict: boolean;
}

export interface AudioReviewPlan {
  toApply: Array<{ assetId: string; status: 'accepted' | 'rejected'; notes: string | null }>;
  blocked: string[];
  reviewerId: string;
}

/** Check each decision against the asset as it currently stands. */
export function planAudioReview(
  doc: AudioDecisionsFile,
  rows: AudioAssetRow[],
): AudioReviewPlan {
  const plan: AudioReviewPlan = { toApply: [], blocked: [], reviewerId: doc.reviewer_id };
  const byId = new Map(rows.map((row) => [row.assetId, row]));

  for (const decision of doc.decisions ?? []) {
    const where = `asset ${decision.asset_id}`;
    const row = byId.get(decision.asset_id);
    if (!row) {
      plan.blocked.push(`${where}: no such audio asset`);
      continue;
    }
    if (row.audioSha256 !== decision.audio_sha256) {
      // The asset was regenerated after the queue was built, so the verdict
      // describes bytes that are no longer the asset.
      plan.blocked.push(
        `${where}: stale — the decision names ${decision.audio_sha256.slice(0, 12)}… but the ` +
          `asset now holds ${row.audioSha256.slice(0, 12)}…`,
      );
      continue;
    }
    if (row.reviewStatus !== 'awaiting_review') {
      plan.blocked.push(`${where}: is '${row.reviewStatus}', not awaiting review`);
      continue;
    }
    if (row.generatorActor === doc.reviewer_id) {
      plan.blocked.push(`${where}: ${doc.reviewer_id} generated it and cannot review it`);
      continue;
    }
    if (row.qaFindings.length > 0) {
      plan.blocked.push(
        `${where}: has unresolved QA findings (${row.qaFindings.map((f) => f.rule).join(', ')})`,
      );
      continue;
    }
    if (row.hasQuarantinedConflict) {
      plan.blocked.push(`${where}: has a quarantined conflict; resolve it before deciding`);
      continue;
    }
    if (decision.decision === 'accept' && row.trainingDatasetStatus !== 'approved') {
      plan.blocked.push(
        `${where}: cannot be accepted while voice rights are '${row.trainingDatasetStatus}'`,
      );
      continue;
    }

    plan.toApply.push({
      assetId: decision.asset_id,
      status: decision.decision === 'accept' ? 'accepted' : 'rejected',
      notes: (decision.notes ?? '').trim() || null,
    });
  }

  return plan;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const QUEUE_SQL = `
  SELECT a.id AS "assetId", e.headword, a.public_voice_id AS "publicVoiceId",
         a.storage_key AS "storageKey", a.audio_sha256 AS "audioSha256",
         a.duration_ms AS "durationMs", a.review_status AS "reviewStatus",
         a.generator_actor AS "generatorActor", a.qa_findings AS "qaFindings"
    FROM dsd_audio_assets a
    JOIN dsd_entries e ON e.id = a.dsd_entry_id
   WHERE a.review_status = 'awaiting_review'
   ORDER BY e.headword, a.public_voice_id`;

const ASSET_ROWS_SQL = `
  SELECT a.id AS "assetId", a.audio_sha256 AS "audioSha256",
         a.review_status AS "reviewStatus", a.generator_actor AS "generatorActor",
         a.training_dataset_status AS "trainingDatasetStatus",
         a.qa_findings AS "qaFindings",
         EXISTS (
           SELECT 1 FROM dsd_audio_assets c
            WHERE c.logical_asset_key = a.logical_asset_key
              AND c.id <> a.id AND c.review_status = 'quarantined'
         ) AS "hasQuarantinedConflict"
    FROM dsd_audio_assets a
   WHERE a.id = ANY($1::uuid[])`;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'queue';

  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    throw new Error('Registry validation failed:\n  - ' + loaded.errors.join('\n  - '));
  }
  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    if (command === 'queue') {
      const batchId = arg('batch') ?? 'all';
      const assets: QueueAsset[] = await ds.query(QUEUE_SQL);
      const queue = buildAudioQueue(batchId, new Date().toISOString(), assets);

      const output = arg('output');
      const json = JSON.stringify(queue, null, 2);
      if (output) {
        const file = path.resolve(process.cwd(), output, `${queue.queue_id}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, json + '\n');
        console.log(`Wrote ${queue.items.length} item(s) to ${file}`);
      } else {
        console.log(json);
      }
      console.log(
        '\nEvery item must be played and decided individually. A batch verdict is refused.',
      );
      return;
    }

    if (command !== 'apply') throw new Error(`Unknown command '${command}'`);

    const file = arg('file');
    if (!file) throw new Error('--file is required');
    const doc: AudioDecisionsFile = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'),
    );

    const errors = validateAudioDecisions(doc, snapshotRegistries(loaded));
    if (errors.length > 0) {
      console.error(`${errors.length} validation error(s) in ${file}:`);
      for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
      process.exit(1);
    }

    const rows: AudioAssetRow[] = await ds.query(ASSET_ROWS_SQL, [
      doc.decisions.map((d) => d.asset_id),
    ]);
    const plan = planAudioReview(doc, rows);

    console.log(`  apply    ${plan.toApply.length}`);
    console.log(`  blocked  ${plan.blocked.length}`);
    for (const reason of plan.blocked) console.error(`  - ${reason}`);
    if (plan.blocked.length > 0) {
      console.error('Refusing to apply while any decision is blocked.');
      process.exit(1);
    }

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing written. Re-run with --write.');
      return;
    }

    await ds.transaction(async (manager) => {
      for (const decision of plan.toApply) {
        // reviewed_at comes from the database; a file cannot backdate a review.
        await manager.query(
          `UPDATE dsd_audio_assets
              SET review_status = $1, reviewed_by = $2, reviewed_at = now(),
                  review_notes = $3, updated_at = now()
            WHERE id = $4 AND review_status = 'awaiting_review'`,
          [decision.status, plan.reviewerId, decision.notes, decision.assetId],
        );
      }
    });

    console.log(`\nRecorded ${plan.toApply.length} listening decision(s).`);
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
