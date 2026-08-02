/**
 * Calibrate and freeze the v1 similarity policy.
 *
 * A threshold picked by intuition is a threshold nobody can defend. This picks
 * them from labelled controls by a deterministic search, measures the result
 * against stated targets, and refuses to emit a policy that misses them. If no
 * threshold satisfies both targets, the answer is a better algorithm or a
 * narrower record class — never a quieter target.
 *
 * The committed fixtures are synthetic throughout. Real legacy text is read at
 * runtime, through the restricted English view, only to measure how often the
 * policy would send genuinely unrelated corpus text to manual review; the
 * sampled wording is never written to a fixture, a report or a log.
 *
 * Targets, from the plan:
 *   - every exact control classified exact
 *   - at least 95% of near-copy controls flagged
 *   - at most 10% of independent controls sent to manual review
 *
 * USAGE:
 *   npm run dsd:similarity:calibrate
 *   npm run dsd:similarity:calibrate -- --write
 *   npm run dsd:similarity:calibrate -- --sample-legacy 2000
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import {
  ALGORITHM_VERSION,
  ComponentScores,
  NORMALIZATION_VERSION,
  PolicyBand,
  RECORD_TYPES,
  RecordType,
  SimilarityPolicy,
  compare,
  crossesBand,
  policyHash,
} from './lib/similarity';

dotenv.config();

export const CALIBRATION_PATH = 'data/dsd/similarity/v1-calibration.jsonl';
export const POLICY_PATH = 'data/dsd/similarity/v1-policy.json';

export const TARGETS = {
  exactRecall: 1,
  nearCopyRecall: 0.95,
  maxIndependentFlagRate: 0.1,
};

export type CalibrationLabel = 'exact' | 'near_copy' | 'independent';

export interface CalibrationCase {
  id: string;
  recordType: RecordType;
  label: CalibrationLabel;
  control: string;
  a: string;
  b: string;
}

export interface ScoredCase extends CalibrationCase {
  scores: ComponentScores;
}

export function parseCalibration(text: string): CalibrationCase[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function scoreCases(cases: CalibrationCase[]): ScoredCase[] {
  return cases.map((testCase) => ({ ...testCase, scores: compare(testCase.a, testCase.b) }));
}

/** Fixed grids. Search must be reproducible, so the candidates are enumerated. */
export const RATIO_GRID = Array.from({ length: 19 }, (_, i) => Math.round((0.05 + i * 0.05) * 100) / 100);
export const RUN_GRID = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

const RATIO_METRICS: Array<keyof Omit<PolicyBand, 'contentRun'>> = [
  'tokenJaccard',
  'wordNgramJaccard',
  'charNgramJaccard',
  'cosine',
  'longestRunRatio',
];

function scoreOf(scores: ComponentScores, metric: keyof PolicyBand): number {
  return scores[metric] as number;
}

/**
 * Set every threshold just above the strongest independent control.
 *
 * The alternative — raise each threshold as far as the recall target allows —
 * produces a degenerate policy: whichever metric happens to carry recall is
 * pushed to the floor and every other metric is pushed to the ceiling, leaving
 * a single live signal. Anchoring on the negative controls instead keeps every
 * metric as sensitive as it can be without accusing writing that was
 * demonstrably independent, and recall is then measured, not assumed.
 *
 * The band is deliberately not fitted to the near-copies. Fitting to positives
 * is how a threshold ends up describing the fixture set rather than the
 * problem.
 */
export function calibrateMediumBand(scored: ScoredCase[], recordType: RecordType): PolicyBand {
  const negatives = scored.filter((c) => c.recordType === recordType && c.label === 'independent');

  const justAbove = (metric: keyof PolicyBand): number => {
    const worst = Math.max(0, ...negatives.map((c) => scoreOf(c.scores, metric)));
    return RATIO_GRID.find((value) => value > worst) ?? RATIO_GRID[RATIO_GRID.length - 1];
  };

  const band = {} as PolicyBand;
  for (const metric of RATIO_METRICS) band[metric] = justAbove(metric);

  const worstRun = Math.max(0, ...negatives.map((c) => c.scores.contentRun));
  band.contentRun = RUN_GRID.find((value) => value > worstRun) ?? RUN_GRID[RUN_GRID.length - 1];

  return band;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index];
}

/**
 * The high band. Both bands block publication until a compliance reviewer
 * clears them; high exists to say which are worth looking at first, so it is
 * set where the strongest three quarters of near-copies fall.
 */
export function calibrateHighBand(
  scored: ScoredCase[],
  recordType: RecordType,
  medium: PolicyBand,
): PolicyBand {
  const positives = scored.filter((c) => c.recordType === recordType && c.label === 'near_copy');
  const high = { ...medium };

  for (const metric of RATIO_METRICS) {
    const cut = quantile(positives.map((c) => scoreOf(c.scores, metric)), 0.25);
    const onGrid = RATIO_GRID.filter((v) => v <= cut).pop() ?? medium[metric];
    high[metric] = Math.max(onGrid, medium[metric]);
  }

  const runCut = quantile(positives.map((c) => c.scores.contentRun), 0.25);
  high.contentRun = Math.max(
    RUN_GRID.filter((v) => v <= runCut).pop() ?? medium.contentRun,
    medium.contentRun,
  );

  return high;
}

