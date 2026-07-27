import {
  buildNgslCandidates,
  assertExpectedNgslCaseFoldCollisions,
  findNgslCaseFoldCollisions,
  NGSL_CANDIDATE_HEADER,
  NGSL_EXPECTED_CANDIDATE_COUNT,
  NGSL_EXPECTED_ROW_COUNT,
  NGSL_STATS_HEADER,
  NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT,
  normalizeNgslRank,
  parseAndValidateNgslCandidateCsv,
  parseAndValidateNgslStats,
  parseAndValidateNgslSupplement,
  parseCsvLine,
  renderCandidateWords,
  renderNgslCandidateCsv,
} from './ngsl';

function coreCsv(options: { duplicateLemma?: boolean; missingRank?: boolean } = {}): Buffer {
  const rows = Array.from({ length: NGSL_EXPECTED_ROW_COUNT }, (_, index) => {
    const rank = options.missingRank && index === NGSL_EXPECTED_ROW_COUNT - 1
      ? NGSL_EXPECTED_ROW_COUNT + 1
      : index + 1;
    const defaultLemma = index === 0 ? 'march' : index === 1 ? 'may' : `word-${index + 1}`;
    const lemma = options.duplicateLemma && index === NGSL_EXPECTED_ROW_COUNT - 1
      ? 'march'
      : defaultLemma;
    return `${lemma},${rank},50.25,12.5`;
  });
  return Buffer.from(`${NGSL_STATS_HEADER.join(',')}\n${rows.join('\n')}\n`, 'utf8');
}

function supplementCsv(options: { count?: number; firstLemma?: string } = {}): Buffer {
  const count = options.count ?? NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT;
  const rows = Array.from({ length: count }, (_, index) => {
    const defaultLemma = index === 0 ? 'March' : index === 1 ? 'May' : `supplement-${index + 1}`;
    const lemma = index === 0 && options.firstLemma ? options.firstLemma : defaultLemma;
    return `${lemma},${lemma}s`;
  });
  return Buffer.from(`\ufeff${rows.join('\r\n')}\r\n`, 'utf8');
}

