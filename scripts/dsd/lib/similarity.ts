/**
 * Deterministic similarity metrics for the compliance audit.
 *
 * This module answers one question: how close is a piece of DSD text to a
 * piece of legacy text? It never learns which legacy row the text came from,
 * and it returns numbers rather than wording, so the result can be stored in
 * DSD without storing anything that belongs to someone else.
 *
 * Every metric is deterministic and versioned. A similarity result is only
 * meaningful alongside the normalization, algorithm and policy versions that
 * produced it: change any of them and the old verdicts stop applying, which is
 * exactly what the stored version fields let the publication gate detect.
 *
 * Semantic embeddings are deliberately absent from v1. They are not
 * deterministic across model versions, and a compliance verdict that cannot be
 * reproduced is not a verdict.
 */
import * as crypto from 'crypto';

export const NORMALIZATION_VERSION = 1;
export const ALGORITHM_VERSION = 1;

export const RECORD_TYPES = ['definition', 'example'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const MATCH_CLASSES = ['exact', 'high', 'medium', 'low'] as const;
export type MatchClass = (typeof MATCH_CLASSES)[number];

export const SIMILARITY_DECISIONS = [
  'clear',
  'manual_review',
  'rewrite_required',
  'independently_authored_cleared',
] as const;
export type SimilarityDecision = (typeof SIMILARITY_DECISIONS)[number];

/**
 * Normalize for comparison only.
 *
 * More aggressive than the content hash on purpose: near-copies differ by
 * casing, punctuation and articles, and a comparison that treats "A person who
 * teaches." and "person who teaches" as different would miss the copy it
 * exists to find.
 */
export function normalizeForComparison(value: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // Markup is not wording. Left in, an HTML tag would inject letters and a
    // copy wrapped in <em> would stop looking like a copy.
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeForComparison(value);
  return normalized ? normalized.split(' ') : [];
}

export function charNgrams(value: string, n = 4): string[] {
  const text = normalizeForComparison(value).replace(/ /g, '_');
  if (text.length < n) return text ? [text] : [];
  const grams: string[] = [];
  for (let i = 0; i + n <= text.length; i++) grams.push(text.slice(i, i + n));
  return grams;
}

export function wordNgrams(words: string[], n = 3): string[] {
  if (words.length < n) return words.length ? [words.join(' ')] : [];
  const grams: string[] = [];
  for (let i = 0; i + n <= words.length; i++) grams.push(words.slice(i, i + n).join(' '));
  return grams;
}

export function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Term-frequency cosine. Repetition matters, so this is not set-based. */
export function cosine(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const count = (items: string[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const left = count(a);
  const right = count(b);

  let dot = 0;
  for (const [term, weight] of left) dot += weight * (right.get(term) ?? 0);
  if (dot === 0) return 0;

  const norm = (map: Map<string, number>) =>
    Math.sqrt([...map.values()].reduce((sum, weight) => sum + weight * weight, 0));
  return dot / (norm(left) * norm(right));
}

/**
 * Function words. A shared run made only of these is not evidence of copying —
 * "a unit of measurement" and "there is a" are how English works, not what
 * someone wrote.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'into', 'onto', 'over', 'under', 'about', 'as', 'than', 'that', 'which',
  'who', 'whom', 'whose', 'and', 'or', 'but', 'if', 'because', 'so', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'has', 'have', 'had', 'will', 'would', 'shall', 'should', 'can', 'could',
  'may', 'might', 'must', 'not', 'no', 'it', 'its', 'this', 'these', 'those',
  'there', 'here', 'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his',
  'her', 'their', 'our', 'my', 'your', 'one', 'used', 'such', 'more', 'most',
]);

export function isContentWord(token: string): boolean {
  return !FUNCTION_WORDS.has(token);
}

export interface RunMatch {
  /** Length in tokens of the longest shared run. */
  longest: number;
  /** Content words in the most content-bearing shared run. */
  content: number;
}

/**
 * Longest runs of consecutive tokens shared by both texts.
 *
 * The metric that catches the copy the set metrics miss: a long verbatim
 * clause dropped into otherwise original writing barely moves Jaccard, but it
 * is the clearest evidence of copying there is.
 *
 * Two numbers come back because raw length is not enough. A four-token run of
 * articles and prepositions is unavoidable in English; four content words in a
 * row is a sentence someone else wrote. Content is measured across every
 * shared run, not just the longest, so a short dense run is not hidden by a
 * long thin one.
 */
export function longestCommonRun(a: string[], b: string[]): RunMatch {
  if (a.length === 0 || b.length === 0) return { longest: 0, content: 0 };

  // Prefix sums make counting the content words of a run O(1).
  const contentPrefix = new Array(a.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    contentPrefix[i + 1] = contentPrefix[i] + (isContentWord(a[i]) ? 1 : 0);
  }

  let longest = 0;
  let content = 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const length = previous[j - 1] + 1;
        current[j] = length;
        if (length > longest) longest = length;
        const words = contentPrefix[i] - contentPrefix[i - length];
        if (words > content) content = words;
      }
    }
    previous = current;
  }
  return { longest, content };
}

