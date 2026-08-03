/**
 * Audit generated audio: what is servable, what is blocked, and why.
 *
 * The question this answers is the release question — can this audio go out? —
 * and it answers it by refusing to assume anything. An asset is servable only
 * with all four of a clean QA result, approved voice rights, an individual
 * human listening decision, and no quarantined conflict. Missing any one is
 * reported, not rounded down.
 *
 * Reads only. The auditor role cannot edit an asset, so a finding here has to be
 * acted on somewhere else.
 *
 * USAGE:
 *   npm run dsd:audio:audit
 *   npm run dsd:audio:audit -- --json
 */
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { AudioFinding, findDuplicateAudio } from './lib/audio-qa';
import { parseStorageKey } from './lib/audio-key';

dotenv.config();

export const BLOCKED_ENGINE_VOICES = ['en_US-amy-medium', 'en_US-ryan-medium'];

export interface AuditRow {
  assetId: string;
  headword: string;
  engineVoice: string;
  publicVoiceId: string;
  storageKey: string;
  audioSha256: string;
  inputTextSha256: string;
  logicalAssetKey: string;
  format: string;
  reviewStatus: string;
  trainingDatasetStatus: string;
  qaFindings: Array<{ rule: string; detail: string }>;
  reviewedBy: string | null;
  generatorActor: string;
  releaseRuntimeDigest: string | null;
}

export interface AuditReport {
  total: number;
  servable: number;
  byStatus: Record<string, number>;
  findings: AudioFinding[];
}

/**
 * Everything wrong with a set of assets.
 *
 * Deliberately does not trust `review_status` alone: an accepted row that also
 * carries QA findings, or names no reviewer, is a contradiction the database
 * should have prevented, and if it exists the audit should say so rather than
 * report it as servable.
 */
export function auditAssets(rows: AuditRow[]): AuditReport {
  const findings: AudioFinding[] = [];
  const add = (rule: string, detail: string) => findings.push({ rule, detail });

  const byStatus: Record<string, number> = {};
  let servable = 0;

  const liveKeys = new Map<string, string[]>();
  const quarantinedKeys = new Set<string>();

  for (const row of rows) {
    byStatus[row.reviewStatus] = (byStatus[row.reviewStatus] ?? 0) + 1;

    if (BLOCKED_ENGINE_VOICES.includes(row.engineVoice)) {
      add(
        'blocked_voice',
        `${row.assetId} (${row.headword}) was generated with ${row.engineVoice}, which is blocked`,
      );
    }

    const parsed = parseStorageKey(row.storageKey);
    if (!parsed) {
      add('malformed_storage_key', `${row.assetId} has key '${row.storageKey}'`);
    } else {
      if (parsed.hash !== row.audioSha256) {
        // The object being served is not the object that was measured.
        add(
          'storage_key_mismatch',
          `${row.assetId} key names ${parsed.hash.slice(0, 12)}… but the row says ` +
            `${row.audioSha256.slice(0, 12)}…`,
        );
      }
      if (parsed.publicVoiceId !== row.publicVoiceId) {
        add('storage_key_voice_mismatch', `${row.assetId} key is under ${parsed.publicVoiceId}`);
      }
      if (parsed.format !== row.format) {
        add('storage_key_format_mismatch', `${row.assetId} key is .${parsed.format}`);
      }
    }

    if (row.reviewStatus === 'quarantined') {
      quarantinedKeys.add(row.logicalAssetKey);
    } else {
      liveKeys.set(row.logicalAssetKey, [
        ...(liveKeys.get(row.logicalAssetKey) ?? []),
        row.assetId,
      ]);
    }

    if (row.reviewStatus === 'accepted') {
      // Each of these should be impossible; if one is true, the constraint that
      // was supposed to prevent it is not doing its job.
      if (row.qaFindings.length > 0) {
        add(
          'accepted_with_qa_findings',
          `${row.assetId} is accepted but carries ${row.qaFindings.map((f) => f.rule).join(', ')}`,
        );
      }
      if (!row.reviewedBy) {
        add('accepted_without_reviewer', `${row.assetId} is accepted but names no reviewer`);
      }
      if (row.reviewedBy === row.generatorActor) {
        add('self_reviewed', `${row.assetId} was reviewed by the actor that generated it`);
      }
      if (row.trainingDatasetStatus !== 'approved') {
        add(
          'accepted_without_rights',
          `${row.assetId} is accepted but its voice rights are '${row.trainingDatasetStatus}'`,
        );
      }
      if (!row.releaseRuntimeDigest) {
        add(
          'accepted_test_candidate',
          `${row.assetId} is accepted but was not produced by the release runtime`,
        );
      }
      const clean =
        row.qaFindings.length === 0 &&
        row.reviewedBy !== null &&
        row.reviewedBy !== row.generatorActor &&
        row.trainingDatasetStatus === 'approved' &&
        row.releaseRuntimeDigest !== null;
      if (clean) servable++;
    }

    if (row.reviewedBy && !['accepted', 'rejected'].includes(row.reviewStatus)) {
      add(
        'reviewer_without_decision',
        `${row.assetId} names reviewer ${row.reviewedBy} but is '${row.reviewStatus}'`,
      );
    }
  }

  for (const key of quarantinedKeys) {
    for (const assetId of liveKeys.get(key) ?? []) {
      add(
        'unresolved_conflict',
        `${assetId} shares logical key ${key.slice(0, 12)}… with a quarantined asset`,
      );
    }
  }

  for (const [key, ids] of liveKeys) {
    if (ids.length > 1) {
      add('duplicate_live_asset', `logical key ${key.slice(0, 12)}… has ${ids.length} live assets`);
    }
  }

  findings.push(...findDuplicateAudio(rows.map((r) => ({ id: r.assetId, ...r }))));

  return { total: rows.length, servable, byStatus, findings };
}

const AUDIT_SQL = `
  SELECT a.id AS "assetId", e.headword, a.engine_voice AS "engineVoice",
         a.public_voice_id AS "publicVoiceId", a.storage_key AS "storageKey",
         a.audio_sha256 AS "audioSha256", a.input_text_sha256 AS "inputTextSha256",
         a.logical_asset_key AS "logicalAssetKey", a.format,
         a.review_status AS "reviewStatus",
         a.training_dataset_status AS "trainingDatasetStatus",
         a.qa_findings AS "qaFindings", a.reviewed_by AS "reviewedBy",
         a.generator_actor AS "generatorActor",
         a.release_runtime_digest AS "releaseRuntimeDigest"
    FROM dsd_audio_assets a
    JOIN dsd_entries e ON e.id = a.dsd_entry_id
   ORDER BY e.headword, a.public_voice_id`;

async function main(): Promise<void> {
  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  // Read-only: an audit that could fix what it finds is an audit nobody has to
  // act on.
  const ds = createDsdDataSource('audit', config);
  await ds.initialize();
  let report: AuditReport;
  try {
    report = auditAssets(await ds.query(AUDIT_SQL));
  } finally {
    await ds.destroy();
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.total} audio asset(s).`);
    for (const [status, count] of Object.entries(report.byStatus).sort()) {
      console.log(`  ${String(count).padStart(5)}  ${status}`);
    }
    console.log(`\n${report.servable} servable.`);
    if (report.findings.length > 0) {
      console.log('');
      for (const finding of report.findings) {
        console.error(`  ${finding.rule.padEnd(28)} ${finding.detail}`);
      }
    }
  }

  if (report.findings.length > 0) {
    console.error(`\n${report.findings.length} finding(s).`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