export interface TypeReport {
  recordType: RecordType;
  counts: Record<CalibrationLabel, number>;
  exactRecall: number;
  nearCopyRecall: number;
  independentFlagRate: number;
  missedNearCopies: string[];
  flaggedIndependents: string[];
}

export function evaluateBands(
  scored: ScoredCase[],
  recordType: RecordType,
  bands: { high: PolicyBand; medium: PolicyBand },
): TypeReport {
  const ofType = scored.filter((c) => c.recordType === recordType);
  const exact = ofType.filter((c) => c.label === 'exact');
  const near = ofType.filter((c) => c.label === 'near_copy');
  const independent = ofType.filter((c) => c.label === 'independent');

  const flagged = (c: ScoredCase) =>
    c.scores.exact || crossesBand(c.scores, bands.medium) || crossesBand(c.scores, bands.high);

  return {
    recordType,
    counts: { exact: exact.length, near_copy: near.length, independent: independent.length },
    exactRecall: exact.length === 0 ? 1 : exact.filter((c) => c.scores.exact).length / exact.length,
    nearCopyRecall: near.length === 0 ? 1 : near.filter(flagged).length / near.length,
    independentFlagRate: independent.length === 0 ? 0 : independent.filter(flagged).length / independent.length,
    missedNearCopies: near.filter((c) => !flagged(c)).map((c) => `${c.id} (${c.control})`),
    flaggedIndependents: independent.filter(flagged).map((c) => `${c.id} (${c.control})`),
  };
}

/**
 * Below these, a threshold will flag ordinary writing at corpus scale.
 *
 * A few dozen negative controls cannot tell you where the mass of a million
 * rows sits, so a band anchored on them can land absurdly low and still score
 * 0% here. These floors do not change the policy — silently raising a
 * calibrated threshold would be exactly the quiet weakening the plan forbids,
 * in the other direction. They make the gap visible so it is closed with real
 * sampling before the policy is frozen.
 */
export const SENSITIVITY_FLOOR: PolicyBand = {
  tokenJaccard: 0.4,
  wordNgramJaccard: 0.2,
  charNgramJaccard: 0.35,
  cosine: 0.6,
  longestRunRatio: 0.35,
  contentRun: 3,
};

export function sensitivityWarnings(recordType: RecordType, band: PolicyBand): string[] {
  return (Object.keys(SENSITIVITY_FLOOR) as Array<keyof PolicyBand>)
    .filter((metric) => band[metric] < SENSITIVITY_FLOOR[metric])
    .map(
      (metric) =>
        `${recordType}.${metric} = ${band[metric]}, below the ${SENSITIVITY_FLOOR[metric]} sanity floor — ` +
        'the control set is too small to justify a threshold this sensitive; ' +
        're-run with --sample-legacy before freezing',
    );
}

/** Targets are pass/fail. A near miss is a miss. */
export function checkTargets(report: TypeReport): string[] {
  const failures: string[] = [];
  if (report.exactRecall < TARGETS.exactRecall) {
    failures.push(
      `${report.recordType}: exact recall ${(report.exactRecall * 100).toFixed(0)}% — every exact copy must be caught`,
    );
  }
  if (report.nearCopyRecall < TARGETS.nearCopyRecall) {
    failures.push(
      `${report.recordType}: near-copy recall ${(report.nearCopyRecall * 100).toFixed(0)}% ` +
        `below ${TARGETS.nearCopyRecall * 100}% — missed ${report.missedNearCopies.join(', ')}`,
    );
  }
  if (report.independentFlagRate > TARGETS.maxIndependentFlagRate) {
    failures.push(
      `${report.recordType}: ${(report.independentFlagRate * 100).toFixed(0)}% of independent controls ` +
        `sent to manual review, above ${TARGETS.maxIndependentFlagRate * 100}% — ${report.flaggedIndependents.join(', ')}`,
    );
  }
  return failures;
}

