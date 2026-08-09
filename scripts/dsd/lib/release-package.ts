/**
 * The deterministic parts of a release package.
 *
 * Determinism is the whole point: two exports from the same database snapshot
 * and the same SOURCE_DATE_EPOCH must be byte-identical, because that is what
 * lets anyone check a package against the manifest without trusting the machine
 * that built it. Everything that could vary run to run is either fixed here or
 * excluded.
 *
 * The specific sources of nondeterminism this file removes:
 *
 *   - **Key order in JSON.** Every object is emitted with sorted keys.
 *   - **Line endings and trailing newlines.** LF, exactly one at end of file.
 *   - **Locale-dependent sorting.** Rows are ordered by UUID using byte
 *     comparison, never `localeCompare`, which varies by ICU version.
 *   - **Timestamps.** `SOURCE_DATE_EPOCH` replaces "now" everywhere.
 *   - **Floating point formatting.** No floats are emitted at all.
 *
 * The manifest lists content artifacts only. The detached signature and the
 * checksum index are deliberately not listed: a manifest that listed its own
 * signature could never be signed, and a checksum index derived from the
 * manifest adds nothing by being inside it.
 */
import * as crypto from 'crypto';

// v2 adds pronunciation counts so signed release membership can cover every
// serving record family, not only entries/senses/audio.
export const MANIFEST_VERSION = 2;
export const SIGNATURE_ALGORITHM = 'ed25519';

/** Artifacts the manifest describes, in the order they appear in the package. */
export const CONTENT_ARTIFACTS = [
  'dsd-corpus.sqlite',
  '01_entries.csv',
  '02_senses.csv',
  '03_translations.csv',
  '04_examples.csv',
  '05_pronunciations.csv',
  '06_relations.csv',
  '07_audio-manifest.csv',
  'PROVENANCE.jsonl',
  'SOURCE-REGISTRY.json',
  'TOOL-REGISTRY.json',
  'DATA-PROVENANCE.md',
  'THIRD-PARTY-NOTICES.md',
  'DATA-LICENSE.md',
  'RELEASE-PUBLIC-KEY.pem',
] as const;

/**
 * Files that must never be listed as content artifacts.
 *
 * The manifest cannot contain its own hash, and it cannot contain the hash of a
 * signature over itself. Listing the checksum index would be harmless but
 * circular, since that index is generated from the manifest.
 */
export const NEVER_LISTED = ['00_manifest.json', '00_manifest.sig', 'checksums.sha256'];

/** Sorts by byte value, so the order does not depend on the host's ICU data. */
export function byteCompare(a: string, b: string): number {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return Buffer.compare(left, right);
}

/** Recursively sort object keys. Arrays keep their order, which is meaningful. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => byteCompare(a, b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * The exact bytes that get hashed and signed.
 *
 * Two spaces of indentation and a single trailing newline, fixed forever: a
 * formatting change would invalidate every signature ever issued.
 */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonical(value), null, 2) + '\n', 'utf8');
}

export function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * One CSV cell.
 *
 * Every value is quoted, whether or not it needs to be — an unquoted cell and a
 * quoted one are different bytes, and "quote only when necessary" is exactly the
 * kind of rule that drifts. A leading spreadsheet formula character is
 * neutralised, because these files are opened in Excel by people who did not
 * write them.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const raw = String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** LF endings and one trailing newline. No BOM: it is not valid UTF-8 content. */
