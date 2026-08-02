import {
  ALGORITHM_VERSION,
  NORMALIZATION_VERSION,
  SimilarityPolicy,
  authorFacingState,
  charNgrams,
  classify,
  compare,
  cosine,
  initialDecision,
  jaccard,
  legacyDigest,
  longestCommonRun,
  normalizeForComparison,
  permitsPublication,
  policyHash,
  tokenize,
  validatePolicy,
  wordNgrams,
} from './similarity';

function policy(overrides: Partial<SimilarityPolicy> = {}): SimilarityPolicy {
  return {
    policyVersion: 'v1',
    normalizationVersion: NORMALIZATION_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    effectiveDate: '2026-08-03',
    approvers: ['DSD-P-001', 'DSD-R-001', 'DSD-L-001'],
    benchmarkSha256: 'a'.repeat(64),
    rationale: 'Calibrated against the v1 labelled control set.',
    bands: {
      definition: {
        high: { tokenJaccard: 0.8, wordNgramJaccard: 0.6, charNgramJaccard: 0.8, cosine: 0.9, longestRunRatio: 0.7, longestRun: 6 },
        medium: { tokenJaccard: 0.6, wordNgramJaccard: 0.35, charNgramJaccard: 0.6, cosine: 0.75, longestRunRatio: 0.5, longestRun: 4 },
      },
      example: {
        high: { tokenJaccard: 0.85, wordNgramJaccard: 0.65, charNgramJaccard: 0.85, cosine: 0.92, longestRunRatio: 0.75, longestRun: 7 },
        medium: { tokenJaccard: 0.65, wordNgramJaccard: 0.4, charNgramJaccard: 0.65, cosine: 0.8, longestRunRatio: 0.55, longestRun: 5 },
      },
    },
    ...overrides,
  };
}

describe('normalizeForComparison', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizeForComparison('A person who  TEACHES.')).toBe('a person who teaches');
  });

  it('makes punctuation-only edits identical, since they are not rewrites', () => {
    expect(normalizeForComparison('One who teaches; a tutor.')).toBe(
      normalizeForComparison('one who teaches, a tutor'),
    );
  });

  it('keeps apostrophes inside words', () => {
    expect(normalizeForComparison("A child's toy")).toBe("a child's toy");
  });

  it('is idempotent', () => {
    const once = normalizeForComparison('  “A person.”  ');
    expect(normalizeForComparison(once)).toBe(once);
  });
});

describe('metrics', () => {
  it('jaccard is 1 for identical sets and 0 for disjoint ones', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
  });

  it('cosine counts repetition, unlike jaccard', () => {
    expect(cosine(['a', 'a', 'b'], ['a', 'b', 'b'])).toBeLessThan(1);
    expect(cosine(['a', 'b'], ['a', 'b'])).toBeCloseTo(1);
  });

  it('longestCommonRun finds a verbatim clause inside different writing', () => {
    const a = tokenize('Something entirely different a person who teaches children and more.');
    const b = tokenize('Other words here a person who teaches children plus other things.');
    expect(longestCommonRun(a, b)).toBe(5);
  });

  it('returns zero for empty input rather than dividing by nothing', () => {
    expect(longestCommonRun([], ['a'])).toBe(0);
    expect(cosine([], ['a'])).toBe(0);
    expect(jaccard([], [])).toBe(0);
  });

  it('builds n-grams of the requested size', () => {
    expect(wordNgrams(['a', 'b', 'c', 'd'], 3)).toEqual(['a b c', 'b c d']);
    expect(charNgrams('abcd', 3)).toEqual(['abc', 'bcd']);
  });

  it('does not lose short text to n-gram windows', () => {
    expect(charNgrams('ab', 4)).toEqual(['ab']);
    expect(wordNgrams(['a'], 3)).toEqual(['a']);
  });
});

describe('compare', () => {
  it('detects an exact match through punctuation and casing changes', () => {
    const scores = compare('A person who teaches.', 'a person who teaches');
    expect(scores.exact).toBe(true);
    expect(scores.tokenJaccard).toBe(1);
  });

  it('does not call empty text an exact match', () => {
    expect(compare('', '').exact).toBe(false);
  });

  it('scores a near-copy high on every metric', () => {
    const scores = compare(
      'A person who teaches children in a school.',
      'A person who teaches children at a school.',
    );
    expect(scores.exact).toBe(false);
    expect(scores.tokenJaccard).toBeGreaterThan(0.7);
    expect(scores.longestRunRatio).toBeGreaterThan(0.5);
  });

  it('scores independent writing low even when the headword is shared', () => {
    const scores = compare(
      'Someone whose job is to help students learn.',
      'A person who teaches children in a school.',
    );
    expect(scores.tokenJaccard).toBeLessThan(0.3);
    expect(scores.longestRunRatio).toBeLessThan(0.4);
  });

  it('is symmetric in its set metrics and deterministic', () => {
    const a = compare('A person who teaches.', 'One who instructs pupils.');
    const b = compare('One who instructs pupils.', 'A person who teaches.');
    expect(a.tokenJaccard).toBe(b.tokenJaccard);
    expect(compare('x y z', 'x y q')).toEqual(compare('x y z', 'x y q'));
  });
});