export interface ComponentScores {
  exact: boolean;
  tokenJaccard: number;
  wordNgramJaccard: number;
  charNgramJaccard: number;
  cosine: number;
  longestRun: number;
  /** Longest run as a fraction of the shorter text, so length cannot hide a copy. */
  longestRunRatio: number;
  /** Content words in the most content-bearing shared run. */
  contentRun: number;
}

function round(value: number): number {
  // Stored and compared, so it must not depend on floating-point noise.
  return Math.round(value * 10000) / 10000;
}

export function compare(dsdText: string, legacyText: string): ComponentScores {
  const a = tokenize(dsdText);
  const b = tokenize(legacyText);
  const run = longestCommonRun(a, b);
  const shorter = Math.min(a.length, b.length);

  return {
    exact: normalizeForComparison(dsdText) === normalizeForComparison(legacyText) && a.length > 0,
    tokenJaccard: round(jaccard(a, b)),
    wordNgramJaccard: round(jaccard(wordNgrams(a), wordNgrams(b))),
    charNgramJaccard: round(jaccard(charNgrams(dsdText), charNgrams(legacyText))),
    cosine: round(cosine(a, b)),
    longestRun: run.longest,
    longestRunRatio: shorter === 0 ? 0 : round(run.longest / shorter),
    contentRun: run.content,
  };
}

// ─── policy ─────────────────────────────────────────────────────────────────

export interface PolicyBand {
  tokenJaccard: number;
  wordNgramJaccard: number;
  charNgramJaccard: number;
  cosine: number;
  longestRunRatio: number;
  /** Content words a shared run must carry before it counts as a clause. */
  contentRun: number;
}

export interface SimilarityPolicy {
  policyVersion: string;
  normalizationVersion: number;
  algorithmVersion: number;
  effectiveDate: string;
  approvers: string[];
  benchmarkSha256: string;
  rationale: string;
  /** Definitions and examples differ in length, so one threshold cannot serve both. */
  bands: Record<RecordType, { high: PolicyBand; medium: PolicyBand }>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Identity of a policy. Stored on every result so that changing a threshold
 * invalidates the verdicts it produced instead of silently re-interpreting
 * them.
 */
export function policyHash(policy: SimilarityPolicy): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(policy)), 'utf8')
    .digest('hex');
}

