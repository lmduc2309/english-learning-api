/**
 * The compliance-only legacy similarity audit.
 *
 * This is the single DSD command permitted to open both data sources, and it
 * is built on the assumption that it is the most dangerous code in the system.
 * Everything below is arranged so that the dangerous direction — legacy text
 * flowing into DSD — cannot happen:
 *
 *   - The legacy connection uses dsd_similarity_reader, which can read one
 *     view of English text and nothing else. The audit verifies that at
 *     startup and refuses to run otherwise, so a mistakenly over-granted role
 *     stops the audit rather than widening it.
 *   - The legacy connection is checked to have no write privilege anywhere.
 *   - The DSD connection uses dsd_auditor, which cannot edit authored content.
 *     An audit that could rewrite what it judges is not an audit.
 *   - What crosses from legacy into DSD is a set of numbers and a digest. The
 *     matched wording is held in memory for the length of one comparison and
 *     is never written, logged or printed.
 *
 * Author-facing output is one of three words. A compliance reviewer may look
 * at the matched legacy wording through the view; an author never does,
 * because an author who has seen it can no longer claim their rewrite was
 * reached independently.
 *
 * USAGE:
 *   npm run dsd:similarity:audit -- --policy data/dsd/similarity/v1-policy.json --auditor DSD-C-001
 *   npm run dsd:similarity:audit -- --policy … --auditor … --batch B-001 --write
 *   npm run dsd:similarity:report -- --batch B-001
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import {
  ALGORITHM_VERSION,
  ComponentScores,
  MatchClass,
  NORMALIZATION_VERSION,
  RecordType,
  SimilarityDecision,
  SimilarityPolicy,
  authorFacingState,
  classify,
  compare,
  initialDecision,
  legacyDigest,
  permitsPublication,
  policyHash,
  validatePolicy,
} from './lib/similarity';
import { loadRegistries, snapshotRegistries } from './lib/registry';

dotenv.config();

export const LEGACY_READER_ROLE = 'dsd_similarity_reader';
export const DSD_AUDIT_ROLE = 'dsd_auditor';
/** The only relation the legacy account may read. */
export const LEGACY_AUDIT_VIEW = 'dsd_compliance.english_similarity_input';

export interface BoundaryProbe {
  currentUser: string;
  /** Privileges other than SELECT held anywhere by the current user. */
  writePrivileges: string[];
  /** Base tables the current user can SELECT, outside the audit view. */
  readableBaseTables: string[];
}

/**
 * Refuse to run unless both accounts are exactly as narrow as they should be.
 *
 * Checked at every run rather than trusted from provisioning: privileges drift,
 * and the moment they drift is the moment this command becomes an exfiltration
 * path rather than an audit.
 */
export function assertAuditBoundary(legacy: BoundaryProbe, dsd: BoundaryProbe): string[] {
  const errors: string[] = [];

  if (legacy.currentUser !== LEGACY_READER_ROLE) {
    errors.push(
      `legacy connection is '${legacy.currentUser}', not ${LEGACY_READER_ROLE}; ` +
        'the audit will not run under a broader account',
    );
  }
  if (legacy.writePrivileges.length > 0) {
    errors.push(
      `legacy account can write (${legacy.writePrivileges.join(', ')}); the audit never writes to legacy`,
    );
  }
  if (legacy.readableBaseTables.length > 0) {
    errors.push(
      `legacy account can read base table(s): ${legacy.readableBaseTables.join(', ')}; ` +
        `it must see only ${LEGACY_AUDIT_VIEW}`,
    );
  }

  if (dsd.currentUser !== DSD_AUDIT_ROLE) {
    errors.push(`DSD connection is '${dsd.currentUser}', not ${DSD_AUDIT_ROLE}`);
  }
  if (dsd.writePrivileges.length > 0) {
    errors.push(
      `DSD account can edit authored content (${dsd.writePrivileges.join(', ')}); ` +
        'the auditor records verdicts, it does not fix findings',
    );
  }

  return errors;
}

// ─── comparison ─────────────────────────────────────────────────────────────

export interface DsdRecord {
  entityKind: 'sense' | 'example';
  entityId: string;
  recordType: RecordType;
  contentSha256: string;
  text: string;
}

export interface SimilarityResult {
  entityKind: 'sense' | 'example';
  entityId: string;
  recordType: RecordType;
  contentSha256: string;
  normalizationVersion: number;
  algorithmVersion: number;
  policyVersion: string;
  policySha256: string;
  componentScores: ComponentScores;
  matchClass: MatchClass;
  legacyDigest: string | null;
  decision: SimilarityDecision;
}

/**
 * Compare one DSD record against every candidate and keep the worst match.
 *
 * Worst, not first: a record that is 40% similar to a hundred rows and 96%
 * similar to one has a copying problem, and averaging would hide it.
 */
