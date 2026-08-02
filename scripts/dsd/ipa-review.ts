/**
 * Human authorship and approval of DSD pronunciations.
 *
 * The rule this file exists to enforce is that provenance tells the truth. A
 * pronunciation informed by a tool must say so, listing every candidate that
 * existed for it at the time — not the convenient subset. Relabelling
 * tool-assisted work as human-only is the one failure mode that would make the
 * whole IPA chain worthless, and it is the easiest to commit by omission, so
 * the importer compares the declared list against the candidates actually in
 * the database and refuses any mismatch.
 *
 * Everything else follows the pattern already established: the file is
 * validated without a database, the importer writes drafts, and the schema
 * refuses an approval whose author and reviewer are the same person.
 *
 * USAGE:
 *   npm run dsd:ipa:review -- --file data/dsd/ipa/pilot-001.json
 *   npm run dsd:ipa:review -- --file data/dsd/ipa/pilot-001.json --write
 *   npm run dsd:ipa:audit
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { RegistrySnapshot, loadRegistries, snapshotRegistries } from './lib/registry';
import { escalationReasons, normalizeIpa, validateIpa } from './lib/ipa';
import { pronunciationHash } from './lib/content-hash';

dotenv.config();

/** Sources a published pronunciation may never name. */
export const FORBIDDEN_IPA_SOURCES = [
  'espeak', 'espeak-ng', 'phonemizer', 'wiktionary-en', 'legacy-dictionary-corpus',
  'tudien-archive', 'cmudict', 'oewn-2025',
];

const FORBIDDEN_RECORD_FIELDS = [
  'status', 'published_at', 'word_id', 'pronunciation_id', 'legacy_id',
  'provider', 'model', 'prompt',
] as const;

const RECORD_KEYS = [
  'dsd_entry_id', 'accent', 'ipa', 'priority', 'authored_by', 'reviewed_by',
  'review_notes', 'source_id', 'rights_evidence_id', 'informed_by',
  'escalations_acknowledged',
];
const FILE_KEYS = ['$schema', 'review_version', 'batch_id', 'evidence_id', 'records'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IpaReviewRecord {
  dsd_entry_id: string;
  accent: string;
  ipa: string;
  priority: number;
  authored_by: string;
  reviewed_by: string;
  review_notes: string;
  source_id: string;
  rights_evidence_id: string;
  /** Every candidate that informed this decision. Omission is the failure. */
  informed_by: Array<{ tool_id: string; tool_revision: string; candidate_id: string }>;
  escalations_acknowledged?: string[];
}

export interface IpaReviewFile {
  review_version: number;
  batch_id: string;
  evidence_id: string;
  records: IpaReviewRecord[];
}

function checkKeys(value: unknown, allowed: string[], where: string, errors: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if ((FORBIDDEN_RECORD_FIELDS as readonly string[]).includes(key)) {
      errors.push(`${where}: forbidden field '${key}'`);
    } else if (!allowed.includes(key)) {
      errors.push(`${where}: unknown field '${key}'`);
    }
  }
}

function checkPerson(
  id: string,
  role: string,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  const contributor = registry.contributors[(id ?? '').trim()];
  if (!contributor) {
    errors.push(`${where}: ${role} '${id}' is not in the contributor registry`);
    return;
  }
  if (contributor.status !== 'active') {
    errors.push(`${where}: ${role} '${id}' is not active`);
  }
}

/** Pure. Runs on a laptop against a JSON file; opens no connection. */
export function validateIpaReviewFile(doc: IpaReviewFile, registry: RegistrySnapshot): string[] {
  const errors: string[] = [];
  checkKeys(doc, FILE_KEYS, 'review', errors);

  if (doc.review_version !== 1) errors.push('review: review_version must be 1');
  if (!(doc.batch_id ?? '').trim()) errors.push('review: batch_id is required');
  if (!(doc.evidence_id ?? '').trim()) errors.push('review: evidence_id is required');

  const records = Array.isArray(doc.records) ? doc.records : [];
  if (records.length === 0) errors.push('review: records is empty');

  const seen = new Set<string>();
  records.forEach((record, index) => {
    const where = `record ${index + 1}`;
    checkKeys(record, RECORD_KEYS, where, errors);

    if (!UUID_RE.test((record.dsd_entry_id ?? '').trim())) {
      errors.push(`${where}: dsd_entry_id is not a UUID`);
    }
    const key = `${record.dsd_entry_id} ${record.accent} ${record.priority}`;
    if (seen.has(key)) errors.push(`${where}: duplicates an earlier record`);
    seen.add(key);

    errors.push(...validateIpa(record.ipa, record.accent).map((e) => `${where}: ${e}`));

    if (!Number.isInteger(record.priority) || record.priority <= 0) {
      errors.push(`${where}: priority must be a positive integer`);
    }
    if (!(record.review_notes ?? '').trim()) {
      errors.push(`${where}: review_notes are required — an approval with no reasoning is a rubber stamp`);
    }

    checkPerson(record.authored_by, 'author', where, registry, errors);
    checkPerson(record.reviewed_by, 'reviewer', where, registry, errors);
    if (record.authored_by && record.authored_by === record.reviewed_by) {
      errors.push(`${where}: ${record.authored_by} cannot approve their own transcription`);
    }

    if (FORBIDDEN_IPA_SOURCES.includes((record.source_id ?? '').trim())) {
      errors.push(
        `${where}: source '${record.source_id}' is never a content source for a DSD pronunciation`,
      );
    }
    const approved = registry.approvedScopesBySource[(record.source_id ?? '').trim()];
    if (!approved || !approved.includes('pronunciation')) {
      errors.push(`${where}: source '${record.source_id}' is not approved for scope 'pronunciation'`);
    }

    if (!Array.isArray(record.informed_by)) {
      errors.push(`${where}: informed_by must be present, even when empty`);
    } else {
      for (const tool of record.informed_by) {
        if (!tool.tool_id || !tool.tool_revision || !UUID_RE.test(tool.candidate_id ?? '')) {
          errors.push(`${where}: informed_by entries need tool_id, tool_revision and candidate_id`);
        }
      }
    }
  });

  return errors;
}

