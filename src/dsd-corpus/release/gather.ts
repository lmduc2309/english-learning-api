/**
 * Gather the facts and run the release audit.
 *
 * Lives in src/ rather than scripts/ so it compiles into dist and the
 * production command runs the same code as the development one — a release gate
 * that differs between environments is not a gate.
 *
 * The split is deliberate: this file collects, dsd-release-audit.ts decides.
 * Every blocker is therefore reproducible from a fixture, including the ones you
 * cannot manufacture on demand — a stale backup proof, a revoked signer key, a
 * superseded similarity policy.
 *
 * It reads as the auditor and writes nothing at all. An audit that could fix
 * what it finds is an audit nobody has to act on, and one that could record its
 * own GO would be marking its own homework.
 *
 * USAGE:
 *   npm run dsd:release:audit -- --release DSD-REL-V1-5000-a1b2c3d4 \
 *     --channel public --territories data/dsd/releases/territories.json
 *   npm run dsd:release:audit -- ... --json --output data/dsd/releases
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { assessReleaseId, buildDsdCorpusConfig } from '../dsd-corpus.config';
import { createDsdDataSource } from '../dsd-corpus.datasource';
import {
  AUDIT_VERSION,
  ReleaseAuditInput,
  ReleaseAuditResult,
  auditRelease,
} from './dsd-release-audit';
import {
  checkCorpus,
  checkDefinition,
  checkExample,
  checkTranslation,
} from '../quality/dsd-quality';
import {
  DEFAULT_POLICY_PATH,
  policyHash,
  validatePolicy,
} from '../similarity/similarity';

dotenv.config();

export const DEFAULT_RESTORE_MAX_AGE_HOURS = 24;

export interface TerritoriesFile {
  /** Where this release is intended to be sold. */
  target: string[];
  /** Where legal has approved selling it. */
  approved: string[];
  approvalEvidenceId: string;
}

export function readTerritories(file: string): TerritoriesFile {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `No territories file at ${resolved}. A release without declared territories cannot be ` +
        'audited: right of publicity and consumer law both vary by jurisdiction.',
    );
  }
  const doc = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return {
    target: doc.target ?? [],
    approved: doc.approved ?? [],
    approvalEvidenceId: doc.approvalEvidenceId ?? '',
  };
}

export function digestFile(file: string): string {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
}

// ─── the queries that gather the facts ──────────────────────────────────────

const ENTRIES_SQL = `
  SELECT e.id AS "entryId", e.headword
    FROM dsd_entries e
   WHERE e.status = 'published'
   ORDER BY e.headword`;

const SENSES_SQL = `
  SELECT s.id AS "senseId", s.dsd_entry_id AS "entryId", s.definition_en AS "definitionEn",
         s.authored_by AS "authoredBy", s.reviewed_by AS "reviewedBy",
         s.content_sha256 AS "contentSha256", s.source_id AS "sourceId",
         (SELECT count(*) FROM dsd_provenance_events pe
           WHERE pe.entity_kind = 'sense' AND pe.entity_id = s.id)::int
           AS "provenanceEventCount",
         (SELECT count(*) FROM dsd_translations t
           WHERE t.dsd_sense_id = s.id AND t.locale = 'vi'
             AND t.status IN ('approved','published'))::int AS "approvedVietnameseCount",
         (SELECT count(*) FROM dsd_examples x
           WHERE x.dsd_sense_id = s.id AND x.status IN ('approved','published'))::int
           AS "approvedExampleCount"
    FROM dsd_senses s
    JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE s.status = 'published' AND e.status = 'published'
   ORDER BY s.sense_order`;

const PRONUNCIATIONS_SQL = `
  SELECT p.id AS "pronunciationId", p.dsd_entry_id AS "entryId", p.accent, p.ipa,
         p.authored_by AS "authoredBy", p.reviewed_by AS "reviewedBy"
    FROM dsd_pronunciations p
    JOIN dsd_entries e ON e.id = p.dsd_entry_id
   WHERE p.status = 'published' AND e.status = 'published'`;

/**
 * A pronunciation whose text equals a machine candidate for the same entry.
 *
 * Not proof of copying on its own, but the one mechanical signal that a
 * generated candidate was accepted verbatim as the final record — which is the
 * failure the two-person IPA review exists to prevent.
 */