export function validatePolicy(policy: SimilarityPolicy): string[] {
  const errors: string[] = [];

  if (!/^v\d+(\.\d+)*$/.test(policy.policyVersion ?? '')) {
    errors.push(`policy: policyVersion '${policy.policyVersion}' must look like v1 or v1.2`);
  }
  if (policy.normalizationVersion !== NORMALIZATION_VERSION) {
    errors.push(
      `policy: normalizationVersion ${policy.normalizationVersion} does not match this build (${NORMALIZATION_VERSION})`,
    );
  }
  if (policy.algorithmVersion !== ALGORITHM_VERSION) {
    errors.push(
      `policy: algorithmVersion ${policy.algorithmVersion} does not match this build (${ALGORITHM_VERSION})`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveDate ?? '')) {
    errors.push('policy: effectiveDate must be YYYY-MM-DD');
  }
  if ((policy.approvers ?? []).length < 3) {
    // Product, linguistic and legal. A policy one person can set is a policy
    // one person can weaken.
    errors.push('policy: needs at least three approvers');
  }
  if (!/^[0-9a-f]{64}$/.test(policy.benchmarkSha256 ?? '')) {
    errors.push('policy: benchmarkSha256 must be a sha256 digest of the calibration set');
  }
  if (!(policy.rationale ?? '').trim()) {
    errors.push('policy: rationale is required');
  }

  for (const type of RECORD_TYPES) {
    const band = policy.bands?.[type];
    if (!band) {
      errors.push(`policy: no band for '${type}'`);
      continue;
    }
    for (const key of Object.keys(band.high ?? {}) as Array<keyof PolicyBand>) {
      const high = band.high[key];
      const medium = band.medium?.[key];
      if (typeof high !== 'number' || typeof medium !== 'number') {
        errors.push(`policy: ${type}.${String(key)} is not numeric in both bands`);
        continue;
      }
      if (medium > high) {
        errors.push(`policy: ${type}.${String(key)} medium (${medium}) exceeds high (${high})`);
      }
    }
  }

  return errors;
}

/**
 * Classify one comparison. Exact wins outright; otherwise a single metric
 * crossing a band is enough, because a copy only has to be detectable one way.
 */
/** One metric crossing is enough: a copy only has to be detectable one way. */
export function crossesBand(scores: ComponentScores, thresholds: PolicyBand): boolean {
  return (
    scores.tokenJaccard >= thresholds.tokenJaccard ||
    scores.wordNgramJaccard >= thresholds.wordNgramJaccard ||
    scores.charNgramJaccard >= thresholds.charNgramJaccard ||
    scores.cosine >= thresholds.cosine ||
    // A high ratio over articles and prepositions is not a copied clause, so
    // the run must also carry enough content words to be someone's writing.
    (scores.longestRunRatio >= thresholds.longestRunRatio &&
      scores.contentRun >= thresholds.contentRun)
  );
}

export function classify(
  scores: ComponentScores,
  recordType: RecordType,
  policy: SimilarityPolicy,
): MatchClass {
  if (scores.exact) return 'exact';

  const band = policy.bands[recordType];
  if (crossesBand(scores, band.high)) return 'high';
  if (crossesBand(scores, band.medium)) return 'medium';
  return 'low';
}

/** The decision a fresh result starts with, before any human looks at it. */
export function initialDecision(matchClass: MatchClass): SimilarityDecision {
  if (matchClass === 'low') return 'clear';
  if (matchClass === 'exact') return 'rewrite_required';
  return 'manual_review';
}

/**
 * Whether a stored result permits publication.
 *
 * Exact never does: the remedy is to rewrite, which produces new text, a new
 * content hash, and a new audit. Clearing an exact match as independently
 * authored is not offered in v1 and the database refuses it too.
 */
export function permitsPublication(
  matchClass: MatchClass,
  decision: SimilarityDecision,
): boolean {
  if (matchClass === 'exact') return false;
  if (matchClass === 'low') return decision === 'clear';
  return decision === 'independently_authored_cleared';
}

/**
 * What an author is allowed to see. A compliance reviewer sees the matched
 * legacy wording; an author never does, because an author who has seen it can
 * no longer testify that their rewrite was reached independently.
 */
export function authorFacingState(
  matchClass: MatchClass,
  decision: SimilarityDecision,
): 'clear' | 'manual_review' | 'rewrite_required' {
  if (matchClass === 'exact' || decision === 'rewrite_required') return 'rewrite_required';
  if (permitsPublication(matchClass, decision)) return 'clear';
  return 'manual_review';
}

/** A digest of the matched legacy text. Proves a match without keeping it. */
export function legacyDigest(text: string): string {
  return crypto
    .createHash('sha256')
    .update(`dsd.legacy.v${NORMALIZATION_VERSION} ${normalizeForComparison(text)}`, 'utf8')
    .digest('hex');
}
