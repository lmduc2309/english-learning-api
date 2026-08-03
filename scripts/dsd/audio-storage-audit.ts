/**
 * Reconcile the audio object store against the database.
 *
 * The database says an asset exists, has a size, and hashes to a value. The
 * object store holds bytes. Nothing keeps those two in step automatically, and
 * the failure modes are quiet: an object deleted by a lifecycle rule nobody
 * remembers writing, an object rewritten so the hash in its own key is a lie, a
 * row whose object never landed. Each of those serves a 404 or the wrong audio
 * to a paying customer.
 *
 * So this reconciles both directions and reports. It never deletes: an
 * unexpected object might be the only surviving copy of something, and an audit
 * that can delete is an audit that can cause the incident it was meant to find.
 * Findings are quarantined by being reported and blocking the release gate.
 *
 * USAGE:
 *   npm run dsd:audio:storage:audit
 *   npm run dsd:audio:storage:audit -- --verify-bytes   # download and re-hash
 *   npm run dsd:audio:storage:audit -- --json
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import {
  AwsCliObjectStore,
  BucketConfig,
  ObjectStore,
  StoredObject,
  parseS3Uri,
} from './lib/object-store';
import { parseStorageKey } from './lib/audio-key';

dotenv.config();

export const BLOCKED_VOICE_IDS = ['en-amy', 'en-ryan'];
export const BLOCKED_ENGINE_VOICES = ['en_US-amy-medium', 'en_US-ryan-medium'];

export type Severity = 'critical' | 'warning';

export interface StorageFinding {
  rule: string;
  severity: Severity;
  detail: string;
}

export interface DbAsset {
  assetId: string;
  storageKey: string;
  audioSha256: string;
  byteSize: number;
  reviewStatus: string;
  publicVoiceId: string;
  engineVoice: string;
}

export interface StorageAuditInput {
  assets: DbAsset[];
  objects: StoredObject[];
  bucket: BucketConfig;
  /** Filled only when --verify-bytes ran: key → sha256 of what was downloaded. */
  verifiedHashes?: Record<string, string>;
}

/** Statuses whose bytes must already be present and correct. */
const MUST_EXIST = ['awaiting_review', 'accepted', 'rejected'];

/**
 * Everything wrong across the database and the store.
 *
 * Pure, so every rule is testable without a live bucket — including the ones
 * that only fire in situations you cannot easily create on demand.
 */
export function auditStorage(input: StorageAuditInput): StorageFinding[] {
  const findings: StorageFinding[] = [];
  const add = (rule: string, severity: Severity, detail: string) =>
    findings.push({ rule, severity, detail });

  // ── bucket configuration ──────────────────────────────────────────────────
  if (!input.bucket.versioning) {
    // Without versioning, an accidental overwrite or delete is unrecoverable
    // from the store itself.
    add('versioning_disabled', 'critical', 'the audio bucket is not versioned');
  }
  if (!input.bucket.encryption) {
    add('encryption_disabled', 'critical', 'the audio bucket has no default encryption');
  }
  if (input.bucket.publicListing) {
    // Listing would expose every hash, including unreviewed and rejected audio.
    add('public_listing_enabled', 'critical', 'the audio bucket allows anonymous listing');
  }

  const objectsByKey = new Map(input.objects.map((object) => [object.key, object]));
  const claimedKeys = new Set(input.assets.map((asset) => asset.storageKey));

  // ── database → store ──────────────────────────────────────────────────────
  for (const asset of input.assets) {
    const object = objectsByKey.get(asset.storageKey);
    const mustExist = MUST_EXIST.includes(asset.reviewStatus);

    if (!object) {
      if (mustExist) {
        add(
          'missing_object',
          'critical',
          `${asset.assetId} is '${asset.reviewStatus}' but ${asset.storageKey} is not in the store`,
        );
      } else {
        add(
          'missing_object',
          'warning',
          `${asset.assetId} ('${asset.reviewStatus}') has no object at ${asset.storageKey}`,
        );
      }
      continue;
    }

    if (object.size !== asset.byteSize) {
      // Metadata and bytes must agree before an asset is reviewable.
      add(
        'size_mismatch',
        'critical',
        `${asset.assetId}: the store holds ${object.size} bytes, the row says ${asset.byteSize}`,
      );
    }

    const parsed = parseStorageKey(asset.storageKey);
    if (!parsed) {
      add('malformed_key', 'critical', `${asset.assetId} has key '${asset.storageKey}'`);
    } else if (parsed.hash !== asset.audioSha256) {
      add(
        'key_hash_mismatch',
        'critical',
        `${asset.assetId}: the key names ${parsed.hash.slice(0, 12)}… but the row says ` +
          `${asset.audioSha256.slice(0, 12)}…`,
      );
    }

    if (object.versionCount > 0) {
      // A content-addressed key should never be written twice. A second version
      // means something overwrote it, so the hash in the key may no longer
      // describe the current bytes.
      add(
        'version_drift',
        'critical',
        `${asset.storageKey} has ${object.versionCount} non-current version(s); a ` +
          'content-addressed key must never be rewritten',
      );
    }

    const verified = input.verifiedHashes?.[asset.storageKey];
    if (verified && verified !== asset.audioSha256) {
      add(
        'byte_hash_mismatch',
        'critical',
        `${asset.assetId}: downloaded bytes hash ${verified.slice(0, 12)}…, expected ` +
          `${asset.audioSha256.slice(0, 12)}…`,
      );
    }

    if (BLOCKED_ENGINE_VOICES.includes(asset.engineVoice)) {
      add(
        'blocked_voice_asset',
        'critical',
        `${asset.assetId} was generated with the blocked voice ${asset.engineVoice}`,
      );
    }
  }

  // ── store → database ──────────────────────────────────────────────────────
  for (const object of input.objects) {
    if (claimedKeys.has(object.key)) continue;

    const parsed = parseStorageKey(object.key);
    if (!parsed) {
      add('unexpected_object', 'critical', `${object.key} is not a DSD audio key`);
      continue;
    }
    if (BLOCKED_VOICE_IDS.includes(parsed.publicVoiceId)) {
      add(
        'blocked_voice_prefix',
        'critical',
        `${object.key} sits under a blocked voice prefix; quarantine it, do not delete it`,
      );
      continue;
    }
    // An object no row claims. Possibly a leftover from a superseded asset,
    // possibly the only copy of something. Reported, never removed here.
    add('orphan_object', 'warning', `${object.key} is in the store but no asset row claims it`);
  }

  return findings;
}

