import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  assertExpectedNgslCaseFoldCollisions,
  buildNgslCandidates,
  findNgslCaseFoldCollisions,
  NGSL_CANDIDATE_HEADER,
  NGSL_EXPECTED_CANDIDATE_COUNT,
  NGSL_EXPECTED_ROW_COUNT,
  NGSL_STATS_HEADER,
  NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT,
  NGSL_RANK_PROVENANCE,
  NGSL_VERSION,
  NgslCaseFoldCollision,
  parseAndValidateNgslCandidateCsv,
  parseAndValidateNgslStats,
  parseAndValidateNgslSupplement,
  renderCandidateWords,
  renderNgslCandidateCsv,
} from './lib/ngsl';

const ROOT = process.cwd();
const LEARNER_CORE_DIR = path.resolve(ROOT, 'data/learner-core');
const VENDOR_DIR = path.join(LEARNER_CORE_DIR, 'vendor/ngsl', NGSL_VERSION);
const LOCK_PATH = path.join(LEARNER_CORE_DIR, 'ngsl-source-lock.json');
const CANDIDATE_PATH = path.join(LEARNER_CORE_DIR, 'candidate-words.txt');
const CANDIDATE_TABLE_PATH = path.join(LEARNER_CORE_DIR, 'ngsl-candidates.csv');

const SOURCES = {
  stats: {
    id: 'ngsl-1.2-stats',
    filename: 'NGSL_12_stats.csv',
    requestedUrl: 'https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv',
  },
  supplement: {
    id: 'ngsl-1.2-supplement',
    filename: 'SUP_lemmatized.csv',
    requestedUrl: 'https://www.newgeneralservicelist.com/s/SUP_lemmatized.csv',
  },
} as const;

interface DownloadedSource {
  id: string;
  filename: string;
  requestedUrl: string;
  effectiveUrl: string;
  retrievedAtUtc: string;
  bytes: Buffer;
}

interface LockedSource {
  id: string;
  requested_url: string;
  effective_url: string;
  retrieved_at_utc: string;
  vendor_path: string;
  sha256: string;
  bytes: number;
  validation: Record<string, unknown>;
}

interface LockedCaseFoldMerge {
  candidate_word: string;
  source_memberships: [
    {
      source_id: 'ngsl-1.2-stats';
      source_lemma: string;
      learner_rank: number;
    },
    {
      source_id: 'ngsl-1.2-supplement';
      source_lemma: string;
      learner_rank: null;
    },
  ];
}

