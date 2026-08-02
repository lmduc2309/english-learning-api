/**
 * DSD independent review, and the publication gate.
 *
 * Review is where the corpus earns the claim that it is original, checked work,
 * so the interesting parts of this file are the refusals:
 *
 *   - A queue shows DSD drafts and nothing else. There is no legacy connection
 *     in this file, so a reviewer cannot be shown source wording to "compare
 *     against" — which is how independent authoring quietly stops being
 *     independent.
 *   - A decision names the exact content hash it was made against. If the text
 *     changed after the queue was generated, the decision is stale and is
 *     refused, because it approves words nobody read.
 *   - A reviewer cannot supply replacement wording. Rewriting is authoring, and
 *     an author cannot review their own work. Rejections carry guidance only.
 *   - Publication is a separate command. Approval never publishes anything, and
 *     publication runs the completeness, provenance, quality and similarity
 *     gates first. A gate that has not run blocks; it never passes by default.
 *
 * USAGE:
 *   npm run dsd:review:queue    -- --batch B-001 --output data/dsd/reviews
 *   npm run dsd:review:validate -- --file data/dsd/reviews/decisions-001.json
 *   npm run dsd:review:apply    -- --file data/dsd/reviews/decisions-001.json [--write]
 *   npm run dsd:publish         -- --entry <uuid> [--write]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { loadRegistries, RegistrySnapshot, snapshotRegistries } from './lib/registry';
import {
  DsdAction,
  DsdState,
  TRANSITIONS,
  resolveTransition,
} from './lib/state-machine';

dotenv.config();

export const REVIEWABLE_KINDS = ['sense', 'translation', 'example'] as const;
export type ReviewableKind = (typeof REVIEWABLE_KINDS)[number];

export const REVIEW_DECISIONS = ['approve', 'reject'] as const;
export type ReviewDecisionType = (typeof REVIEW_DECISIONS)[number];

/** Roles that may decide. A reviewer role is not implied by authorship. */
export const REVIEWER_ROLES = ['reviewer', 'linguistic_reviewer'];

/** Publication is a release decision, not a linguistic one. */
export const PUBLISHER_ROLES = ['product_owner'];

/**
 * Fields refused by name in a decisions file.
 *
 * Content fields are here for the same reason as reviewer fields: a decision
 * that could carry replacement wording would make the reviewer the author, and
 * the independent-review guarantee would be a formality.
 */
export const FORBIDDEN_DECISION_FIELDS = [
  'definition_en', 'translation_vi', 'text', 'example_en', 'example_vi',
  'replacement', 'rewrite', 'suggested_text',
  'status', 'reviewed_at', 'published_at', 'content_hash_override',
  'word_id', 'definition_id', 'source_definition_id', 'legacy_id', 'oewn_sense_id',
  'provider', 'model', 'prompt', 'api_key',
  'similarity_score',
] as const;