export function auditRecord(
  record: DsdRecord,
  candidates: string[],
  policy: SimilarityPolicy,
): SimilarityResult {
  const severity: Record<MatchClass, number> = { low: 0, medium: 1, high: 2, exact: 3 };

  let worstScores = compare(record.text, '');
  let worstClass: MatchClass = 'low';
  let worstDigest: string | null = null;

  for (const candidate of candidates) {
    const scores = compare(record.text, candidate);
    const matchClass = classify(scores, record.recordType, policy);
    if (severity[matchClass] > severity[worstClass] ||
        (matchClass === worstClass && scores.cosine > worstScores.cosine)) {
      worstScores = scores;
      worstClass = matchClass;
      // Only ever the digest. The candidate text stops here.
      worstDigest = legacyDigest(candidate);
    }
  }

  return {
    entityKind: record.entityKind,
    entityId: record.entityId,
    recordType: record.recordType,
    contentSha256: record.contentSha256,
    normalizationVersion: NORMALIZATION_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    policyVersion: policy.policyVersion,
    policySha256: policyHash(policy),
    componentScores: worstScores,
    matchClass: worstClass,
    legacyDigest: worstClass === 'low' ? null : worstDigest,
    decision: initialDecision(worstClass),
  };
}

/** What an author is told. Three words, no scores, no wording. */
export function authorReport(results: SimilarityResult[]): Array<{
  entityId: string;
  state: 'clear' | 'manual_review' | 'rewrite_required';
}> {
  return results.map((result) => ({
    entityId: result.entityId,
    state: authorFacingState(result.matchClass, result.decision),
  }));
}

// ─── publication gate ───────────────────────────────────────────────────────

export interface StoredResult {
  entityKind: string;
  entityId: string;
  contentSha256: string;
  policySha256: string;
  matchClass: MatchClass;
  decision: SimilarityDecision;
}

/**
 * Whether every record about to be published has a current, permitting result.
 *
 * Absence is a block, not a pass: no result for the current content and policy
 * means either the text changed after the audit or the policy did, and in both
 * cases nobody has checked what is actually going out.
 */
export function evaluateSimilarityGate(
  records: Array<{ entityKind: string; entityId: string; contentSha256: string }>,
  stored: StoredResult[],
  currentPolicySha256: string,
): { status: 'pass' | 'fail' | 'not_run'; detail: string } {
  const byKey = new Map(
    stored
      .filter((result) => result.policySha256 === currentPolicySha256)
      .map((result) => [`${result.entityKind} ${result.entityId} ${result.contentSha256}`, result]),
  );

  const missing: string[] = [];
  const blocked: string[] = [];

  for (const record of records) {
    const result = byKey.get(`${record.entityKind} ${record.entityId} ${record.contentSha256}`);
    if (!result) {
      missing.push(record.entityId);
      continue;
    }
    if (!permitsPublication(result.matchClass, result.decision)) {
      blocked.push(`${record.entityId} is ${result.matchClass}/${result.decision}`);
    }
  }

  if (missing.length > 0) {
    return {
      status: 'not_run',
      detail: `no current audit for ${missing.length} record(s): ${missing.slice(0, 5).join(', ')}`,
    };
  }
  if (blocked.length > 0) {
    return { status: 'fail', detail: blocked.join('; ') };
  }
  return { status: 'pass', detail: `${records.length} record(s) cleared` };
}

// ─── policy loading ─────────────────────────────────────────────────────────

export function loadPolicy(file: string): SimilarityPolicy {
  const policy: SimilarityPolicy = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validatePolicy(policy);
  if (errors.length > 0) {
    throw new Error(`Similarity policy is invalid:\n  - ${errors.join('\n  - ')}`);
  }
  return policy;
}

export const DEFAULT_POLICY_PATH = 'data/dsd/similarity/v1-policy.json';

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function probeLegacy(client: Client): Promise<BoundaryProbe> {
  const { rows: user } = await client.query<{ current_user: string }>('SELECT current_user');
  const { rows: writes } = await client.query<{ label: string }>(
    `SELECT DISTINCT table_schema || '.' || table_name || ':' || privilege_type AS label
       FROM information_schema.role_table_grants
      WHERE grantee = current_user AND privilege_type <> 'SELECT'`,
  );
  // Anything readable that is not the audit view. A view is not a base table,
  // so this is exactly the set that must be empty.
  const { rows: reads } = await client.query<{ label: string }>(
    `SELECT c.relnamespace::regnamespace || '.' || c.relname AS label
       FROM pg_class c
      WHERE c.relkind IN ('r','p','f')
        AND c.relnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema')
        AND has_table_privilege(current_user, c.oid, 'SELECT')`,
  );
  return {
    currentUser: user[0].current_user,
    writePrivileges: writes.map((r) => r.label),
    readableBaseTables: reads.map((r) => r.label),
  };
}