export interface CandidateRow {
  candidateId: string;
  entryId: string;
  accent: string;
  toolId: string;
  toolRevision: string;
  ipa: string;
}

export interface EntryFacts {
  entryId: string;
  headword: string;
  partsOfSpeech: string[];
}

export interface IpaPlanRow {
  entryId: string;
  accent: string;
  ipa: string;
  priority: number;
  authoredBy: string;
  reviewedBy: string;
  sourceId: string;
  rightsEvidenceId: string;
  contentSha256: string;
  informedBy: CandidateRow[];
  status: 'draft';
}

export interface IpaPlan {
  toInsert: IpaPlanRow[];
  blocked: string[];
}

export function ipaContentHash(input: { accent: string; ipa: string }): string {
  return pronunciationHash({ accent: input.accent, ipa: normalizeIpa(input.ipa) });
}

/**
 * Check each record against what the database actually holds.
 *
 * Two things are verified that a file cannot verify about itself: that every
 * candidate which existed is declared, and that every escalation the tools
 * raised has been acknowledged by name.
 */
export function planIpaReview(
  doc: IpaReviewFile,
  candidates: CandidateRow[],
  entries: EntryFacts[],
): IpaPlan {
  const plan: IpaPlan = { toInsert: [], blocked: [] };
  const byEntry = new Map(entries.map((e) => [e.entryId, e]));

  for (const [index, record] of (doc.records ?? []).entries()) {
    const where = `record ${index + 1} (${record.dsd_entry_id})`;
    const entry = byEntry.get(record.dsd_entry_id);
    if (!entry) {
      plan.blocked.push(`${where}: no such DSD entry`);
      continue;
    }

    const existing = candidates.filter(
      (c) => c.entryId === record.dsd_entry_id && c.accent === record.accent,
    );
    const declared = new Set((record.informed_by ?? []).map((t) => t.candidate_id));
    const undeclared = existing.filter((c) => !declared.has(c.candidateId));
    if (undeclared.length > 0) {
      // The failure this whole file exists to prevent: a tool-assisted record
      // presented as human-only by leaving the tool off the list.
      plan.blocked.push(
        `${where}: ${undeclared.length} candidate(s) exist but are not declared in informed_by ` +
          `(${undeclared.map((c) => c.toolId).join(', ')}); provenance must name every tool that informed the decision`,
      );
      continue;
    }
    const invented = [...declared].filter((id) => !existing.some((c) => c.candidateId === id));
    if (invented.length > 0) {
      plan.blocked.push(`${where}: informed_by names candidate(s) that do not exist: ${invented.join(', ')}`);
      continue;
    }

    const reasons = escalationReasons({
      headword: entry.headword,
      partsOfSpeech: entry.partsOfSpeech,
      candidates: existing.map((c) => ({ toolId: c.toolId, ipa: c.ipa })),
      comparisonAvailable: existing.length >= 2,
    });
    const acknowledged = new Set(record.escalations_acknowledged ?? []);
    const unacknowledged = reasons.filter((reason) => !acknowledged.has(reason));
    if (unacknowledged.length > 0) {
      plan.blocked.push(
        `${where}: unacknowledged escalation(s): ${unacknowledged.join('; ')}`,
      );
      continue;
    }

    plan.toInsert.push({
      entryId: record.dsd_entry_id,
      accent: record.accent,
      ipa: normalizeIpa(record.ipa),
      priority: record.priority,
      authoredBy: record.authored_by,
      reviewedBy: record.reviewed_by,
      sourceId: record.source_id,
      rightsEvidenceId: record.rights_evidence_id,
      contentSha256: ipaContentHash(record),
      informedBy: existing,
      // Draft, like every other import. Approval is a review decision.
      status: 'draft',
    });
  }

  return plan;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2] === 'audit' ? 'audit' : 'review';

  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    throw new Error('Registry validation failed:\n  - ' + loaded.errors.join('\n  - '));
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  if (command === 'audit') {
    const ds = createDsdDataSource('audit', config);
    await ds.initialize();
    try {
      const rows = await ds.query(
        `SELECT p.id, p.accent, p.status, p.source_id AS "sourceId",
                p.authored_by AS "authoredBy", p.reviewed_by AS "reviewedBy"
           FROM dsd_pronunciations p WHERE p.status IN ('approved','published')`,
      );
      const problems: string[] = [];
      for (const row of rows) {
        if (FORBIDDEN_IPA_SOURCES.includes(row.sourceId)) {
          problems.push(`${row.id}: source '${row.sourceId}' is never a content source`);
        }
        if (!row.reviewedBy || row.reviewedBy === row.authoredBy) {
          problems.push(`${row.id}: author and reviewer are the same person`);
        }
      }
      console.log(`${rows.length} approved or published pronunciation(s).`);
      for (const problem of problems) console.error(`  - ${problem}`);
      if (problems.length > 0) process.exit(1);
      console.log('No findings.');
    } finally {
      await ds.destroy();
    }
    return;
  }

  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const resolved = path.resolve(process.cwd(), file);
  const doc: IpaReviewFile = JSON.parse(fs.readFileSync(resolved, 'utf8'));

  const errors = validateIpaReviewFile(doc, snapshotRegistries(loaded));
  if (errors.length > 0) {
    console.error(`${errors.length} validation error(s) in ${file}:`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    process.exit(1);
  }

  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    const entryIds = doc.records.map((r) => r.dsd_entry_id);
    const entries: EntryFacts[] = await ds.query(
      `SELECT e.id AS "entryId", e.headword,
              COALESCE(array_agg(DISTINCT s.part_of_speech) FILTER (WHERE s.id IS NOT NULL), '{}') AS "partsOfSpeech"
         FROM dsd_entries e LEFT JOIN dsd_senses s ON s.dsd_entry_id = e.id
        WHERE e.id = ANY($1::uuid[]) GROUP BY e.id, e.headword`,
      [entryIds],
    );
    const candidates: CandidateRow[] = await ds.query(
      `SELECT id AS "candidateId", dsd_entry_id AS "entryId", accent,
              tool_id AS "toolId", tool_revision AS "toolRevision", candidate_ipa AS ipa
         FROM dsd_ipa_candidates
        WHERE dsd_entry_id = ANY($1::uuid[]) AND status = 'candidate'`,
      [entryIds],
    );

    const plan = planIpaReview(doc, candidates, entries);
    console.log(`  insert   ${plan.toInsert.length}`);
    console.log(`  blocked  ${plan.blocked.length}`);
    for (const reason of plan.blocked) console.error(`  - ${reason}`);
    if (plan.blocked.length > 0) {
      console.error('Refusing to import while any record is blocked.');
      process.exit(1);
    }

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing written. Re-run with --write.');
      return;
    }

    await ds.transaction(async (manager) => {
      for (const row of plan.toInsert) {
        const [inserted] = await manager.query(
          `INSERT INTO dsd_pronunciations
             (dsd_entry_id, accent, ipa, priority, authored_by, content_sha256,
              source_id, batch_id, rights_evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            row.entryId, row.accent, row.ipa, row.priority, row.authoredBy,
            row.contentSha256, row.sourceId, doc.batch_id, row.rightsEvidenceId,
          ],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, output_hash, evidence_id)
           VALUES ('pronunciation',$1,'authored',$2,$3,$4)`,
          [inserted.id, row.authoredBy, row.contentSha256, doc.evidence_id],
        );
        // One event per tool that informed the decision. The ledger says a
        // tool was involved even though the wording is a person's.
        // tool_id is varchar(64); a 40-character SHA plus a tool name does not
        // fit, and twelve hex characters identify a commit unambiguously.
        for (const tool of row.informedBy) {
          await manager.query(
            `INSERT INTO dsd_provenance_events
               (entity_kind, entity_id, event_type, actor, tool_id, input_hash, evidence_id)
             VALUES ('pronunciation',$1,'generated',$2,$3,$4,$5)`,
            [inserted.id, row.authoredBy, `${tool.toolId}@${tool.toolRevision.slice(0, 12)}`, row.contentSha256, doc.evidence_id],
          );
        }
      }
    });

    console.log(`\nImported ${plan.toInsert.length} pronunciation(s) as drafts.`);
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