const DECISIONS_FILE_KEYS = [
  '$schema', 'decisions_version', 'queue_id', 'batch_id', 'reviewer_id',
  'decision_evidence_id', 'decisions',
];
const DECISION_KEYS = ['entity_kind', 'entity_id', 'content_sha256', 'decision', 'notes'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;

export interface ReviewDecision {
  entity_kind: ReviewableKind;
  entity_id: string;
  content_sha256: string;
  decision: ReviewDecisionType;
  notes?: string;
}

export interface ReviewDecisionsFile {
  decisions_version: number;
  queue_id: string;
  batch_id: string;
  reviewer_id: string;
  decision_evidence_id: string;
  decisions: ReviewDecision[];
}

// ─── queue ──────────────────────────────────────────────────────────────────

export interface QueueSourceRow {
  entityKind: ReviewableKind;
  entityId: string;
  headword: string;
  senseKey: string;
  partOfSpeech: string;
  content: string[];
  contentSha256: string;
  authoredBy: string;
  status: string;
}

export interface QueueFile {
  queue_version: number;
  queue_id: string;
  batch_id: string;
  generated_at: string;
  items: Array<{
    entity_kind: ReviewableKind;
    entity_id: string;
    headword: string;
    sense_key: string;
    part_of_speech: string;
    content: string[];
    content_sha256: string;
    authored_by: string;
    status: string;
  }>;
}

/**
 * Shape a queue. Every field here is DSD-authored; there is deliberately no
 * comparison column, no similarity score and no source reference, because a
 * reviewer who is shown a legacy rendering can no longer testify that the DSD
 * wording was reached independently.
 */
export function buildQueue(
  batchId: string,
  generatedAt: string,
  rows: QueueSourceRow[],
): QueueFile {
  return {
    queue_version: 1,
    queue_id: `Q-${batchId}-${generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
    batch_id: batchId,
    generated_at: generatedAt,
    items: rows.map((row) => ({
      entity_kind: row.entityKind,
      entity_id: row.entityId,
      headword: row.headword,
      sense_key: row.senseKey,
      part_of_speech: row.partOfSpeech,
      content: row.content,
      content_sha256: row.contentSha256,
      // Shown so the reviewer can decline their own work before deciding, and
      // so the refusal below is explicable rather than mysterious.
      authored_by: row.authoredBy,
      status: row.status,
    })),
  };
}

// ─── decisions validation ───────────────────────────────────────────────────

function checkKeys(value: unknown, allowed: string[], where: string, errors: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if ((FORBIDDEN_DECISION_FIELDS as readonly string[]).includes(key)) {
      errors.push(
        `${where}: forbidden field '${key}' — a decision records approval or ` +
          'rejection with guidance, never replacement wording or review state',
      );
    } else if (!allowed.includes(key)) {
      errors.push(`${where}: unknown field '${key}'`);
    }
  }
}

/**
 * Notes are meant to be DSD-specific guidance. Whether a note quotes a third
 * party is not mechanically decidable, so this checks the two shapes that can
 * be caught: a link out, and a named blocked source. It is a tripwire, not a
 * proof — REVIEW-RUBRIC.md carries the rule this approximates.
 */
function checkNotes(
  notes: string,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  if (URL_RE.test(notes)) {
    errors.push(`${where}: notes contain a link — guidance must stand on its own`);
  }
  for (const name of registry.blockedSourceNames ?? []) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(notes)) {
      errors.push(
        `${where}: notes cite blocked source '${name}' — a reviewer must not ` +
          'direct an author towards third-party wording',
      );
    }
  }
}

export function validateDecisionsFile(
  doc: ReviewDecisionsFile,
  registry: RegistrySnapshot,
): string[] {
  const errors: string[] = [];
  checkKeys(doc, DECISIONS_FILE_KEYS, 'decisions', errors);

  if (doc.decisions_version !== 1) {
    errors.push(`decisions: decisions_version must be 1, got '${doc.decisions_version}'`);
  }
  if (!(doc.queue_id ?? '').trim()) errors.push('decisions: queue_id is required');
  if (!(doc.batch_id ?? '').trim()) errors.push('decisions: batch_id is required');
  if (!(doc.decision_evidence_id ?? '').trim()) {
    errors.push(
      'decisions: decision_evidence_id is required — it is what the provenance ' +
        'event points at, since the ledger stores no free text',
    );
  }

  const reviewerId = (doc.reviewer_id ?? '').trim();
  const reviewer = registry.contributors[reviewerId];
  if (!reviewer) {
    errors.push(`decisions: reviewer '${doc.reviewer_id}' is not in the contributor registry`);
  } else {
    if (reviewer.status !== 'active') {
      errors.push(`decisions: reviewer '${reviewerId}' is not active (status '${reviewer.status}')`);
    }
    if (!reviewer.roles.some((role) => REVIEWER_ROLES.includes(role))) {
      errors.push(`decisions: '${reviewerId}' does not hold a reviewer role`);
    }
  }

  const decisions = Array.isArray(doc.decisions) ? doc.decisions : [];
  if (decisions.length === 0) errors.push('decisions: decisions is empty');

  decisions.forEach((decision, index) => {
    const where = `decision ${index + 1}`;
    checkKeys(decision, DECISION_KEYS, where, errors);

    if (!(REVIEWABLE_KINDS as readonly string[]).includes(decision.entity_kind)) {
      errors.push(`${where}: unknown entity_kind '${decision.entity_kind}'`);
    }
    if (!UUID_RE.test((decision.entity_id ?? '').trim())) {
      errors.push(`${where}: entity_id '${decision.entity_id}' is not a UUID`);
    }
    if (!SHA256_RE.test((decision.content_sha256 ?? '').trim())) {
      errors.push(
        `${where}: content_sha256 is missing or malformed — a decision must name ` +
          'the exact text it was made against',
      );
    }
    if (!(REVIEW_DECISIONS as readonly string[]).includes(decision.decision)) {
      errors.push(`${where}: decision must be one of ${REVIEW_DECISIONS.join(', ')}`);
    }

    const notes = (decision.notes ?? '').trim();
    if (decision.decision === 'reject' && !notes) {
      errors.push(`${where}: a rejection must carry guidance the author can act on`);
    }
    if (notes) checkNotes(notes, where, registry, errors);
  });

  return errors;
}

// ─── applying decisions ─────────────────────────────────────────────────────

export interface ReviewableRow {
  entityKind: ReviewableKind;
  entityId: string;
  contentSha256: string;
  status: string;
  authoredBy: string;
}

export interface AppliedDecision {
  entityKind: ReviewableKind;
  entityId: string;
  fromStatus: string;
  toStatus: DsdState;
  event: string;
  reviewerId: string;
  contentSha256: string;
}

export interface ReviewPlan {
  reviewerId: string;
  evidenceId: string;
  toApply: AppliedDecision[];
  blocked: string[];
}

export function planReviewApply(doc: ReviewDecisionsFile, rows: ReviewableRow[]): ReviewPlan {
  const plan: ReviewPlan = {
    reviewerId: doc.reviewer_id,
    evidenceId: doc.decision_evidence_id,
    toApply: [],
    blocked: [],
  };

  const byId = new Map(rows.map((row) => [`${row.entityKind} ${row.entityId}`, row]));
  const seen = new Set<string>();

  (doc.decisions ?? []).forEach((decision, index) => {
    const key = `${decision.entity_kind} ${decision.entity_id}`;
    const where = `decision ${index + 1} (${key})`;

    if (seen.has(key)) {
      plan.blocked.push(`${where}: decided twice in one file`);
      return;
    }
    seen.add(key);

    const row = byId.get(key);
    if (!row) {
      plan.blocked.push(`${where}: no such DSD record`);
      return;
    }

    if (row.contentSha256 !== decision.content_sha256) {
      // The text moved after the queue was generated. Approving it would
      // approve words the reviewer never saw.
      plan.blocked.push(
        `${where}: stale — reviewed ${decision.content_sha256.slice(0, 12)}…, ` +
          `row is now ${row.contentSha256.slice(0, 12)}…; regenerate the queue`,
      );
      return;
    }

    const action: DsdAction = decision.decision === 'approve' ? 'approve' : 'reject';

    if (TRANSITIONS[action].requiresIndependentReviewer && row.authoredBy === doc.reviewer_id) {
      plan.blocked.push(`${where}: ${doc.reviewer_id} authored this record and cannot review it`);
      return;
    }

    const errors: string[] = [];
    const rule = resolveTransition(row.status, action, where, errors);
    if (!rule) {
      plan.blocked.push(...errors);
      return;
    }

    plan.toApply.push({
      entityKind: row.entityKind,
      entityId: row.entityId,
      fromStatus: row.status,
      toStatus: rule.to,
      event: rule.event,
      reviewerId: doc.reviewer_id,
      contentSha256: row.contentSha256,
    });
  });

  return plan;
}

/**
 * An entry's status is a rollup of its content, not an independently reviewed
 * state: the product decision to teach a word was made and evidenced at
 * inventory time, and what needs linguistic review is the writing. The rollup
 * only moves forward, so a new draft sense cannot pull a published entry back.
 */
export function rollupEntryStatus(current: string, contentStatuses: string[]): string {
  const live = contentStatuses.filter((status) => status !== 'rejected' && status !== 'retired');
  if (live.length === 0) return current;

  const rank: Record<string, number> = {
    draft: 0, in_review: 1, approved: 2, published: 3, retired: 4, rejected: 4,
  };

  let rolled: string;
  if (live.every((status) => status === 'published')) rolled = 'published';
  else if (live.every((status) => status === 'approved' || status === 'published')) rolled = 'approved';
  else if (live.some((status) => status !== 'draft')) rolled = 'in_review';
  else rolled = 'draft';

  return (rank[rolled] ?? 0) > (rank[current] ?? 0) ? rolled : current;
}

// ─── publication gates ──────────────────────────────────────────────────────

export type GateStatus = 'pass' | 'fail' | 'not_run';

export interface GateResult {
  gate: string;
  status: GateStatus;
  detail: string;
}

export interface PublishableRecord {
  entityKind: ReviewableKind;
  entityId: string;
  status: string;
  contentSha256: string;
  authoredBy: string;
  reviewedBy: string | null;
  /** 'approved' provenance events recorded for this row. */
  approvals: Array<{ actor: string; outputHash: string | null }>;
}

export interface PublishableSense extends PublishableRecord {
  senseKey: string;
  translations: PublishableRecord[];
  examples: PublishableRecord[];
}

export interface EntrySnapshot {
  entryId: string;
  headword: string;
  entryStatus: string;
  senses: PublishableSense[];
}

function checkRecordReady(record: PublishableRecord, where: string, blocked: string[]): void {
  if (record.status !== 'approved') {
    blocked.push(`${where}: status is '${record.status}', not approved`);
    return;
  }

  if (!record.reviewedBy) {
    blocked.push(`${where}: approved with no reviewer recorded`);
    return;
  }

  if (record.reviewedBy === record.authoredBy) {
    blocked.push(`${where}: reviewed by its own author (${record.authoredBy})`);
  }

  // The ledger must corroborate the row. A status set without a matching event
  // is a status set by something other than the review workflow.
  const matching = record.approvals.filter(
    (approval) => approval.outputHash === record.contentSha256,
  );
  if (matching.length === 0) {
    blocked.push(
      `${where}: no approval event for content ${record.contentSha256.slice(0, 12)}… ` +
        '— the row was approved against different text, or outside the workflow',
    );
    return;
  }
  if (!matching.some((approval) => approval.actor === record.reviewedBy)) {
    blocked.push(`${where}: approval event actor does not match reviewed_by`);
  }
}

/**
 * Everything that must hold before an entry may be published. Returns the
 * blocking reasons; empty means publishable.
 */
export function evaluateEntryPublication(
  snapshot: EntrySnapshot,
  gates: GateResult[],
): string[] {
  const blocked: string[] = [];

  if (snapshot.entryStatus !== 'approved') {
    blocked.push(
      `entry ${snapshot.headword}: status is '${snapshot.entryStatus}', not approved`,
    );
  }

  if (snapshot.senses.length === 0) {
    blocked.push(`entry ${snapshot.headword}: has no senses`);
  }

  for (const sense of snapshot.senses) {
    const where = `sense '${sense.senseKey}'`;
    checkRecordReady(sense, where, blocked);

    const translations = sense.translations.filter((t) => t.status === 'approved');
    if (translations.length === 0) {
      blocked.push(`${where}: has no approved Vietnamese translation`);
    }
    translations.forEach((translation, index) =>
      checkRecordReady(translation, `${where} translation ${index + 1}`, blocked),
    );

    const examples = sense.examples.filter((e) => e.status === 'approved');
    if (examples.length === 0) {
      blocked.push(`${where}: has no approved example`);
    }
    examples.forEach((example, index) =>
      checkRecordReady(example, `${where} example ${index + 1}`, blocked),
    );
  }

  for (const gate of gates) {
    if (gate.status === 'pass') continue;
    // A gate that has not run is not a gate that passed. Fail closed.
    blocked.push(`gate '${gate.gate}': ${gate.status} — ${gate.detail}`);
  }

  return blocked;
}

/**
 * The gates owned by later tasks. Until they exist there is no evidence a
 * record was checked, so publication is refused — which is the correct answer,
 * not a placeholder.
 */
export function externalGates(): GateResult[] {
  return [
    {
      gate: 'quality',
      status: 'not_run',
      detail: 'dsd:quality:audit is not implemented yet (Task 7)',
    },
    {
      gate: 'similarity',
      status: 'not_run',
      detail: 'dsd:similarity:audit is not implemented yet (Task 8)',
    },
  ];
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireRegistries(): RegistrySnapshot {
  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    console.error('Registry validation failed; fix the registries first:');
    for (const error of loaded.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  return snapshotRegistries(loaded);
}

/** Validate a decisions file. Reads registries from Git; opens no connection. */
function validateFile(file: string): ReviewDecisionsFile {
  const doc: ReviewDecisionsFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateDecisionsFile(doc, requireRegistries());
  if (errors.length > 0) {
    console.error(`${errors.length} validation error(s) in ${file}:`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    if (errors.length > 40) console.error(`  … ${errors.length - 40} more`);
    process.exit(1);
  }
  return doc;
}

function requireConfig() {
  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }
  return config;
}

const QUEUE_SQL = `
  SELECT 'sense'::text AS "entityKind", s.id AS "entityId", e.headword, s.sense_key AS "senseKey",
         s.part_of_speech AS "partOfSpeech", ARRAY[s.definition_en] AS content,
         s.content_sha256 AS "contentSha256", s.authored_by AS "authoredBy", s.status
    FROM dsd_senses s JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE s.batch_id = $1 AND s.status IN ('draft','in_review')
  UNION ALL
  SELECT 'translation', t.id, e.headword, s.sense_key, s.part_of_speech, ARRAY[t.text],
         t.content_sha256, t.authored_by, t.status
    FROM dsd_translations t
    JOIN dsd_senses s ON s.id = t.dsd_sense_id
    JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE t.batch_id = $1 AND t.status IN ('draft','in_review')
  UNION ALL
  SELECT 'example', x.id, e.headword, s.sense_key, s.part_of_speech,
         ARRAY[x.example_en, x.example_vi], x.content_sha256, x.authored_by, x.status
    FROM dsd_examples x
    JOIN dsd_senses s ON s.id = x.dsd_sense_id
    JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE x.batch_id = $1 AND x.status IN ('draft','in_review')
   ORDER BY 3, 4, 1, 2`;

const TABLE_OF: Record<ReviewableKind, string> = {
  sense: 'dsd_senses',
  translation: 'dsd_translations',
  example: 'dsd_examples',
};

async function refreshEntryStatuses(
  manager: { query: (sql: string, params?: unknown[]) => Promise<any> },
  entryIds: string[],
): Promise<void> {
  for (const entryId of entryIds) {
    const [{ status: current }] = await manager.query(
      `SELECT status FROM dsd_entries WHERE id = $1`, [entryId],
    );
    const rows = await manager.query(
      `SELECT s.status FROM dsd_senses s WHERE s.dsd_entry_id = $1
       UNION ALL
       SELECT t.status FROM dsd_translations t
         JOIN dsd_senses s ON s.id = t.dsd_sense_id WHERE s.dsd_entry_id = $1
       UNION ALL
       SELECT x.status FROM dsd_examples x
         JOIN dsd_senses s ON s.id = x.dsd_sense_id WHERE s.dsd_entry_id = $1`,
      [entryId],
    );
    const rolled = rollupEntryStatus(current, rows.map((r: any) => r.status));
    if (rolled !== current) {
      await manager.query(
        `UPDATE dsd_entries SET status = $1, updated_at = now() WHERE id = $2`,
        [rolled, entryId],
      );
    }
  }
}

async function runQueue(): Promise<void> {
  const batch = arg('batch');
  const output = arg('output');
  if (!batch || !output) throw new Error('--batch and --output are required');

  const ds = createDsdDataSource('curator', requireConfig());
  await ds.initialize();
  try {
    const rows: QueueSourceRow[] = await ds.query(QUEUE_SQL, [batch]);
    if (rows.length === 0) {
      console.log(`No draft or in-review content in batch ${batch}.`);
      return;
    }

    const queue = buildQueue(batch, new Date().toISOString(), rows);
    const dir = path.resolve(process.cwd(), output);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${queue.queue_id}.json`);
    fs.writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
    console.log(`Wrote ${queue.items.length} item(s) to ${file}`);

    const drafts = rows.filter((row) => row.status === 'draft');
    if (drafts.length === 0) return;

    if (!process.argv.includes('--write')) {
      console.log(`\nDRY RUN — ${drafts.length} draft(s) not submitted. Re-run with --write.`);
      return;
    }

    await ds.transaction(async (manager) => {
      for (const row of drafts) {
        // The author submits their own work; no reviewer is involved yet.
        await manager.query(
          `UPDATE ${TABLE_OF[row.entityKind]} SET status = 'in_review', updated_at = now()
            WHERE id = $1 AND status = 'draft'`,
          [row.entityId],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, output_hash, evidence_id)
           VALUES ($1,$2,'submitted',$3,$4,$5)`,
          [row.entityKind, row.entityId, row.authoredBy, row.contentSha256, queue.queue_id],
        );
      }
      const entryIds: string[] = (
        await manager.query(
          `SELECT DISTINCT s.dsd_entry_id AS id FROM dsd_senses s WHERE s.batch_id = $1`, [batch],
        )
      ).map((r: any) => r.id);
      await refreshEntryStatuses(manager, entryIds);
    });

    console.log(`Submitted ${drafts.length} draft(s) for review.`);
  } finally {
    await ds.destroy();
  }
}

async function runApply(): Promise<void> {
  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const doc = validateFile(path.resolve(process.cwd(), file));

  const ds = createDsdDataSource('curator', requireConfig());
  await ds.initialize();
  try {
    const rows: ReviewableRow[] = [];
    for (const kind of REVIEWABLE_KINDS) {
      const ids = doc.decisions.filter((d) => d.entity_kind === kind).map((d) => d.entity_id);
      if (ids.length === 0) continue;
      rows.push(
        ...(await ds.query(
          `SELECT '${kind}' AS "entityKind", id AS "entityId",
                  content_sha256 AS "contentSha256", status, authored_by AS "authoredBy"
             FROM ${TABLE_OF[kind]} WHERE id = ANY($1::uuid[])`,
          [ids],
        )),
      );
    }

    const plan = planReviewApply(doc, rows);
    console.log(`  apply    ${plan.toApply.length}`);
    console.log(`  blocked  ${plan.blocked.length}`);
    for (const reason of plan.blocked) console.error(`  - ${reason}`);

    if (plan.blocked.length > 0) {
      console.error('Refusing to apply while any decision is blocked.');
      process.exit(1);
    }

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
      return;
    }

    await ds.transaction(async (manager) => {
      for (const decision of plan.toApply) {
        // reviewed_at comes from the database; a file cannot backdate a review.
        await manager.query(
          `UPDATE ${TABLE_OF[decision.entityKind]}
              SET status = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
            WHERE id = $3 AND status = $4 AND content_sha256 = $5`,
          [
            decision.toStatus, plan.reviewerId, decision.entityId,
            decision.fromStatus, decision.contentSha256,
          ],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, output_hash, evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            decision.entityKind, decision.entityId, decision.event,
            plan.reviewerId, decision.contentSha256, plan.evidenceId,
          ],
        );
      }

      const entryIds: string[] = (
        await manager.query(
          `SELECT DISTINCT s.dsd_entry_id AS id FROM dsd_senses s
            WHERE s.batch_id = $1`,
          [doc.batch_id],
        )
      ).map((r: any) => r.id);
      await refreshEntryStatuses(manager, entryIds);
    });

    console.log(`\nApplied ${plan.toApply.length} decision(s). Nothing is published.`);
  } finally {
    await ds.destroy();
  }
}

const SNAPSHOT_SQL = `
  SELECT s.id, s.sense_key AS "senseKey", s.status, s.content_sha256 AS "contentSha256",
         s.authored_by AS "authoredBy", s.reviewed_by AS "reviewedBy",
         (SELECT json_agg(json_build_object('actor', p.actor, 'outputHash', p.output_hash))
            FROM dsd_provenance_events p
           WHERE p.entity_kind = 'sense' AND p.entity_id = s.id AND p.event_type = 'approved'
         ) AS approvals,
         (SELECT json_agg(json_build_object(
                   'entityKind','translation','entityId',t.id,'status',t.status,
                   'contentSha256',t.content_sha256,'authoredBy',t.authored_by,
                   'reviewedBy',t.reviewed_by,
                   'approvals',(SELECT json_agg(json_build_object('actor',p.actor,'outputHash',p.output_hash))
                                  FROM dsd_provenance_events p
                                 WHERE p.entity_kind='translation' AND p.entity_id=t.id
                                   AND p.event_type='approved')))
            FROM dsd_translations t WHERE t.dsd_sense_id = s.id) AS translations,
         (SELECT json_agg(json_build_object(
                   'entityKind','example','entityId',x.id,'status',x.status,
                   'contentSha256',x.content_sha256,'authoredBy',x.authored_by,
                   'reviewedBy',x.reviewed_by,
                   'approvals',(SELECT json_agg(json_build_object('actor',p.actor,'outputHash',p.output_hash))
                                  FROM dsd_provenance_events p
                                 WHERE p.entity_kind='example' AND p.entity_id=x.id
                                   AND p.event_type='approved')))
            FROM dsd_examples x WHERE x.dsd_sense_id = s.id) AS examples
    FROM dsd_senses s WHERE s.dsd_entry_id = $1 ORDER BY s.sense_order`;

async function runPublish(): Promise<void> {
  const entryId = arg('entry');
  const actor = arg('actor');
  if (!entryId) throw new Error('--entry is required');
  if (!actor) throw new Error('--actor is required — publication is a named decision');

  const publisher = requireRegistries().contributors[actor];
  if (!publisher || publisher.status !== 'active') {
    throw new Error(`'${actor}' is not an active contributor`);
  }
  if (!publisher.roles.some((role) => PUBLISHER_ROLES.includes(role))) {
    throw new Error(`'${actor}' does not hold a publishing role (${PUBLISHER_ROLES.join(', ')})`);
  }

  const ds = createDsdDataSource('curator', requireConfig());
  await ds.initialize();
  try {
    const [entry] = await ds.query(
      `SELECT id, headword, status FROM dsd_entries WHERE id = $1`, [entryId],
    );
    if (!entry) throw new Error(`No DSD entry ${entryId}`);

    const senses = await ds.query(SNAPSHOT_SQL, [entryId]);
    const snapshot: EntrySnapshot = {
      entryId: entry.id,
      headword: entry.headword,
      entryStatus: entry.status,
      senses: senses.map((row: any) => ({
        entityKind: 'sense' as const,
        entityId: row.id,
        senseKey: row.senseKey,
        status: row.status,
        contentSha256: row.contentSha256,
        authoredBy: row.authoredBy,
        reviewedBy: row.reviewedBy,
        approvals: row.approvals ?? [],
        translations: (row.translations ?? []).map((t: any) => ({ ...t, approvals: t.approvals ?? [] })),
        examples: (row.examples ?? []).map((x: any) => ({ ...x, approvals: x.approvals ?? [] })),
      })),
    };

    const blocked = evaluateEntryPublication(snapshot, externalGates());
    if (blocked.length > 0) {
      console.error(`Publication of '${entry.headword}' is blocked:`);
      for (const reason of blocked) console.error(`  - ${reason}`);
      process.exit(1);
    }

    if (!process.argv.includes('--write')) {
      console.log(`All gates pass for '${entry.headword}'.`);
      console.log('\nDRY RUN — nothing published. Re-run with --write.');
      return;
    }

    await ds.transaction(async (manager) => {
      for (const sense of snapshot.senses) {
        for (const record of [sense, ...sense.translations, ...sense.examples]) {
          await manager.query(
            `UPDATE ${TABLE_OF[record.entityKind]}
                SET status = 'published', updated_at = now()
              WHERE id = $1 AND status = 'approved'`,
            [record.entityId],
          );
          await manager.query(
            `INSERT INTO dsd_provenance_events
               (entity_kind, entity_id, event_type, actor, output_hash)
             VALUES ($1,$2,'published',$3,$4)`,
            [record.entityKind, record.entityId, actor, record.contentSha256],
          );
        }
      }
      await refreshEntryStatuses(manager, [entryId]);
      await manager.query(
        `INSERT INTO dsd_provenance_events (entity_kind, entity_id, event_type, actor)
         VALUES ('entry',$1,'published',$2)`,
        [entryId, actor],
      );
    });

    console.log(`Published '${entry.headword}'.`);
  } finally {
    await ds.destroy();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'queue':
      return runQueue();
    case 'validate': {
      const file = arg('file');
      if (!file) throw new Error('--file is required');
      const doc = validateFile(path.resolve(process.cwd(), file));
      console.log(`Valid. ${doc.decisions.length} decision(s) by ${doc.reviewer_id}.`);
      return;
    }
    case 'apply':
      return runApply();
    case 'publish':
      return runPublish();
    default:
      throw new Error('Usage: review.ts <queue|validate|apply|publish> [options]');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
