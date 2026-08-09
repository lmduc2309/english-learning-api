import * as fs from 'fs';
import * as path from 'path';
import { RECORD_TYPES, classify, crossesBand, policyHash, validatePolicy } from './lib/similarity';
import {
  CALIBRATION_PATH,
  LEGACY_SAMPLE_SQL,
  POLICY_PATH,
  SAMPLE_EVIDENCE_PATH,
  TARGETS,
  buildCandidatePolicy,
  buildLegacySampleEvidence,
  calibrateMediumBand,
  calibrationDigest,
  checkTargets,
  evaluateBands,
  parseCalibration,
  scoreCases,
  sensitivityWarnings,
} from './similarity-calibrate';

const root = path.resolve(__dirname, '../..');
const calibrationText = fs.readFileSync(path.join(root, CALIBRATION_PATH), 'utf8');
const cases = parseCalibration(calibrationText);
const scored = scoreCases(cases);
const policy = buildCandidatePolicy(scored, calibrationDigest(calibrationText), '2026-08-03');

describe('the calibration set', () => {
  it('covers every control category the plan requires, for both record types', () => {
    for (const recordType of RECORD_TYPES) {
      const ofType = cases.filter((c) => c.recordType === recordType);
      for (const label of ['exact', 'near_copy', 'independent'] as const) {
        expect(ofType.filter((c) => c.label === label).length).toBeGreaterThan(3);
      }
    }
  });

  it('includes the positive controls that are easy to miss', () => {
    const controls = cases.map((c) => c.control);
    for (const control of [
      'case', 'punctuation', 'markup', 'small_insertion', 'small_deletion',
      'reordered_clauses', 'embedded_verbatim_clause',
    ]) {
      expect(controls.some((c) => c.includes(control))).toBe(true);
    }
  });

  it('includes the negative controls that are easy to get wrong', () => {
    // Independent writing that shares a headword, a frame, or a phrase English
    // gives you no way to avoid.
    const controls = cases.map((c) => c.control);
    for (const control of [
      'same_headword', 'shared_short_factual_phrase', 'formulaic_opening', 'shared_common_frame',
    ]) {
      expect(controls.some((c) => c.includes(control))).toBe(true);
    }
  });

  it('has unique ids', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
});

describe('calibration meets its targets', () => {
  it.each(RECORD_TYPES)('%s', (recordType) => {
    const report = evaluateBands(scored, recordType, policy.bands[recordType]);
    expect(report.exactRecall).toBe(TARGETS.exactRecall);
    expect(report.nearCopyRecall).toBeGreaterThanOrEqual(TARGETS.nearCopyRecall);
    expect(report.independentFlagRate).toBeLessThanOrEqual(TARGETS.maxIndependentFlagRate);
    expect(checkTargets(report)).toEqual([]);
  });

  it('catches every exact control, including markup-only and entity-only edits', () => {
    for (const scoredCase of scored.filter((c) => c.label === 'exact')) {
      expect(scoredCase.scores.exact).toBe(true);
    }
  });

  it('flags every near-copy, including a verbatim clause in different framing', () => {
    const embedded = scored.filter((c) => c.control === 'embedded_verbatim_clause');
    expect(embedded.length).toBeGreaterThan(0);
    for (const scoredCase of embedded) {
      expect(crossesBand(scoredCase.scores, policy.bands[scoredCase.recordType].medium)).toBe(true);
    }
  });

  it('leaves an unavoidable shared phrase alone', () => {
    // "a unit of measurement" and "there is a" are English, not copying.
    const unavoidable = scored.filter(
      (c) => c.control === 'shared_short_factual_phrase' || c.control === 'formulaic_opening',
    );
    expect(unavoidable.length).toBeGreaterThan(0);
    for (const scoredCase of unavoidable) {
      expect(classify(scoredCase.scores, scoredCase.recordType, policy)).toBe('low');
    }
  });
});

describe('the search', () => {
  it('samples legacy rows in deterministic digest order, not alphabetic text order', () => {
    expect(LEGACY_SAMPLE_SQL).toMatch(/ORDER BY content_digest, content_en/);
    expect(LEGACY_SAMPLE_SQL).toMatch(/content_digest AS digest/);
    expect(LEGACY_SAMPLE_SQL).not.toMatch(/WHERE[\s\S]*ORDER BY content_en\s+LIMIT/);
  });

  it('builds aggregate sample evidence without retaining legacy wording', () => {
    const result = {
      requestedRows: 2000,
      sampledRows: 2000,
      independentProbes: 12,
      comparisons: 24000,
      flags: 1,
      manualReviewRate: 1 / 24000,
      sampleDigestSha256: 'a'.repeat(64),
    };
    const evidence = buildLegacySampleEvidence(
      policy,
      { definition: result, example: { ...result, independentProbes: 11 } },
      '2026-08-09T00:00:00.000Z',
    );
    expect(evidence.containsLegacyWording).toBe(false);
    expect(evidence.readerRole).toBe('dsd_similarity_reader');
    expect(evidence.policyCandidateSha256).toBe(policyHash(policy));
    expect(Object.keys(evidence.results.definition)).not.toEqual(
      expect.arrayContaining(['text', 'rows', 'samples', 'wording']),
    );
    expect(SAMPLE_EVIDENCE_PATH).toMatch(/v1-sample-evidence\.json$/);
  });

  it('is deterministic', () => {
    expect(buildCandidatePolicy(scored, 'x'.repeat(64), '2026-08-03')).toEqual(
      buildCandidatePolicy(scoreCases(parseCalibration(calibrationText)), 'x'.repeat(64), '2026-08-03'),
    );
  });

  it('anchors each threshold above the strongest independent control', () => {
    for (const recordType of RECORD_TYPES) {
      const band = calibrateMediumBand(scored, recordType);
      const negatives = scored.filter((c) => c.recordType === recordType && c.label === 'independent');
      for (const negative of negatives) {
        expect(crossesBand(negative.scores, band)).toBe(false);
      }
    }
  });

  it('keeps high at or above medium on every metric', () => {
    for (const recordType of RECORD_TYPES) {
      const { high, medium } = policy.bands[recordType];
      for (const metric of Object.keys(medium) as Array<keyof typeof medium>) {
        expect(high[metric]).toBeGreaterThanOrEqual(medium[metric]);
      }
    }
  });

  it('calibrates the two record types apart', () => {
    expect(policy.bands.definition.medium).not.toEqual(policy.bands.example.medium);
  });
});

describe('checkTargets', () => {
  it('fails a policy that misses an exact copy', () => {
    const report = evaluateBands(scored, 'definition', policy.bands.definition);
    expect(checkTargets({ ...report, exactRecall: 0.99 }).join(' ')).toMatch(/every exact copy/);
  });

  it('fails a policy below the near-copy target and names what it missed', () => {
    const report = evaluateBands(scored, 'definition', policy.bands.definition);
    expect(
      checkTargets({ ...report, nearCopyRecall: 0.5, missedNearCopies: ['D14 (embedded)'] }).join(' '),
    ).toMatch(/D14 \(embedded\)/);
  });

  it('fails a policy that would send too much independent writing to review', () => {
    const report = evaluateBands(scored, 'definition', policy.bands.definition);
    expect(checkTargets({ ...report, independentFlagRate: 0.5 }).join(' ')).toMatch(/above 10%/);
  });
});

describe('the frozen policy file', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, POLICY_PATH), 'utf8'));

  it('matches what the calibration produces, so it was not hand-edited', () => {
    expect(policyHash({ ...onDisk, approvers: [] })).toBe(policyHash({ ...policy, approvers: [] }));
  });

  it('records the digest of the calibration set it came from', () => {
    expect(onDisk.benchmarkSha256).toBe(calibrationDigest(calibrationText));
  });

  it('is not yet approved, so publication stays blocked', () => {
    // Freezing a policy is an act of three named people. Until they sign,
    // validation fails, currentPolicy() returns null, and dsd:publish refuses.
    expect(onDisk.approvers).toEqual([]);
    expect(validatePolicy(onDisk).join(' ')).toMatch(/three approvers/);
  });

  it('is honest about not being ready to freeze', () => {
    // The example band is anchored on eleven negative controls. That is enough
    // to prove the method and not enough to set a production threshold.
    const warnings = RECORD_TYPES.flatMap((t) => sensitivityWarnings(t, onDisk.bands[t].medium));
    expect(warnings.join(' ')).toMatch(/--sample-legacy/);
  });
});

describe('what the fixtures may contain', () => {
  it('holds no legacy row identifier', () => {
    expect(calibrationText).not.toMatch(/word_id|definition_id|example_id|legacy_id|oewn/i);
  });

  it('holds no Vietnamese, since legacy Vietnamese is never compared', () => {
    expect(calibrationText).not.toMatch(/[ĂăĐđƠơƯưẠ-ỹ]/);
  });

  it('is synthetic: every case is a self-contained pair with no provenance to a real row', () => {
    for (const testCase of cases) {
      expect(Object.keys(testCase).sort()).toEqual(['a', 'b', 'control', 'id', 'label', 'recordType']);
    }
  });
});