async function probeDsd(query: (sql: string) => Promise<any[]>): Promise<BoundaryProbe> {
  const [user] = await query('SELECT current_user');
  const writes = await query(
    `SELECT relname || ':' || priv AS label
       FROM pg_class c, unnest(ARRAY['INSERT','UPDATE','DELETE']) AS priv
      WHERE c.relname IN ('dsd_entries','dsd_senses','dsd_translations','dsd_examples','dsd_pronunciations')
        AND has_table_privilege(current_user, c.oid, priv)`,
  );
  return {
    currentUser: user.current_user,
    writePrivileges: writes.map((r: any) => r.label),
    readableBaseTables: [],
  };
}

const DSD_RECORDS_SQL = `
  SELECT 'sense' AS "entityKind", s.id AS "entityId", 'definition' AS "recordType",
         s.content_sha256 AS "contentSha256", s.definition_en AS text
    FROM dsd_senses s
   WHERE s.status <> 'rejected' AND ($1::varchar IS NULL OR s.batch_id = $1)
  UNION ALL
  SELECT 'example', x.id, 'example', x.content_sha256, x.example_en
    FROM dsd_examples x
   WHERE x.status <> 'rejected' AND ($1::varchar IS NULL OR x.batch_id = $1)`;

/**
 * English only. Legacy Vietnamese has no licence and is never read here — not
 * to compare, not to digest, not at all.
 */
const LEGACY_CANDIDATES_SQL = `
  SELECT content_en AS text
    FROM ${LEGACY_AUDIT_VIEW}
   WHERE record_kind = $1`;

export type ManualSimilarityDecision =
  | 'rewrite_required'
  | 'independently_authored_cleared';

const DECISION_REASONS: Record<ManualSimilarityDecision, string> = {
  rewrite_required: 'rewrite_required_by_compliance',
  independently_authored_cleared: 'independent_process_evidence',
};

export function validateDecisionRequest(input: {
  entityId: string;
  decision: string;
  reviewer: string;
  reason: string;
  evidenceId: string;
  contributor?: { status: string; roles: string[]; rightsEvidenceId: string };
}): string[] {
  const errors: string[] = [];
  if (!/^[0-9a-f-]{36}$/i.test(input.entityId)) errors.push('entity must be a DSD UUID');
  if (!(input.decision in DECISION_REASONS)) {
    errors.push('decision must be rewrite_required or independently_authored_cleared');
  } else if (input.reason !== DECISION_REASONS[input.decision as ManualSimilarityDecision]) {
    errors.push(
      `reason for ${input.decision} must be '${DECISION_REASONS[input.decision as ManualSimilarityDecision]}'`,
    );
  }
  if (!input.evidenceId.trim()) errors.push('an external decision evidence id is required');
  if (!input.contributor || input.contributor.status !== 'active') {
    errors.push(`reviewer '${input.reviewer}' is not active in the contributor registry`);
  } else {
    if (!input.contributor.roles.includes('compliance_reviewer')) {
      errors.push(`reviewer '${input.reviewer}' does not have the compliance_reviewer role`);
    }
    if (!input.contributor.rightsEvidenceId) {
      errors.push(`reviewer '${input.reviewer}' has no IP-assignment evidence`);
    }
  }
  return errors;
}

async function decide(
  ds: ReturnType<typeof createDsdDataSource>,
  currentPolicySha256: string,
): Promise<void> {
  const entityId = arg('entity') ?? '';
  const decision = arg('decision') ?? '';
  const reviewer = arg('reviewer') ?? '';
  const reason = arg('reason') ?? '';
  const evidenceId = arg('evidence') ?? '';
  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    throw new Error(`DSD registries are invalid:\n  - ${loaded.errors.join('\n  - ')}`);
  }
  const registry = snapshotRegistries(loaded);
  const errors = validateDecisionRequest({
    entityId,
    decision,
    reviewer,
    reason,
    evidenceId,
    contributor: registry.contributors[reviewer],
  });
  if (errors.length > 0) {
    throw new Error(`Invalid compliance decision:\n  - ${errors.join('\n  - ')}`);
  }
  if (!process.argv.includes('--write')) {
    console.log('DRY RUN — decision is valid but was not recorded. Re-run with --write.');
    return;
  }

  const rows = await ds.query(
    `UPDATE dsd_similarity_results result
        SET decision = $2, decision_reason = $3, decision_evidence_id = $4,
            decided_by = $5, decided_at = now()
      WHERE result.entity_id = $1::uuid
        AND result.policy_sha256 = $6
        AND result.content_sha256 = CASE result.entity_kind
          WHEN 'sense' THEN (SELECT content_sha256 FROM dsd_senses WHERE id = result.entity_id)
          WHEN 'example' THEN (SELECT content_sha256 FROM dsd_examples WHERE id = result.entity_id)
        END
        AND result.decision = 'manual_review'
      RETURNING result.entity_id AS "entityId", result.match_class AS "matchClass"`,
    [entityId, decision, reason, evidenceId, reviewer, currentPolicySha256],
  );
  if (rows.length !== 1) {
    throw new Error(
      'No current manual-review result was updated. The content/policy may be stale, ' +
        'the result may already be decided, or the entity may not exist.',
    );
  }
  console.log(`Recorded ${decision} for ${entityId} (${rows[0].matchClass}).`);
}