export function criticalFindings(findings: StorageFinding[]): StorageFinding[] {
  return findings.filter((finding) => finding.severity === 'critical');
}

/** The gate the release audit consumes. */
export function storageGate(findings: StorageFinding[]): { pass: boolean; detail: string } {
  const critical = criticalFindings(findings);
  if (critical.length === 0) {
    return {
      pass: true,
      detail: findings.length === 0 ? 'no findings' : `${findings.length} warning(s)`,
    };
  }
  return {
    pass: false,
    detail: critical.map((finding) => finding.rule).join(', '),
  };
}

// ─── I/O ────────────────────────────────────────────────────────────────────

const ASSETS_SQL = `
  SELECT a.id AS "assetId", a.storage_key AS "storageKey",
         a.audio_sha256 AS "audioSha256", a.byte_size AS "byteSize",
         a.review_status AS "reviewStatus", a.public_voice_id AS "publicVoiceId",
         a.engine_voice AS "engineVoice"
    FROM dsd_audio_assets a
   ORDER BY a.storage_key`;

export interface StorageEnvironment {
  uri: string;
  region: string;
  kmsKeyId: string;
  publicBaseUrl: string;
  endpoint?: string;
}

export function readStorageEnvironment(env: NodeJS.ProcessEnv): {
  config?: StorageEnvironment;
  errors: string[];
} {
  const errors: string[] = [];
  const uri = env.DSD_AUDIO_S3_URI ?? '';
  const region = env.DSD_AUDIO_S3_REGION ?? '';
  const kmsKeyId = env.DSD_AUDIO_KMS_KEY_ID ?? '';
  const publicBaseUrl = env.DSD_AUDIO_PUBLIC_BASE_URL ?? '';

  if (!parseS3Uri(uri)) errors.push('DSD_AUDIO_S3_URI must look like s3://bucket/prefix');
  if (!region) errors.push('DSD_AUDIO_S3_REGION is required');
  if (!kmsKeyId) {
    errors.push('DSD_AUDIO_KMS_KEY_ID is required — the prefix must be encrypted at rest');
  }
  if (!publicBaseUrl) {
    errors.push('DSD_AUDIO_PUBLIC_BASE_URL is required — the API serves through it, never by listing');
  } else if (!/^https:\/\//.test(publicBaseUrl)) {
    errors.push('DSD_AUDIO_PUBLIC_BASE_URL must be https');
  }

  if (errors.length > 0) return { errors };
  return {
    config: { uri, region, kmsKeyId, publicBaseUrl, endpoint: env.DSD_AUDIO_S3_ENDPOINT },
    errors: [],
  };
}

async function main(): Promise<void> {
  const environment = readStorageEnvironment(process.env);
  if (environment.errors.length > 0) {
    throw new Error('Audio storage is not configured:\n  - ' + environment.errors.join('\n  - '));
  }
  const settings = environment.config!;
  const parsed = parseS3Uri(settings.uri)!;

  const dsdConfig = buildDsdCorpusConfig();
  if (dsdConfig.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + dsdConfig.errors.join('\n  - '));
  }

  const store: ObjectStore = new AwsCliObjectStore({
    bucket: parsed.bucket,
    prefix: parsed.prefix,
    region: settings.region,
    endpoint: settings.endpoint,
  });

  const ds = createDsdDataSource('audit', dsdConfig);
  await ds.initialize();

  let findings: StorageFinding[];
  let counts: { assets: number; objects: number };
  try {
    const assets: DbAsset[] = await ds.query(ASSETS_SQL);
    const objects = await store.list(parsed.prefix ? `${parsed.prefix}/` : 'dsd/audio/');

    let verifiedHashes: Record<string, string> | undefined;
    if (process.argv.includes('--verify-bytes')) {
      // Re-hashing every object is the only check that does not trust the store,
      // and the only one that catches silent corruption.
      verifiedHashes = {};
      for (const object of objects) {
        const bytes = await store.get(object.key);
        if (bytes) {
          verifiedHashes[object.key] = crypto.createHash('sha256').update(bytes).digest('hex');
        }
      }
    }

    counts = { assets: assets.length, objects: objects.length };
    findings = auditStorage({ assets, objects, bucket: await store.config(), verifiedHashes });
  } finally {
    await ds.destroy();
  }

  const gate = storageGate(findings);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ counts, gate, findings }, null, 2));
  } else {
    console.log(`${counts.assets} asset row(s), ${counts.objects} object(s).`);
    for (const finding of findings) {
      console.error(`  ${finding.severity.padEnd(8)} ${finding.rule.padEnd(24)} ${finding.detail}`);
    }
    console.log(`\nstorage gate: ${gate.pass ? 'pass' : 'FAIL'} — ${gate.detail}`);
    console.log('Nothing was deleted. Findings are quarantined for a person to resolve.');
  }

  if (!gate.pass) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