export function calibrationDigest(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Build a candidate policy. It has no approvers: freezing a policy is an act
 * of three named people, and this function is not one of them.
 */
export function buildCandidatePolicy(
  scored: ScoredCase[],
  benchmarkSha256: string,
  effectiveDate: string,
): SimilarityPolicy {
  const bands = {} as SimilarityPolicy['bands'];
  for (const recordType of RECORD_TYPES) {
    const medium = calibrateMediumBand(scored, recordType);
    bands[recordType] = { medium, high: calibrateHighBand(scored, recordType, medium) };
  }

  return {
    policyVersion: 'v1',
    normalizationVersion: NORMALIZATION_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    effectiveDate,
    approvers: [],
    benchmarkSha256,
    rationale:
      'Each medium threshold is set one grid step above the strongest independent control in ' +
      'data/dsd/similarity/v1-calibration.jsonl, so every metric is as sensitive as it can be ' +
      'without accusing writing that was demonstrably independent. Recall against the near-copy ' +
      'controls is then measured rather than fitted, which keeps the thresholds describing the ' +
      'problem and not the fixture set. High is the 25th percentile of near-copy scores, so the ' +
      'strongest matches surface first; both bands block publication until a compliance reviewer ' +
      'clears them. Run thresholds count content words, because a shared run of articles and ' +
      'prepositions is how English works rather than evidence of copying.',
    bands,
  };
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Measure the manual-review rate against real corpus text.
 *
 * Sampled rows are compared and counted; the wording is never stored, printed
 * or written anywhere. Only the rate leaves this function.
 */
async function sampleLegacyFalsePositives(
  limit: number,
  policy: SimilarityPolicy,
  scored: ScoredCase[],
): Promise<Record<RecordType, number>> {
  const url = process.env.LEGACY_AUDIT_DATABASE_URL;
  if (!url) throw new Error('LEGACY_AUDIT_DATABASE_URL is required to sample legacy text');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const [{ current_user: user }] = (await client.query('SELECT current_user')).rows;
    if (user !== 'dsd_similarity_reader') {
      throw new Error(`legacy connection is '${user}', not dsd_similarity_reader`);
    }

    const rates = {} as Record<RecordType, number>;
    for (const recordType of RECORD_TYPES) {
      const { rows } = await client.query<{ text: string }>(
        `SELECT text FROM dsd_compliance.english_similarity_input
          WHERE record_type = $1 ORDER BY text LIMIT $2`,
        [recordType, limit],
      );
      // Independent DSD controls versus unrelated real text: any flag here is
      // a false positive by construction.
      const probes = scored.filter((c) => c.recordType === recordType && c.label === 'independent');
      let comparisons = 0;
      let flags = 0;
      for (const probe of probes) {
        for (const row of rows) {
          const scores = compare(probe.a, row.text);
          comparisons++;
          if (scores.exact || crossesBand(scores, policy.bands[recordType].medium)) flags++;
        }
      }
      rates[recordType] = comparisons === 0 ? 0 : flags / comparisons;
    }
    return rates;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const calibrationFile = path.resolve(process.cwd(), arg('calibration') ?? CALIBRATION_PATH);
  const text = fs.readFileSync(calibrationFile, 'utf8');
  const scored = scoreCases(parseCalibration(text));

  const effectiveDate = arg('effective-date') ?? new Date().toISOString().slice(0, 10);
  const policy = buildCandidatePolicy(scored, calibrationDigest(text), effectiveDate);

  const failures: string[] = [];
  const warnings: string[] = [];
  for (const recordType of RECORD_TYPES) {
    const report = evaluateBands(scored, recordType, policy.bands[recordType]);
    failures.push(...checkTargets(report));
    warnings.push(...sensitivityWarnings(recordType, policy.bands[recordType].medium));

    console.log(`\n${recordType}`);
    console.log(
      `  controls        ${report.counts.exact} exact, ${report.counts.near_copy} near-copy, ` +
        `${report.counts.independent} independent`,
    );
    console.log(`  exact recall    ${percent(report.exactRecall)}`);
    console.log(`  near-copy recall ${percent(report.nearCopyRecall)}`);
    console.log(`  manual review    ${percent(report.independentFlagRate)} of independent controls`);
    if (report.missedNearCopies.length) console.log(`  missed          ${report.missedNearCopies.join(', ')}`);
    if (report.flaggedIndependents.length) console.log(`  flagged         ${report.flaggedIndependents.join(', ')}`);
    for (const [band, thresholds] of Object.entries(policy.bands[recordType])) {
      console.log(`  ${band.padEnd(7)} ${JSON.stringify(thresholds)}`);
    }
  }

  const sample = arg('sample-legacy');
  if (sample) {
    const rates = await sampleLegacyFalsePositives(Number(sample), policy, scored);
    console.log('\nagainst sampled legacy text (rates only; no wording is retained)');
    for (const recordType of RECORD_TYPES) {
      console.log(`  ${recordType.padEnd(11)} ${percent(rates[recordType])} would go to manual review`);
    }
  }

  if (failures.length > 0) {
    console.error('\nCalibration does not meet its targets:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      '\nImprove the algorithm or narrow the supported record class. Do not lower the targets.',
    );
    process.exit(1);
  }

  console.log('\nAll targets met.');
  if (warnings.length > 0) {
    console.log('\nNot yet ready to freeze:');
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  console.log(`\nCandidate policy hash ${policyHash(policy)}`);

  if (!process.argv.includes('--write')) {
    console.log('\nDRY RUN — policy not written. Re-run with --write.');
    return;
  }

  const out = path.resolve(process.cwd(), POLICY_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(policy, null, 2) + '\n');
  console.log(`\nWrote ${POLICY_PATH} with no approvers.`);
  console.log(
    'It will not pass validation, and publication stays blocked, until the product owner, ' +
      'the linguistic reviewer and the legal reviewer are recorded in approvers.',
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