export function csvBytes(header: string[], rows: Array<Array<string | number | null>>): Buffer {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

/** JSONL, one canonical object per line. */
export function jsonlBytes(records: unknown[]): Buffer {
  if (records.length === 0) return Buffer.from('', 'utf8');
  const lines = records.map((record) => JSON.stringify(canonical(record)));
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

// ─── manifest ───────────────────────────────────────────────────────────────

export interface ManifestArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ManifestInput {
  releaseId: string;
  channel: 'internal' | 'public';
  publicEligible: boolean;
  sourceDateEpoch: number;
  auditVersion: string;
  signerKeyId: string;
  source: {
    database: string;
    migration: string;
    similarityPolicySha256: string;
    sourceRegistrySha256: string;
    toolRegistrySha256: string;
    contributorRegistrySha256: string;
  };
  counts: {
    entries: number;
    senses: number;
    translations: number;
    examples: number;
    pronunciations: number;
    relations: number;
    audioAssets: number;
  };
  territories: string[];
  artifacts: ManifestArtifact[];
  audio: ManifestArtifact[];
}

export interface Manifest {
  manifest_version: number;
  release_id: string;
  channel: string;
  public_eligible: boolean;
  source_date_epoch: number;
  audit_version: string;
  signature_algorithm: string;
  signer_key_id: string;
  source: ManifestInput['source'];
  counts: ManifestInput['counts'];
  territories: string[];
  artifacts: ManifestArtifact[];
  audio: ManifestArtifact[];
}

export function buildManifest(input: ManifestInput): Manifest {
  const listed = input.artifacts.filter((artifact) => !NEVER_LISTED.includes(artifact.path));

  return {
    manifest_version: MANIFEST_VERSION,
    release_id: input.releaseId,
    channel: input.channel,
    public_eligible: input.publicEligible,
    source_date_epoch: input.sourceDateEpoch,
    audit_version: input.auditVersion,
    signature_algorithm: SIGNATURE_ALGORITHM,
    signer_key_id: input.signerKeyId,
    source: input.source,
    counts: input.counts,
    territories: [...input.territories].sort(byteCompare),
    artifacts: [...listed].sort((a, b) => byteCompare(a.path, b.path)),
    audio: [...input.audio].sort((a, b) => byteCompare(a.path, b.path)),
  };
}

/**
 * The convenience index. Generated from the manifest, never the other way round,
 * so the two cannot disagree about what the package contains.
 */
export function checksumsBytes(manifest: Manifest): Buffer {
  const entries = [...manifest.artifacts, ...manifest.audio].sort((a, b) =>
    byteCompare(a.path, b.path),
  );
  const lines = entries.map((artifact) => `${artifact.sha256}  ${artifact.path}`);
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

// ─── signing and verification ───────────────────────────────────────────────

export interface PublicKeyEntry {
  keyId: string;
  algorithm: string;
  publicKeyPem: string;
  status: 'active' | 'revoked';
  notAfter?: string;
  revokedReason?: string;
}

export function signManifestBytes(manifestBytes: Buffer, privateKeyPem: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`release signing key must be ed25519, got ${key.asymmetricKeyType}`);
  }
  // Ed25519 signs the message directly; there is no separate digest step, which
  // removes one thing that could differ between implementations.
  return crypto.sign(null, manifestBytes, key).toString('base64');
}

export type VerifyFailure =
  | 'manifest_missing'
  | 'signature_missing'
  | 'key_id_unknown'
  | 'key_revoked'
  | 'key_expired'
  | 'key_algorithm'
  | 'bundled_key_mismatch'
  | 'signature_invalid'
  | 'manifest_hash_mismatch'
  | 'artifact_missing'
  | 'artifact_hash_mismatch'
  | 'unexpected_artifact'
  | 'checksums_mismatch';

export interface VerifyProblem {
  code: VerifyFailure;
  detail: string;
}

export interface VerifyInput {
  manifestBytes: Buffer | null;
  signatureBase64: string | null;
  /** The reviewed registry from a clean checkout. The only trust root. */
  trustedKeys: PublicKeyEntry[];
  /** The key bundled in the package. Informational, and must match the registry. */
  bundledKeyPem: string | null;
  /** Every file present under the release directory, excluding the never-listed. */
  presentFiles: Record<string, { sha256: string; bytes: number }>;
  checksumsBytes: Buffer | null;
  /** Current time, for expiry. Injected so the check is testable. */
  now: string;
}

/**
 * Verify a package offline.
 *
 * The bundled public key is deliberately not trusted. Anyone who can change the
 * manifest can change a key sitting next to it, so the trust root is the
 * reviewed registry in the repository, and the bundled copy only has to match
 * it. Treating the bundled key as authoritative would make the signature prove
 * nothing beyond internal consistency.
 */
export function verifyRelease(input: VerifyInput): VerifyProblem[] {
  const problems: VerifyProblem[] = [];
  const fail = (code: VerifyFailure, detail: string) => problems.push({ code, detail });

  if (!input.manifestBytes) {
    fail('manifest_missing', '00_manifest.json is absent');
    return problems;
  }
  if (!input.signatureBase64) {
    fail('signature_missing', '00_manifest.sig is absent');
    return problems;
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(input.manifestBytes.toString('utf8'));
  } catch {
    fail('manifest_hash_mismatch', '00_manifest.json is not valid JSON');
    return problems;
  }

  // Re-serialising and comparing catches a manifest that was edited in a way
  // that preserves its meaning but changes its bytes — which would break the
  // signature and is worth naming precisely.
  if (!canonicalJsonBytes(manifest).equals(input.manifestBytes)) {
    fail(
      'manifest_hash_mismatch',
      '00_manifest.json is not in canonical form; its bytes have been rewritten',
    );
  }

  const key = input.trustedKeys.find((entry) => entry.keyId === manifest.signer_key_id);
  if (!key) {
    fail(
      'key_id_unknown',
      `signer key '${manifest.signer_key_id}' is not in the reviewed public-key registry`,
    );
  } else {
    if (key.status === 'revoked') {
      fail(
        'key_revoked',
        `signer key '${key.keyId}' is revoked${key.revokedReason ? `: ${key.revokedReason}` : ''}`,
      );
    }
    if (key.notAfter) {
      const expiry = Date.parse(key.notAfter);
      const now = Date.parse(input.now);
      if (!Number.isFinite(expiry) || !Number.isFinite(now)) {
        fail('key_expired', `signer key '${key.keyId}' has an invalid expiry timestamp`);
      } else if (expiry < now) {
        fail('key_expired', `signer key '${key.keyId}' expired on ${key.notAfter}`);
      }
    }
    if (key.algorithm !== SIGNATURE_ALGORITHM) {
      fail('key_algorithm', `signer key '${key.keyId}' is ${key.algorithm}, not ${SIGNATURE_ALGORITHM}`);
    }
    if (input.bundledKeyPem && normalizePem(input.bundledKeyPem) !== normalizePem(key.publicKeyPem)) {
      // Not fatal on its own — the registry is what is trusted — but it means
      // the package is misleading about who signed it.
      fail(
        'bundled_key_mismatch',
        'RELEASE-PUBLIC-KEY.pem does not match the reviewed registry entry',
      );
    }

    if (key.status !== 'revoked' && key.algorithm === SIGNATURE_ALGORITHM) {
      let valid = false;
      try {
        valid = crypto.verify(
          null,
          input.manifestBytes,
          crypto.createPublicKey(key.publicKeyPem),
          Buffer.from(input.signatureBase64, 'base64'),
        );
      } catch (error) {
        fail('signature_invalid', `signature could not be checked: ${(error as Error).message}`);
      }
      if (!valid && !problems.some((problem) => problem.code === 'signature_invalid')) {
        fail('signature_invalid', 'the signature does not match 00_manifest.json');
      }
    }
  }

  // ── artifacts ─────────────────────────────────────────────────────────────
  const expected = new Map(
    [...manifest.artifacts, ...manifest.audio].map((artifact) => [artifact.path, artifact]),
  );

  for (const [path, artifact] of expected) {
    const present = input.presentFiles[path];
    if (!present) {
      fail('artifact_missing', `${path} is listed in the manifest but absent`);
      continue;
    }
    if (present.sha256 !== artifact.sha256) {
      fail(
        'artifact_hash_mismatch',
        `${path} hashes ${present.sha256.slice(0, 12)}…, manifest says ${artifact.sha256.slice(0, 12)}…`,
      );
    }
    if (present.bytes !== artifact.bytes) {
      fail(
        'artifact_hash_mismatch',
        `${path} is ${present.bytes} bytes, manifest says ${artifact.bytes}`,
      );
    }
  }

  for (const path of Object.keys(input.presentFiles)) {
    if (NEVER_LISTED.includes(path)) continue;
    if (!expected.has(path)) {
      // An unlisted file is not covered by the signature, so it could have been
      // added by anyone after signing.
      fail('unexpected_artifact', `${path} is present but not listed in the manifest`);
    }
  }

  // ── checksum index ────────────────────────────────────────────────────────
  if (input.checksumsBytes) {
    if (!checksumsBytes(manifest).equals(input.checksumsBytes)) {
      fail('checksums_mismatch', 'checksums.sha256 disagrees with the manifest');
    }
  }

  return problems;
}

function normalizePem(pem: string): string {
  return pem.replace(/\s+/g, '');
}

/** True when nothing at all is wrong. */
export function releaseVerifies(problems: VerifyProblem[]): boolean {
  return problems.length === 0;
}
