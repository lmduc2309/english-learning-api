import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createGunzip } from 'zlib';

import {
  assertPinnedFirst100Summary,
  buildOewnCandidateArtifact,
  OEWN_ARTIFACT_URL,
  OEWN_COMPRESSED_BYTES,
  OEWN_DOCTYPE,
  OEWN_EXPECTED_COUNTS,
  OEWN_FIRST_100_EXPECTED,
  OEWN_LICENSE,
  OEWN_LICENSE_URL,
  OEWN_RELEASE_COMMIT,
  OEWN_RELEASE_TAG,
  OEWN_SHA256,
  OEWN_SOURCE_ID,
  OEWN_SOURCE_NAME,
  OEWN_SOURCE_URL,
  OEWN_UNCOMPRESSED_BYTES,
  OEWN_VERSION,
  parseOewnChunks,
  renderOewnCandidateJson,
  renderOewnHeadwordCsv,
  renderOewnSenseCsv,
} from './lib/oewn';
import { parseAndValidateNgslCandidateCsv } from './lib/ngsl';

const ROOT = process.cwd();
const LEARNER_CORE_DIR = path.resolve(ROOT, 'data/learner-core');
const ARTIFACT_FILENAME = 'english-wordnet-2025.xml.gz';
const VENDOR_PATH = path.join(
  LEARNER_CORE_DIR,
  'vendor/oewn',
  OEWN_VERSION,
  ARTIFACT_FILENAME,
);
const NGSL_CANDIDATE_PATH = path.join(LEARNER_CORE_DIR, 'ngsl-candidates.csv');
const NGSL_LOCK_PATH = path.join(LEARNER_CORE_DIR, 'ngsl-source-lock.json');
const LOCK_PATH = path.join(LEARNER_CORE_DIR, 'oewn-source-lock.json');
const CANDIDATE_JSON_PATH = path.join(
  LEARNER_CORE_DIR,
  'oewn-ngsl-first-100-candidates.json',
);
const HEADWORD_CSV_PATH = path.join(
  LEARNER_CORE_DIR,
  'oewn-ngsl-first-100-headwords.csv',
);
const SENSE_CSV_PATH = path.join(
  LEARNER_CORE_DIR,
  'oewn-ngsl-first-100-senses.csv',
);
const OEWN_LICENSE_PATH = path.join(
  LEARNER_CORE_DIR,
  'licenses/oewn-2025/LICENSE.md',
);
const WORDNET_LICENSE_PATH = path.join(
  LEARNER_CORE_DIR,
  'licenses/oewn-2025/WNDB_License.txt',
);
const OEWN_LICENSE_SHA256 =
  '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb';
const WORDNET_LICENSE_SHA256 =
  'df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904';
const FIRST_BATCH_LIMIT = 100;

interface DerivedFile {
  path: string;
  sha256: string;
  bytes: number;
  rows?: number;
}

interface OewnSourceLock {
  schema_version: 1;
  source: {
    id: string;
    name: string;
    version: string;
    release_date: string;
    release_tag: string;
    release_commit: string;
    release_url: string;
    artifact: string;
    artifact_url: string;
    official_digest_api: string;
    sha256: string;
    compressed_bytes: number;
    uncompressed_bytes: number;
    media_type: string;
    format: string;
    dtd: string;
    license: string;
    license_url: string;
    bundled_licenses: Array<{ path: string; sha256: string }>;
    attribution: string;
  };
  validation: {
    lexicon: Record<string, string>;
    counts: typeof OEWN_EXPECTED_COUNTS;
    all_ids_unique: true;
    all_references_resolved: true;
    all_synsets_defined: true;
    no_external_dtd_fetch: true;
    exact_doctype_required: true;
  };
  selection: {
    source_path: string;
    source_sha256: string;
    ngsl_version: string;
    priority_from: 1;
    priority_to: number;
    matching_policy: string;
    expected_first_100: typeof OEWN_FIRST_100_EXPECTED;
  };
  derived: {
    candidate_json: DerivedFile;
    headword_table: DerivedFile;
    sense_table: DerivedFile;
  };
  publication_policy: {
    stage: 'source_evidence_only';
    database_import_allowed: false;
    public_display_allowed: false;
    human_sense_selection_required: true;
    independent_vietnamese_review_required: true;
    source_order_is_not_learner_order: true;
  };
}

interface GeneratedArtifacts {
  lock: Buffer;
  candidateJson: Buffer;
  headwordCsv: Buffer;
  senseCsv: Buffer;
  summary: {
    requested: number;
    exactMatches: number;
    missingExact: number;
    sourceSenses: number;
    multipleSourceSenseCandidates: number;
  };
}