describe('NGSL source parser', () => {
  it('parses quoted CSV fields without losing commas or escaped quotes', () => {
    expect(parseCsvLine('word,"text, with comma","say ""hello"""')).toEqual([
      'word',
      'text, with comma',
      'say "hello"',
    ]);
  });

  it('validates and orders all 2,809 ranked core lemmas', () => {
    const rows = parseAndValidateNgslStats(coreCsv());

    expect(rows).toHaveLength(NGSL_EXPECTED_ROW_COUNT);
    expect(rows[0]).toMatchObject({ normalizedLemma: 'march', rank: 1 });
    expect(rows.at(-1)).toMatchObject({
      normalizedLemma: `word-${NGSL_EXPECTED_ROW_COUNT}`,
      rank: NGSL_EXPECTED_ROW_COUNT,
    });
  });

  it('rejects any NGSL header drift', () => {
    const invalid = coreCsv().toString('utf8').replace('SFI Rank', 'Rank');
    expect(() => parseAndValidateNgslStats(Buffer.from(invalid))).toThrow(
      'Unexpected NGSL header',
    );
  });

  it('rejects duplicate lemmas and non-contiguous rank sets', () => {
    expect(() => parseAndValidateNgslStats(coreCsv({ duplicateLemma: true }))).toThrow(
      'duplicate lemma',
    );
    expect(() => parseAndValidateNgslStats(coreCsv({ missingRank: true }))).toThrow(
      'missing 2809',
    );
  });

  it('requires exactly 52 unique supplement rows exactly disjoint from the core', () => {
    const core = parseAndValidateNgslStats(coreCsv());
    expect(() => parseAndValidateNgslSupplement(supplementCsv({ count: 51 }), core)).toThrow(
      'Expected 52',
    );
    const duplicate = supplementCsv().toString('utf8').replace('May,Mays', 'March,Marchs');
    expect(() => parseAndValidateNgslSupplement(Buffer.from(duplicate), core)).toThrow(
      'duplicate lemma',
    );
    expect(() => parseAndValidateNgslSupplement(
      supplementCsv({ firstLemma: 'march' }),
      core,
    )).toThrow('also occurs in the ranked core');
  });

  it('preserves meaningful source casing for case-folded homographs', () => {
    const core = parseAndValidateNgslStats(coreCsv());
    const supplement = parseAndValidateNgslSupplement(
      supplementCsv(),
      core,
    );

    const collisions = findNgslCaseFoldCollisions(core, supplement);
    expect(collisions).toEqual([
      {
        candidateWord: 'march',
        coreLemma: 'march',
        coreRank: 1,
        supplementLemma: 'March',
        supplementRank: null,
      },
      {
        candidateWord: 'may',
        coreLemma: 'may',
        coreRank: 2,
        supplementLemma: 'May',
        supplementRank: null,
      },
    ]);
    expect(() => assertExpectedNgslCaseFoldCollisions(collisions)).not.toThrow();
  });

  it('rejects future unacknowledged case-fold collisions', () => {
    const core = parseAndValidateNgslStats(coreCsv());
    expect(() => parseAndValidateNgslSupplement(
      supplementCsv({ firstLemma: 'WORD-3' }),
      core,
    )).toThrow('case-fold collision is not acknowledged');
  });

  it('normalizes supplementary rank zero to null and appends it after ranked core', () => {
    const core = parseAndValidateNgslStats(coreCsv());
    const supplement = parseAndValidateNgslSupplement(supplementCsv(), core);
    const candidates = buildNgslCandidates(core, supplement);

    expect(normalizeNgslRank(0)).toBeNull();
    expect(supplement[0].rank).toBeNull();
    expect(candidates).toHaveLength(NGSL_EXPECTED_CANDIDATE_COUNT);
    expect(candidates[0]).toMatchObject({
      word: 'march',
      rank: 1,
      sourceMemberships: ['ngsl-core', 'ngsl-supplement'],
      sourceLemmas: ['march', 'March'],
    });
    expect(candidates[2808]).toMatchObject({ rank: 2809, sourceMemberships: ['ngsl-core'] });
    expect(candidates[2809]).toMatchObject({
      word: 'supplement-3',
      rank: null,
      sourceMemberships: ['ngsl-supplement'],
    });
    expect(renderCandidateWords(candidates).toString('utf8').split('\n')).toHaveLength(2860);
  });

  it('renders and validates an explicit ranked candidate table with merged provenance', () => {
    const core = parseAndValidateNgslStats(coreCsv());
    const supplement = parseAndValidateNgslSupplement(supplementCsv(), core);
    const candidates = buildNgslCandidates(core, supplement);
    const table = renderNgslCandidateCsv(candidates);
    const parsed = parseAndValidateNgslCandidateCsv(table, candidates);

    expect(table.toString('utf8').split('\n')[0]).toBe(NGSL_CANDIDATE_HEADER.join(','));
    expect(parsed).toHaveLength(NGSL_EXPECTED_CANDIDATE_COUNT);
    expect(parsed[0]).toEqual({
      word: 'march',
      rank: 1,
      sourceMemberships: ['ngsl-core', 'ngsl-supplement'],
      sourceLemmas: ['march', 'March'],
    });
    expect(parsed[2809]).toMatchObject({
      word: 'supplement-3',
      rank: null,
      sourceMemberships: ['ngsl-supplement'],
    });

    const changedLicense = table.toString('utf8').replace('CC BY-SA 4.0', 'unreviewed');
    expect(() => parseAndValidateNgslCandidateCsv(Buffer.from(changedLicense), candidates)).toThrow(
      'rank provenance fields do not match NGSL 1.2',
    );
  });
});