interface NgslLock {
  schema_version: 1;
  source_id: 'ngsl-1.2';
  version: string;
  generated_by: string;
  license: string;
  license_url: string;
  attribution: string;
  sources: LockedSource[];
  derived: {
    candidate_words: {
      path: string;
      sha256: string;
      bytes: number;
      total: number;
      source_rows_total: number;
      ranked_core: number;
      unranked_supplement: number;
      case_fold_merges: LockedCaseFoldMerge[];
      ordering: string;
      normalization: string;
      supplement_rank_policy: string;
    };
    candidate_table: {
      path: string;
      sha256: string;
      bytes: number;
      rows: number;
      exact_header: readonly string[];
      rank_provenance: typeof NGSL_RANK_PROVENANCE;
      rank_semantics: string;
    };
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
        + 'Use a new source version/path after reviewing the upstream change.',
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

async function downloadSource(source: typeof SOURCES[keyof typeof SOURCES]): Promise<DownloadedSource> {
  const response = await fetch(source.requestedUrl, {
    headers: {
      accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
      'user-agent': 'DuskStillDev-English-Learning-NGSL-Ingestion/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Download failed for ${source.requestedUrl}: HTTP ${response.status}`);
  }

  return {
    ...source,
    effectiveUrl: response.url,
    retrievedAtUtc: new Date().toISOString(),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

function lockedSource(
  source: DownloadedSource,
  validation: Record<string, unknown>,
): LockedSource {
  return {
    id: source.id,
    requested_url: source.requestedUrl,
    effective_url: source.effectiveUrl,
    retrieved_at_utc: source.retrievedAtUtc,
    vendor_path: relativePath(path.join(VENDOR_DIR, source.filename)),
    sha256: sha256(source.bytes),
    bytes: source.bytes.length,
    validation,
  };
}

function lockedCaseFoldMerges(
  collisions: readonly NgslCaseFoldCollision[],
): LockedCaseFoldMerge[] {
  return collisions.map((collision) => ({
    candidate_word: collision.candidateWord,
    source_memberships: [
      {
        source_id: SOURCES.stats.id,
        source_lemma: collision.coreLemma,
        learner_rank: collision.coreRank,
      },
      {
        source_id: SOURCES.supplement.id,
        source_lemma: collision.supplementLemma,
        learner_rank: collision.supplementRank,
      },
    ],
  }));
}

function buildLock(
  stats: DownloadedSource,
  supplement: DownloadedSource,
  candidateBytes: Buffer,
  candidateTableBytes: Buffer,
  candidateCount: number,
  collisions: readonly NgslCaseFoldCollision[],
): NgslLock {
  const caseFoldMerges = lockedCaseFoldMerges(collisions);
  return {
    schema_version: 1,
    source_id: 'ngsl-1.2',
    version: NGSL_VERSION,
    generated_by: 'scripts/ngsl-source.ts',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'New General Service List by Browne, C., Culligan, B., and Phillips, J.',
    sources: [
      lockedSource(stats, {
        exact_header: NGSL_STATS_HEADER,
        unique_lemmas: NGSL_EXPECTED_ROW_COUNT,
        contiguous_rank_min: 1,
        contiguous_rank_max: NGSL_EXPECTED_ROW_COUNT,
      }),
      lockedSource(supplement, {
        format: 'headerless lemma followed by inflected forms',
        unique_lemmas: NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT,
        exact_lemma_disjoint_from_ranked_core: true,
        acknowledged_case_fold_collisions: caseFoldMerges,
        source_rank: 0,
        normalized_rank: null,
      }),
    ],
    derived: {
      candidate_words: {
        path: relativePath(CANDIDATE_PATH),
        sha256: sha256(candidateBytes),
        bytes: candidateBytes.length,
        total: candidateCount,
        source_rows_total: NGSL_EXPECTED_ROW_COUNT + NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT,
        ranked_core: NGSL_EXPECTED_ROW_COUNT,
        unranked_supplement: NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT,
        case_fold_merges: caseFoldMerges,
        ordering: 'NGSL core by ascending SFI Rank, then supplement source order',
        normalization: 'Unicode NFC, trim, en-US lowercase',
        supplement_rank_policy: 'Source rank 0 is normalized to null; null is never treated as highest frequency.',
      },
      candidate_table: {
        path: relativePath(CANDIDATE_TABLE_PATH),
        sha256: sha256(candidateTableBytes),
        bytes: candidateTableBytes.length,
        rows: candidateCount,
        exact_header: NGSL_CANDIDATE_HEADER,
        rank_provenance: NGSL_RANK_PROVENANCE,
        rank_semantics: 'learner_rank is explicit NGSL SFI Rank; blank means unranked and must never be inferred from priority_order.',
      },
    },
  };
}

async function acquire(): Promise<void> {
  const [stats, supplement] = await Promise.all([
    downloadSource(SOURCES.stats),
    downloadSource(SOURCES.supplement),
  ]);
  const coreRows = parseAndValidateNgslStats(stats.bytes);
  const supplementRows = parseAndValidateNgslSupplement(supplement.bytes, coreRows);
  const collisions = findNgslCaseFoldCollisions(coreRows, supplementRows);
  assertExpectedNgslCaseFoldCollisions(collisions);
  const candidates = buildNgslCandidates(coreRows, supplementRows);
  if (candidates.length !== NGSL_EXPECTED_CANDIDATE_COUNT) {
    throw new Error(
      `Expected ${NGSL_EXPECTED_CANDIDATE_COUNT} case-folded candidates, received ${candidates.length}`,
    );
  }
  const candidateBytes = renderCandidateWords(candidates);
  const candidateTableBytes = renderNgslCandidateCsv(candidates);
  parseAndValidateNgslCandidateCsv(candidateTableBytes, candidates);
  const lock = buildLock(
    stats,
    supplement,
    candidateBytes,
    candidateTableBytes,
    candidates.length,
    collisions,
  );

  const statsState = await persistImmutableRaw(
    path.join(VENDOR_DIR, stats.filename),
    stats.bytes,
  );
  const supplementState = await persistImmutableRaw(
    path.join(VENDOR_DIR, supplement.filename),
    supplement.bytes,
  );
  await writeAtomic(CANDIDATE_PATH, candidateBytes);
  await writeAtomic(CANDIDATE_TABLE_PATH, candidateTableBytes);
  await writeAtomic(LOCK_PATH, Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8'));

  console.log(
    `NGSL ${NGSL_VERSION}: ${coreRows.length + supplementRows.length} source rows validated; `
    + `${candidates.length} normalized curation headwords derived.`,
  );
  console.log(`Raw sources: ${statsState}/${supplementState} in ${relativePath(VENDOR_DIR)}`);
  console.log(`Lock: ${relativePath(LOCK_PATH)}`);
  console.log(`Candidates: ${relativePath(CANDIDATE_PATH)}`);
  console.log(`Ranked candidate table: ${relativePath(CANDIDATE_TABLE_PATH)}`);
}

function requireString(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid lock manifest: ${description} must be a non-empty string`);
  }
}

async function validateLocal(): Promise<void> {
  const lockBytes = await readIfPresent(LOCK_PATH);
  if (!lockBytes) {
    throw new Error(
      `Missing ${relativePath(LOCK_PATH)}. Run "npm run ngsl:fetch -- --write" first.`,
    );
  }

  const lock = JSON.parse(lockBytes.toString('utf8')) as NgslLock;
  if (lock.schema_version !== 1 || lock.source_id !== 'ngsl-1.2' || lock.version !== NGSL_VERSION) {
    throw new Error('Invalid lock manifest: unsupported schema, source, or version');
  }
  if (!Array.isArray(lock.sources) || lock.sources.length !== 2) {
    throw new Error('Invalid lock manifest: expected exactly two source records');
  }

  const sourceById = new Map(lock.sources.map((source) => [source.id, source]));
  for (const definition of Object.values(SOURCES)) {
    const locked = sourceById.get(definition.id);
    if (!locked) throw new Error(`Invalid lock manifest: missing source ${definition.id}`);
    if (locked.requested_url !== definition.requestedUrl) {
      throw new Error(`Invalid lock manifest: requested URL drift for ${definition.id}`);
    }
    requireString(locked.effective_url, `${definition.id}.effective_url`);
    requireString(locked.retrieved_at_utc, `${definition.id}.retrieved_at_utc`);
    if (Number.isNaN(Date.parse(locked.retrieved_at_utc))) {
      throw new Error(`Invalid lock manifest: ${definition.id}.retrieved_at_utc is not ISO-8601`);
    }
  }

  const statsPath = path.join(VENDOR_DIR, SOURCES.stats.filename);
  const supplementPath = path.join(VENDOR_DIR, SOURCES.supplement.filename);
  const statsBytes = await fs.readFile(statsPath);
  const supplementBytes = await fs.readFile(supplementPath);
  const coreRows = parseAndValidateNgslStats(statsBytes);
  const supplementRows = parseAndValidateNgslSupplement(supplementBytes, coreRows);
  const collisions = findNgslCaseFoldCollisions(coreRows, supplementRows);
  assertExpectedNgslCaseFoldCollisions(collisions);

  for (const [definition, bytes] of [
    [SOURCES.stats, statsBytes],
    [SOURCES.supplement, supplementBytes],
  ] as const) {
    const locked = sourceById.get(definition.id)!;
    if (locked.vendor_path !== relativePath(path.join(VENDOR_DIR, definition.filename))) {
      throw new Error(`Lock path mismatch for ${definition.id}`);
    }
    if (locked.bytes !== bytes.length || locked.sha256 !== sha256(bytes)) {
      throw new Error(`Raw source checksum mismatch for ${definition.id}`);
    }
  }

  const candidates = buildNgslCandidates(coreRows, supplementRows);
  if (candidates.length !== NGSL_EXPECTED_CANDIDATE_COUNT) {
    throw new Error(
      `Expected ${NGSL_EXPECTED_CANDIDATE_COUNT} case-folded candidates, received ${candidates.length}`,
    );
  }
  const expectedCandidateBytes = renderCandidateWords(candidates);
  const expectedCandidateTableBytes = renderNgslCandidateCsv(candidates);
  const actualCandidateBytes = await fs.readFile(CANDIDATE_PATH);
  const actualCandidateTableBytes = await fs.readFile(CANDIDATE_TABLE_PATH);
  parseAndValidateNgslCandidateCsv(actualCandidateTableBytes, candidates);
  const derived = lock.derived?.candidate_words;
  const candidateTable = lock.derived?.candidate_table;
  const expectedCaseFoldMerges = lockedCaseFoldMerges(collisions);
  if (
    !derived ||
    derived.path !== relativePath(CANDIDATE_PATH) ||
    derived.bytes !== actualCandidateBytes.length ||
    derived.sha256 !== sha256(actualCandidateBytes) ||
    derived.total !== candidates.length ||
    derived.source_rows_total !== coreRows.length + supplementRows.length ||
    JSON.stringify(derived.case_fold_merges) !== JSON.stringify(expectedCaseFoldMerges) ||
    !actualCandidateBytes.equals(expectedCandidateBytes)
  ) {
    throw new Error('Derived candidate-words.txt does not match the locked, validated sources');
  }
  if (
    !candidateTable ||
    candidateTable.path !== relativePath(CANDIDATE_TABLE_PATH) ||
    candidateTable.bytes !== actualCandidateTableBytes.length ||
    candidateTable.sha256 !== sha256(actualCandidateTableBytes) ||
    candidateTable.rows !== candidates.length ||
    JSON.stringify(candidateTable.exact_header) !== JSON.stringify(NGSL_CANDIDATE_HEADER) ||
    JSON.stringify(candidateTable.rank_provenance) !== JSON.stringify(NGSL_RANK_PROVENANCE) ||
    !actualCandidateTableBytes.equals(expectedCandidateTableBytes)
  ) {
    throw new Error('Derived ngsl-candidates.csv does not match the locked, validated sources');
  }

  console.log(
    `NGSL ${NGSL_VERSION} local artifacts verified: `
    + `${coreRows.length + supplementRows.length} source rows, ${candidates.length} curation headwords.`,
  );
}

function usage(): never {
  throw new Error(
    'Usage:\n'
    + '  npm run ngsl:fetch -- --write   Download, validate, and lock official NGSL 1.2 files\n'
    + '  npm run ngsl:validate           Validate local raw, lock, and derived files without network access',
  );
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'validate';
  if (command === 'fetch') {
    if (!process.argv.includes('--write')) {
      throw new Error(
        'Refusing to download without explicit --write. Use "npm run ngsl:fetch -- --write".',
      );
    }
    await acquire();
    return;
  }
  if (command === 'validate') {
    await validateLocal();
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