const CANDIDATE_MATCH_SQL = `
  SELECT DISTINCT p.id AS "pronunciationId"
    FROM dsd_pronunciations p
    JOIN dsd_ipa_candidates c
      ON c.dsd_entry_id = p.dsd_entry_id
     AND c.accent = p.accent
     AND btrim(c.candidate_ipa) = btrim(p.ipa)
   WHERE p.status = 'published'`;

const AUDIO_SQL = `
  SELECT a.id AS "assetId", a.dsd_entry_id AS "entryId",
         a.engine_voice AS "engineVoice", a.public_voice_id AS "publicVoiceId",
         a.qa_findings AS "qaFindingsJson", a.reviewed_by AS "reviewedBy",
         a.audio_sha256 AS "audioSha256",
         a.training_dataset_status AS "trainingDatasetStatus",
         a.review_status AS "reviewStatus"
    FROM dsd_audio_assets a
    JOIN dsd_entries e ON e.id = a.dsd_entry_id
   WHERE e.status = 'published'`;

const SIMILARITY_SQL = `
  SELECT entity_id AS "entityId", match_class AS "matchClass", decision,
         content_sha256 AS "contentSha256", policy_sha256 AS "policySha256"
    FROM dsd_similarity_results`;

const QUALITY_SQL = {
  definitions: `
    SELECT s.id AS "entityId", e.headword, s.part_of_speech AS "partOfSpeech",
           s.definition_en AS "definitionEn", s.usage_labels AS "usageLabels"
      FROM dsd_senses s JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE s.status = 'published' AND e.status = 'published'`,
  translations: `
    SELECT t.id AS "entityId", e.headword, s.definition_en AS "definitionEn",
           t.locale, t.text
      FROM dsd_translations t
      JOIN dsd_senses s ON s.id = t.dsd_sense_id
      JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE t.status = 'published' AND s.status = 'published' AND e.status = 'published'`,
  examples: `
    SELECT x.id AS "entityId", e.headword, s.part_of_speech AS "partOfSpeech",
           x.example_en AS "exampleEn", x.example_vi AS "exampleVi"
      FROM dsd_examples x
      JOIN dsd_senses s ON s.id = x.dsd_sense_id
      JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE x.status = 'published' AND s.status = 'published' AND e.status = 'published'`,
};

const MIGRATION_SQL = `SELECT max(timestamp)::text AS version FROM dsd_migrations`;