async function main(): Promise<void> {
  const command = ['report', 'decide'].includes(process.argv[2]) ? process.argv[2] : 'audit';
  const auditor = arg('auditor');
  const policyPath = path.resolve(process.cwd(), arg('policy') ?? DEFAULT_POLICY_PATH);

  if (!fs.existsSync(policyPath)) {
    throw new Error(
      `No similarity policy at ${policyPath}. The policy is frozen and approved in Task 8A; ` +
        'without it there are no thresholds and no audit.',
    );
  }
  const policy = loadPolicy(policyPath);

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  const ds = createDsdDataSource('audit', config);
  await ds.initialize();

  if (command === 'decide') {
    try {
      await decide(ds, policyHash(policy));
    } finally {
      await ds.destroy();
    }
    return;
  }

  if (command === 'report') {
    try {
      const rows = await ds.query(
        `SELECT entity_id AS "entityId", match_class AS "matchClass", decision
           FROM dsd_similarity_results ORDER BY match_class, entity_id`,
      );
      for (const row of rows) {
        console.log(`  ${row.entityId}  ${authorFacingState(row.matchClass, row.decision)}`);
      }
      console.log(`\n${rows.length} result(s). Scores and matched wording are not shown here.`);
    } finally {
      await ds.destroy();
    }
    return;
  }

  if (!auditor) throw new Error('--auditor is required — a measurement is attributable');

  const legacyUrl = process.env.LEGACY_AUDIT_DATABASE_URL;
  if (!legacyUrl) {
    throw new Error(
      'LEGACY_AUDIT_DATABASE_URL is required and must use the dsd_similarity_reader role',
    );
  }

  const legacy = new Client({ connectionString: legacyUrl });
  await legacy.connect();

  try {
    const errors = assertAuditBoundary(await probeLegacy(legacy), await probeDsd((sql) => ds.query(sql)));
    if (errors.length > 0) {
      console.error('Refusing to run: the audit boundary is not intact.');
      for (const error of errors) console.error(`  - ${error}`);
      process.exit(1);
    }

    const records: DsdRecord[] = await ds.query(DSD_RECORDS_SQL, [arg('batch') ?? null]);
    if (records.length === 0) {
      console.log('No DSD content to audit.');
      return;
    }

    const candidates: Record<RecordType, string[]> = {
      definition: (await legacy.query<{ text: string }>(LEGACY_CANDIDATES_SQL, ['definition'])).rows.map((r) => r.text),
      example: (await legacy.query<{ text: string }>(LEGACY_CANDIDATES_SQL, ['example'])).rows.map((r) => r.text),
    };

    const results = records.map((record) => auditRecord(record, candidates[record.recordType], policy));
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.matchClass] = (acc[r.matchClass] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`Audited ${results.length} record(s) against policy ${policy.policyVersion}.`);
    for (const matchClass of ['exact', 'high', 'medium', 'low']) {
      if (counts[matchClass]) console.log(`  ${matchClass.padEnd(8)} ${counts[matchClass]}`);
    }

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing recorded. Re-run with --write.');
      return;
    }

    for (const result of results) {
      await ds.query(
        `INSERT INTO dsd_similarity_results
           (entity_kind, entity_id, record_type, content_sha256, normalization_version,
            algorithm_version, policy_version, policy_sha256, component_scores,
            match_class, legacy_digest, decision, audited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
         ON CONFLICT ON CONSTRAINT "UQ_dsd_similarity_content_policy" DO NOTHING`,
        [
          result.entityKind, result.entityId, result.recordType, result.contentSha256,
          result.normalizationVersion, result.algorithmVersion, result.policyVersion,
          result.policySha256, JSON.stringify(result.componentScores), result.matchClass,
          result.legacyDigest, result.decision, auditor,
        ],
      );
    }

    console.log(`\nRecorded ${results.length} result(s).`);
  } finally {
    // Closed in every path. The legacy connection is open for as short a time
    // as the comparison needs.
    await legacy.end();
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