function relativePath(filePath: string): string {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function readIfPresent(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(filePath: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function persistImmutableRaw(filePath: string, bytes: Buffer): Promise<'created' | 'verified'> {
  const existing = await readIfPresent(filePath);
  if (existing) {
    if (!existing.equals(bytes)) {
      throw new Error(
        `Refusing to overwrite immutable raw source ${relativePath(filePath)}. `
        + 'Use a new versioned path after reviewing the upstream change.',
      );
    }
    return 'verified';
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx' });
    return 'created';
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    const raced = await fs.readFile(filePath);
    if (!raced.equals(bytes)) {
      throw new Error(`Immutable source appeared with different bytes: ${relativePath(filePath)}`);
    }
    return 'verified';
  }
}

function validateCompressedArtifact(bytes: Buffer): void {
  if (bytes.length !== OEWN_COMPRESSED_BYTES) {
    throw new Error(
      `OEWN compressed size changed: expected ${OEWN_COMPRESSED_BYTES}, received ${bytes.length}`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== OEWN_SHA256) {
    throw new Error(`OEWN SHA-256 mismatch: expected ${OEWN_SHA256}, received ${digest}`);
  }
}

export async function readResponseBodyWithExactSize(
  body: ReadableStream<Uint8Array> | null,
  expectedBytes: number,
): Promise<Buffer> {
  if (!body) throw new Error('OEWN download response has no body');
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw new Error(`Invalid OEWN response byte limit ${expectedBytes}`);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > expectedBytes) {
        await reader.cancel('OEWN response exceeded its pinned byte size');
        throw new Error(
          `OEWN download exceeded pinned size ${expectedBytes} bytes`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (receivedBytes !== expectedBytes) {
    throw new Error(
      `OEWN download size changed: expected ${expectedBytes}, received ${receivedBytes}`,
    );
  }
  return Buffer.concat(chunks, receivedBytes);
}

async function downloadArtifact(): Promise<Buffer> {
  const response = await fetch(OEWN_ARTIFACT_URL, {
    headers: {
      accept: 'application/gzip,application/octet-stream;q=0.9,*/*;q=0.1',
      'user-agent': 'DuskStillDev-English-Learning-OEWN-Ingestion/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`OEWN download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = await readResponseBodyWithExactSize(response.body, OEWN_COMPRESSED_BYTES);
  validateCompressedArtifact(bytes);
  return bytes;
}

async function loadNgslCandidates(): Promise<{
  bytes: Buffer;
  digest: string;
  candidates: ReturnType<typeof parseAndValidateNgslCandidateCsv>;
}> {
  const [bytes, lockBytes] = await Promise.all([
    fs.readFile(NGSL_CANDIDATE_PATH),
    fs.readFile(NGSL_LOCK_PATH),
  ]);
  const digest = sha256(bytes);
  let lockedDigest: unknown;
  try {
    const lock = JSON.parse(lockBytes.toString('utf8')) as {
      derived?: { candidate_table?: { sha256?: unknown } };
    };
    lockedDigest = lock.derived?.candidate_table?.sha256;
  } catch (error) {
    throw new Error(`Cannot parse ${relativePath(NGSL_LOCK_PATH)}: ${(error as Error).message}`);
  }
  if (lockedDigest !== digest) {
    throw new Error(
      `NGSL candidate table does not match its source lock: expected ${String(lockedDigest)}, `
      + `received ${digest}`,
    );
  }
  return {
    bytes,
    digest,
    candidates: parseAndValidateNgslCandidateCsv(bytes),
  };
}

async function validateBundledLicenses(): Promise<void> {
  const expected = [
    [OEWN_LICENSE_PATH, OEWN_LICENSE_SHA256],
    [WORDNET_LICENSE_PATH, WORDNET_LICENSE_SHA256],
  ] as const;
  for (const [filePath, expectedDigest] of expected) {
    const bytes = await readIfPresent(filePath);
    if (!bytes) throw new Error(`Missing bundled source license ${relativePath(filePath)}`);
    const actualDigest = sha256(bytes);
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `Bundled source license changed: ${relativePath(filePath)} expected `
        + `${expectedDigest}, received ${actualDigest}`,
      );
    }
  }
}

function derivedFile(filePath: string, bytes: Buffer, rows?: number): DerivedFile {
  return {
    path: relativePath(filePath),
    sha256: sha256(bytes),
    bytes: bytes.length,
    ...(rows === undefined ? {} : { rows }),
  };
}

function buildLock(
  parsed: Awaited<ReturnType<typeof parseOewnChunks>>,
  ngslDigest: string,
  candidateJson: Buffer,
  headwordCsv: Buffer,
  senseCsv: Buffer,
  summary: GeneratedArtifacts['summary'],
): OewnSourceLock {
  return {
    schema_version: 1,
    source: {
      id: OEWN_SOURCE_ID,
      name: OEWN_SOURCE_NAME,
      version: OEWN_VERSION,
      release_date: '2025-12-31',
      release_tag: OEWN_RELEASE_TAG,
      release_commit: OEWN_RELEASE_COMMIT,
      release_url: OEWN_SOURCE_URL,
      artifact: ARTIFACT_FILENAME,
      artifact_url: OEWN_ARTIFACT_URL,
      official_digest_api:
        'https://api.github.com/repos/globalwordnet/english-wordnet/releases/tags/2025-edition',
      sha256: OEWN_SHA256,
      compressed_bytes: OEWN_COMPRESSED_BYTES,
      uncompressed_bytes: parsed.uncompressedBytes,
      media_type: 'application/gzip',
      format: 'UTF-8 GWA WN-LMF 1.3 XML (gzip)',
      dtd: OEWN_DOCTYPE,
      license: OEWN_LICENSE,
      license_url: OEWN_LICENSE_URL,
      bundled_licenses: [
        {
          path: relativePath(OEWN_LICENSE_PATH),
          sha256: OEWN_LICENSE_SHA256,
        },
        {
          path: relativePath(WORDNET_LICENSE_PATH),
          sha256: WORDNET_LICENSE_SHA256,
        },
      ],
      attribution:
        'Open English WordNet 2025, © 2019-present The Open English WordNet Team, '
        + 'licensed under CC BY 4.0 and derived from Princeton WordNet under the WordNet License.',
    },
    validation: {
      lexicon: {
        id: parsed.lexicon.id,
        label: parsed.lexicon.label,
        language: parsed.lexicon.language,
        email: parsed.lexicon.email,
        license: parsed.lexicon.license,
        version: parsed.lexicon.version,
        url: parsed.lexicon.url,
      },
      counts: OEWN_EXPECTED_COUNTS,
      all_ids_unique: true,
      all_references_resolved: true,
      all_synsets_defined: true,
      no_external_dtd_fetch: true,
      exact_doctype_required: true,
    },
    selection: {
      source_path: relativePath(NGSL_CANDIDATE_PATH),
      source_sha256: ngslDigest,
      ngsl_version: '1.2',
      priority_from: 1,
      priority_to: FIRST_BATCH_LIMIT,
      matching_policy:
        'Exact case-sensitive OEWN lemma match against NGSL original_source_lemmas; '
        + 'case-fold-only entries are diagnostics and never sense candidates.',
      expected_first_100: OEWN_FIRST_100_EXPECTED,
    },
    derived: {
      candidate_json: derivedFile(CANDIDATE_JSON_PATH, candidateJson, summary.requested),
      headword_table: derivedFile(HEADWORD_CSV_PATH, headwordCsv, summary.requested),
      sense_table: derivedFile(SENSE_CSV_PATH, senseCsv, summary.sourceSenses),
    },
    publication_policy: {
      stage: 'source_evidence_only',
      database_import_allowed: false,
      public_display_allowed: false,
      human_sense_selection_required: true,
      independent_vietnamese_review_required: true,
      source_order_is_not_learner_order: true,
    },
  };
}

async function generateArtifacts(): Promise<GeneratedArtifacts> {
  await validateBundledLicenses();
  const compressed = await fs.readFile(VENDOR_PATH).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `Missing ${relativePath(VENDOR_PATH)}. `
        + 'Run npm run oewn:fetch -- --write --limit 100 first.',
      );
    }
    throw error;
  });
  validateCompressedArtifact(compressed);
  const ngsl = await loadNgslCandidates();
  const selected = ngsl.candidates.slice(0, FIRST_BATCH_LIMIT);
  const targetLookupKeys = new Set(selected.map((candidate) => candidate.word));
  const gunzip = createReadStream(VENDOR_PATH).pipe(createGunzip());
  const parsed = await parseOewnChunks(gunzip, {
    targetLookupKeys,
    expectedCounts: OEWN_EXPECTED_COUNTS,
    expectedUncompressedBytes: OEWN_UNCOMPRESSED_BYTES,
    maxUncompressedBytes: OEWN_UNCOMPRESSED_BYTES,
  });
  const artifact = buildOewnCandidateArtifact(ngsl.candidates, parsed, {
    limit: FIRST_BATCH_LIMIT,
    ngslCandidatesSha256: ngsl.digest,
  });
  assertPinnedFirst100Summary(artifact);
  const candidateJson = renderOewnCandidateJson(artifact);
  const headwordCsv = renderOewnHeadwordCsv(artifact);
  const senseCsv = renderOewnSenseCsv(artifact);
  const summary = {
    requested: artifact.summary.requested_headwords,
    exactMatches: artifact.summary.headwords_with_exact_entries,
    missingExact: artifact.summary.headwords_without_exact_entries,
    sourceSenses: artifact.summary.source_senses,
    multipleSourceSenseCandidates:
      artifact.summary.headwords_with_multiple_source_sense_candidates,
  };
  const lock = Buffer.from(`${JSON.stringify(buildLock(
    parsed,
    ngsl.digest,
    candidateJson,
    headwordCsv,
    senseCsv,
    summary,
  ), null, 2)}\n`, 'utf8');
  return { lock, candidateJson, headwordCsv, senseCsv, summary };
}

async function writeGenerated(artifacts: GeneratedArtifacts): Promise<void> {
  await Promise.all([
    writeAtomic(CANDIDATE_JSON_PATH, artifacts.candidateJson),
    writeAtomic(HEADWORD_CSV_PATH, artifacts.headwordCsv),
    writeAtomic(SENSE_CSV_PATH, artifacts.senseCsv),
  ]);
  await writeAtomic(LOCK_PATH, artifacts.lock);
}

async function assertFileMatches(filePath: string, expected: Buffer): Promise<void> {
  const actual = await readIfPresent(filePath);
  if (!actual) throw new Error(`Missing derived OEWN file ${relativePath(filePath)}`);
  if (!actual.equals(expected)) {
    throw new Error(
      `Derived OEWN file is stale or modified: ${relativePath(filePath)}. `
      + 'Run npm run oewn:candidates to regenerate it from the locked source.',
    );
  }
}

async function acquire(): Promise<void> {
  const bytes = await downloadArtifact();
  const rawState = await persistImmutableRaw(VENDOR_PATH, bytes);
  const artifacts = await generateArtifacts();
  await writeGenerated(artifacts);
  console.log(
    `OEWN ${OEWN_VERSION} ${rawState}; generated ${artifacts.summary.sourceSenses} `
    + `unreviewed senses for ${artifacts.summary.exactMatches}/`
    + `${artifacts.summary.requested} exact NGSL headword matches.`,
  );
  console.log(`Source lock: ${LOCK_PATH}`);
}

async function candidates(): Promise<void> {
  const artifacts = await generateArtifacts();
  await writeGenerated(artifacts);
  console.log(
    `Generated source-only OEWN review queue: ${artifacts.summary.sourceSenses} senses, `
    + `${artifacts.summary.exactMatches} exact matches, `
    + `${artifacts.summary.missingExact} without an exact OEWN entry.`,
  );
  console.log(`Headword table: ${HEADWORD_CSV_PATH}`);
  console.log(`Sense table: ${SENSE_CSV_PATH}`);
}

async function validate(): Promise<void> {
  const artifacts = await generateArtifacts();
  await Promise.all([
    assertFileMatches(CANDIDATE_JSON_PATH, artifacts.candidateJson),
    assertFileMatches(HEADWORD_CSV_PATH, artifacts.headwordCsv),
    assertFileMatches(SENSE_CSV_PATH, artifacts.senseCsv),
    assertFileMatches(LOCK_PATH, artifacts.lock),
  ]);
  console.log(
    `Validated OEWN ${OEWN_VERSION}: checksum, WN-LMF metadata, source counts, `
    + `${artifacts.summary.requested}-headword queue, and byte-stable derived files.`,
  );
}

function assertArguments(command: string | undefined, args: string[]): asserts command is string {
  if (!command || !['fetch', 'validate', 'candidates'].includes(command)) {
    throw new Error(
      'Usage: ts-node scripts/oewn-source.ts fetch --write [--limit 100]\n'
      + '   or: ts-node scripts/oewn-source.ts <validate|candidates> [--limit 100]',
    );
  }
  let sawWrite = false;
  let sawLimit = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--write' && !sawWrite) {
      sawWrite = true;
      continue;
    }
    if (argument === '--limit' && !sawLimit && args[index + 1] === '100') {
      sawLimit = true;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected OEWN argument ${JSON.stringify(argument)}`);
  }
  if (command === 'fetch' && !sawWrite) {
    throw new Error(
      'Refusing to download without explicit --write. '
      + 'Use "npm run oewn:fetch -- --write --limit 100".',
    );
  }
  if (command !== 'fetch' && sawWrite) {
    throw new Error(`--write is not accepted by the offline ${command} command`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  assertArguments(command, args);
  if (command === 'fetch') await acquire();
  else if (command === 'candidates') await candidates();
  else await validate();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