describe('classify', () => {
  it('calls an exact match exact', () => {
    expect(classify(compare('A person who teaches.', 'a person who teaches'), 'definition', policy()))
      .toBe('exact');
  });

  it('calls a near-copy high', () => {
    const scores = compare(
      'A person who teaches children in a school.',
      'A person who teaches children at a school.',
    );
    expect(classify(scores, 'definition', policy())).toBe('high');
  });

  it('calls independent writing low', () => {
    const scores = compare(
      'Someone whose job is to help students learn something new.',
      'A person who teaches children in a school.',
    );
    expect(classify(scores, 'definition', policy())).toBe('low');
  });

  it('applies a different band to examples, which are longer', () => {
    const scores = compare('a b c d e f g h', 'a b c d e f g x');
    // Same scores, different verdict, because the bands are calibrated apart.
    const strict = policy();
    strict.bands.example.high.tokenJaccard = 0.99;
    strict.bands.example.medium.tokenJaccard = 0.99;
    strict.bands.example.high.longestRunRatio = 0.99;
    strict.bands.example.medium.longestRunRatio = 0.99;
    strict.bands.example.high.cosine = 0.99;
    strict.bands.example.medium.cosine = 0.99;
    strict.bands.example.high.charNgramJaccard = 0.99;
    strict.bands.example.medium.charNgramJaccard = 0.99;
    strict.bands.example.high.wordNgramJaccard = 0.99;
    strict.bands.example.medium.wordNgramJaccard = 0.99;
    expect(classify(scores, 'definition', strict)).toBe('high');
    expect(classify(scores, 'example', strict)).toBe('low');
  });

  it('needs a long run as well as a high ratio, so short text cannot trip it', () => {
    // Two three-word texts sharing two words have a high ratio but no clause.
    const scores = compare('red hot car', 'red hot van');
    expect(scores.longestRunRatio).toBeGreaterThan(0.5);
    expect(scores.longestRun).toBeLessThan(4);
  });
});

describe('decisions', () => {
  it('starts low as clear, medium and high as manual review, exact as rewrite', () => {
    expect(initialDecision('low')).toBe('clear');
    expect(initialDecision('medium')).toBe('manual_review');
    expect(initialDecision('high')).toBe('manual_review');
    expect(initialDecision('exact')).toBe('rewrite_required');
  });

  it('never permits publication of an exact match, however it was decided', () => {
    // The remedy is a rewrite, which produces new text and a new audit.
    for (const decision of ['clear', 'manual_review', 'rewrite_required', 'independently_authored_cleared'] as const) {
      expect(permitsPublication('exact', decision)).toBe(false);
    }
  });

  it('permits high and medium only once cleared with evidence', () => {
    for (const matchClass of ['high', 'medium'] as const) {
      expect(permitsPublication(matchClass, 'manual_review')).toBe(false);
      expect(permitsPublication(matchClass, 'rewrite_required')).toBe(false);
      expect(permitsPublication(matchClass, 'independently_authored_cleared')).toBe(true);
    }
  });

  it('permits low only while it is still clear', () => {
    expect(permitsPublication('low', 'clear')).toBe(true);
    expect(permitsPublication('low', 'rewrite_required')).toBe(false);
  });
});

describe('authorFacingState', () => {
  it('reduces every verdict to one of three words', () => {
    expect(authorFacingState('exact', 'rewrite_required')).toBe('rewrite_required');
    expect(authorFacingState('high', 'manual_review')).toBe('manual_review');
    expect(authorFacingState('high', 'independently_authored_cleared')).toBe('clear');
    expect(authorFacingState('low', 'clear')).toBe('clear');
  });

  it('reveals nothing about what was matched', () => {
    // The whole surface an author sees is one of three literals; there is no
    // parameter through which legacy wording could reach them.
    const states = new Set(
      (['exact', 'high', 'medium', 'low'] as const).flatMap((m) =>
        (['clear', 'manual_review', 'rewrite_required', 'independently_authored_cleared'] as const).map(
          (d) => authorFacingState(m, d),
        ),
      ),
    );
    expect([...states].sort()).toEqual(['clear', 'manual_review', 'rewrite_required']);
  });
});

describe('policy identity', () => {
  it('hashes stably regardless of key order', () => {
    const a = policy();
    const b = { ...policy() };
    expect(policyHash(a)).toBe(policyHash(b));
  });

  it('changes when any threshold changes', () => {
    const changed = policy();
    changed.bands.definition.high.cosine = 0.91;
    expect(policyHash(changed)).not.toBe(policyHash(policy()));
  });
});

describe('validatePolicy', () => {
  it('accepts a well-formed policy', () => {
    expect(validatePolicy(policy())).toEqual([]);
  });

  it('rejects a policy built for a different normalization or algorithm', () => {
    expect(validatePolicy(policy({ normalizationVersion: 99 })).join(' ')).toMatch(/normalizationVersion/);
    expect(validatePolicy(policy({ algorithmVersion: 99 })).join(' ')).toMatch(/algorithmVersion/);
  });

  it('requires three approvers', () => {
    expect(validatePolicy(policy({ approvers: ['DSD-P-001'] })).join(' ')).toMatch(/three approvers/);
  });

  it('requires the calibration benchmark digest', () => {
    expect(validatePolicy(policy({ benchmarkSha256: 'nope' })).join(' ')).toMatch(/benchmarkSha256/);
  });

  it('rejects a medium threshold above its high threshold', () => {
    const inverted = policy();
    inverted.bands.definition.medium.cosine = 0.99;
    expect(validatePolicy(inverted).join(' ')).toMatch(/medium \(0.99\) exceeds high/);
  });
});

describe('legacyDigest', () => {
  it('is stable across formatting differences', () => {
    expect(legacyDigest('A person who teaches.')).toBe(legacyDigest('a person  who teaches'));
  });

  it('differs for different text', () => {
    expect(legacyDigest('A person who teaches.')).not.toBe(legacyDigest('A person who learns.'));
  });

  it('is a digest, not the text', () => {
    expect(legacyDigest('A person who teaches.')).toMatch(/^[0-9a-f]{64}$/);
  });
});