/** Columns actually present on dsd_senses, used to catch a legacy reference. */
const SENSE_COLUMNS_SQL = `
  SELECT column_name FROM information_schema.columns
   WHERE table_name = 'dsd_senses'`;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJsonIfPresent(file: string): any | null {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

export async function runReleaseAudit(): Promise<void> {
  const releaseId = arg('release');
  const channel = arg('channel');
  const territoriesFile = arg('territories');

  if (!releaseId) throw new Error('--release is required');
  if (channel !== 'internal' && channel !== 'public') {
    throw new Error('--channel must be internal or public');
  }
  if (!territoriesFile) throw new Error('--territories is required');

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  const territories = readTerritories(territoriesFile);

  // The similarity policy, and whether it is usable at all.
  const policyDoc = readJsonIfPresent(DEFAULT_POLICY_PATH);
  const policyUsable = policyDoc && validatePolicy(policyDoc).length === 0;
  const similarityPolicy = policyUsable
    ? {
        version: policyDoc.policyVersion,
        sha256: policyHash(policyDoc),
        approvers: policyDoc.approvers ?? [],
      }
    : null;

  // Governance evidence lives in a committed file, so a GO can name it.
  const governance = readJsonIfPresent('data/dsd/releases/governance.json') ?? {};
  const backupProofDoc = readJsonIfPresent('data/dsd/releases/backup-proof.json');
  const signerRegistry = readJsonIfPresent('data/dsd/releases/signer-keys.json') ?? { keys: [] };

  const signerKeyId = arg('signer') ?? process.env.DSD_RELEASE_SIGNER_KEY_ID ?? '';
  const signerEntry = (signerRegistry.keys ?? []).find((key: any) => key.keyId === signerKeyId);

  // Read-only, as the auditor. This command cannot change what it inspects.
  const ds = createDsdDataSource('audit', config);
  await ds.initialize();

  let input: ReleaseAuditInput;
  try {
    const [migration] = await ds.query(MIGRATION_SQL);
    const senseColumns: Array<{ column_name: string }> = await ds.query(SENSE_COLUMNS_SQL);
    const entryRows: Array<{ entryId: string; headword: string }> = await ds.query(ENTRIES_SQL);
    const senseRows: any[] = await ds.query(SENSES_SQL);
    const pronunciationRows: any[] = await ds.query(PRONUNCIATIONS_SQL);
    const candidateMatches: Array<{ pronunciationId: string }> = await ds.query(CANDIDATE_MATCH_SQL);
    const audioRows: any[] = await ds.query(AUDIO_SQL);
    const similarityRows: any[] = await ds.query(SIMILARITY_SQL);

    // Composed here rather than imported from the operator script, so nothing
    // in src depends on scripts and the production build stays free of tooling.
    const definitions = await ds.query(QUALITY_SQL.definitions);
    const translations = await ds.query(QUALITY_SQL.translations);
    const examples = await ds.query(QUALITY_SQL.examples);
    const quality = [
      ...definitions.flatMap(checkDefinition),
      ...translations.flatMap(checkTranslation),
      ...examples.flatMap(checkExample),
      ...checkCorpus({ definitions, examples }),
    ];

    const candidateIds = new Set(candidateMatches.map((row) => row.pronunciationId));
    const columnNames = senseColumns.map((row) => row.column_name);

    input = {
      releaseId,
      channel,
      releaseIdIsPublicEligible: assessReleaseId(releaseId).publicEligible,
      now: new Date().toISOString(),
      snapshot: {
        database: config.database,
        migrationVersion: migration?.version ?? '',
        takenAt: new Date().toISOString(),
      },
      registryDigests: {
        source: digestFile('data/dsd/source-registry.json'),
        tool: digestFile('data/dsd/tool-registry.json'),
        contributor: digestFile('data/dsd/contributor-registry.json'),
      },
      similarityPolicy,
      entries: entryRows.map((entry) => ({
        entryId: entry.entryId,
        headword: entry.headword,
        senses: senseRows
          .filter((sense) => sense.entryId === entry.entryId)
          .map((sense) => ({ ...sense, fields: columnNames })),
        pronunciations: pronunciationRows
          .filter((pronunciation) => pronunciation.entryId === entry.entryId)
          .map((pronunciation) => ({
            ...pronunciation,
            isGeneratedCandidate: candidateIds.has(pronunciation.pronunciationId),
          })),
      })),
      audioAssets: audioRows.map((asset) => ({
        assetId: asset.assetId,
        entryId: asset.entryId,
        engineVoice: asset.engineVoice,
        publicVoiceId: asset.publicVoiceId,
        qaFindings: (asset.qaFindingsJson ?? []).map((finding: any) => finding.rule),
        // The row exists because QA ran; findings are recorded separately.
        qaProof: asset.reviewStatus !== 'pending_qa',
        reviewedBy: asset.reviewedBy,
        audioSha256: asset.audioSha256,
        // Filled by dsd:audio:storage:audit --verify-bytes, whose report is the
        // only evidence the bytes were actually checked.
        objectSha256: readVerifiedObjectHash(asset.audioSha256),
        trainingDatasetStatus: asset.trainingDatasetStatus,
        reviewStatus: asset.reviewStatus,
      })),
      similarityResults: similarityRows,
      qualityFindings: quality.map((finding) => ({
        severity: finding.severity,
        rule: finding.rule,
        entityId: finding.entityId,
      })),
      toolArtifacts: readToolArtifacts(),
      approvedScopesBySource: readApprovedScopes(),
      approvedToolIds: readApprovedTools(),
      contributorRightsEvidence: readContributorRights(),
      governance: {
        cleanRoomDeclarationId: governance.cleanRoomDeclarationId ?? '',
        rightsMatrixApprovalId: governance.rightsMatrixApprovalId ?? '',
        legalSignOffId: governance.legalSignOffId ?? '',
        targetTerritories: territories.target,
        approvedTerritories: territories.approvalEvidenceId ? territories.approved : [],
      },
      backupProof: backupProofDoc
        ? {
            proofId: backupProofDoc.proofId ?? '',
            verifiedAt: backupProofDoc.verifiedAt ?? '',
            offHostCopy: backupProofDoc.offHostCopy === true,
            migrationVersion: backupProofDoc.migrationVersion ?? '',
          }
        : null,
      restoreMaxAgeHours: Number(
        process.env.DSD_RESTORE_MAX_AGE_HOURS ?? DEFAULT_RESTORE_MAX_AGE_HOURS,
      ),
      signer: {
        keyId: signerKeyId,
        registryStatus: signerEntry ? (signerEntry.status ?? 'revoked') : null,
      },
    };
  } finally {
    await ds.destroy();
  }

  const result = auditRelease(input);
  report(result);

  const output = arg('output');
  if (output) {
    const file = path.resolve(
      process.cwd(),
      output,
      `audit-${releaseId}-${result.verdict.toLowerCase()}.json`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    console.log(`\nWrote ${file}`);
  }

  if (result.verdict === 'NO-GO') process.exit(1);
}

function report(result: ReleaseAuditResult): void {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n${result.verdict}  ${result.releaseId}  (${result.channel})`);
  console.log(`audit ${result.auditVersion}`);

  if (result.verdict === 'GO') {
    const record = result.record!;
    console.log(`\n  database        ${record.databaseSnapshot.database} @ ${record.databaseSnapshot.migrationVersion}`);
    console.log(`  similarity      ${record.similarityPolicy.version} ${record.similarityPolicy.sha256.slice(0, 12)}…`);
    console.log(`  backup proof    ${record.backupProofId}`);
    console.log(`  declaration     ${record.cleanRoomDeclarationId}`);
    console.log(`  rights matrix   ${record.rightsMatrixApprovalId}`);
    console.log(`  legal sign-off  ${record.legalSignOffId}`);
    console.log(`  territories     ${record.territories.join(', ')}`);
    console.log(`  signer          ${record.signerKeyId}`);
    console.log(`  content         ${record.entryCount} entries, ${record.senseCount} senses, ${record.audioAssetCount} audio`);
    return;
  }

  console.log(`\n${result.blockers.length} blocker(s):`);
  const byCode = new Map<string, string[]>();
  for (const blocker of result.blockers) {
    byCode.set(blocker.code, [...(byCode.get(blocker.code) ?? []), blocker.detail]);
  }
  for (const [code, details] of [...byCode].sort()) {
    console.error(`\n  ${code} (${details.length})`);
    for (const detail of details.slice(0, 5)) console.error(`    - ${detail}`);
    if (details.length > 5) console.error(`    … and ${details.length - 5} more`);
  }
}

// ─── registry and evidence readers ──────────────────────────────────────────

function readApprovedScopes(): Record<string, string[]> {
  const registry = readJsonIfPresent('data/dsd/source-registry.json') ?? { sources: [] };
  const scopes: Record<string, string[]> = {};
  for (const source of registry.sources ?? []) {
    if (source.status === 'approved') scopes[source.id] = source.approvedScopes ?? [];
  }
  return scopes;
}

function readApprovedTools(): string[] {
  const registry = readJsonIfPresent('data/dsd/tool-registry.json') ?? { tools: [] };
  return (registry.tools ?? [])
    .filter((tool: any) => tool.status === 'approved')
    .map((tool: any) => tool.id);
}

function readContributorRights(): Record<string, string> {
  const registry = readJsonIfPresent('data/dsd/contributor-registry.json') ?? { contributors: [] };
  const evidence: Record<string, string> = {};
  for (const contributor of registry.contributors ?? []) {
    if (contributor.status === 'active' && contributor.rightsEvidenceId) {
      evidence[contributor.id] = contributor.rightsEvidenceId;
    }
  }
  return evidence;
}

/**
 * Tool locks, and whether their artifacts are pinned.
 *
 * A lock with a null artifact digest is mutable by definition: the revision says
 * what the source was, not what ran.
 */
function readToolArtifacts() {
  const locks = ['data/dsd/tools/misaki.lock.json', 'data/dsd/tools/phonetic-matching.lock.json'];
  return locks
    .map((file) => readJsonIfPresent(file))
    .filter(Boolean)
    .map((lock: any) => ({
      toolId: lock.toolId,
      revision: lock.revision ?? '',
      artifactSha256: lock.artifactSha256 ?? null,
      mutable: !lock.artifactSha256,
    }));
}

/**
 * The verified object hash for an asset, from the storage audit's report.
 *
 * Absent means the bytes were never re-hashed, which the audit treats as a
 * blocker rather than assuming they are fine.
 */
function readVerifiedObjectHash(audioSha256: string | null): string | null {
  if (!audioSha256) return null;
  const report = readJsonIfPresent('data/dsd/releases/storage-verification.json');
  if (!report) return null;
  return report.verifiedHashes?.[audioSha256] ?? null;
}

export { AUDIT_VERSION };
