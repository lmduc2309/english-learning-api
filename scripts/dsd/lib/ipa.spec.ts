import {
  IpaEscalationInput,
  compareCandidates,
  escalationReasons,
  normalizeIpa,
  stripStress,
  unknownIpaSymbols,
  validateIpa,
} from './ipa';

describe('normalizeIpa', () => {
  it('strips the delimiters tools wrap transcriptions in', () => {
    expect(normalizeIpa('/ˈrʌn/')).toBe('ˈrʌn');
    expect(normalizeIpa('[ˈrʌn]')).toBe('ˈrʌn');
  });

  it('keeps stress marks, because stress is the word', () => {
    // ˈrekɔːrd and rɪˈkɔːrd are different words.
    expect(normalizeIpa('ˈrekɔːrd')).toContain('ˈ');
    expect(normalizeIpa('ˈrekɔːrd')).not.toBe(normalizeIpa('rɪˈkɔːrd'));
  });

  it('converts the ASCII stress marks tools emit', () => {
    expect(normalizeIpa("'rʌn")).toBe('ˈrʌn');
    expect(normalizeIpa(',rʌn')).toBe('ˌrʌn');
  });

  it('uses the IPA letter g, not the Latin one', () => {
    // They render identically and hash differently, which is the worst
    // combination for a value used as an equality key.
    expect(normalizeIpa('ɡoʊ')).toBe(normalizeIpa('goʊ'));
    expect(normalizeIpa('goʊ').codePointAt(0)).toBe(0x0261);
  });

  it('converts a colon to the length mark', () => {
    expect(normalizeIpa('ɑ:')).toBe('ɑː');
  });

  it('is idempotent', () => {
    const once = normalizeIpa("/ 'rʌn /");
    expect(normalizeIpa(once)).toBe(once);
  });
});

describe('stripStress', () => {
  it('removes both stress marks and nothing else', () => {
    expect(stripStress('ˌrepriˈzent')).toBe('reprizent');
  });
});

describe('unknownIpaSymbols', () => {
  it('accepts an ordinary en-US transcription', () => {
    expect(unknownIpaSymbols('rɪˈhɜːrs')).toEqual([]);
  });

  it('reports a symbol from another notation', () => {
    // X-SAMPA or ARPAbet leaking through means the tool was misconfigured.
    expect(unknownIpaSymbols('rIh3rs')).toEqual(expect.arrayContaining(['I', '3']));
  });
});

describe('compareCandidates', () => {
  it('calls identical transcriptions identical, through notation differences', () => {
    expect(compareCandidates('/ˈrʌn/', "'rʌn")).toBe('identical');
  });

  it('separates a stress-only disagreement from a segment one', () => {
    // Stress-only is the disagreement most likely to be waved through, and the
    // part a learner most needs correct.
    expect(compareCandidates('ˈrekɔrd', 'rɪˈkɔrd')).toBe('segments_differ');
    expect(compareCandidates('ˈkɑntrækt', 'kɑnˈtrækt')).toBe('stress_only');
  });

  it('reports unavailable when a second candidate is missing', () => {
    expect(compareCandidates('ˈrʌn', null)).toBe('unavailable');
    expect(compareCandidates(null, null)).toBe('unavailable');
  });
});

describe('escalationReasons', () => {
  function input(overrides: Partial<IpaEscalationInput> = {}): IpaEscalationInput {
    return {
      headword: 'rehearse',
      partsOfSpeech: ['verb'],
      candidates: [
        { toolId: 'misaki', ipa: 'rɪˈhɜːrs' },
        { toolId: 'microsoft-phonetic-matching', ipa: 'rɪˈhɜːrs' },
      ],
      comparisonAvailable: true,
      ...overrides,
    };
  }

  it('has nothing to say about an ordinary word two tools agree on', () => {
    expect(escalationReasons(input())).toEqual([]);
  });

  it('escalates a homograph', () => {
    expect(escalationReasons(input({ partsOfSpeech: ['noun', 'verb'] })).join(' ')).toMatch(
      /homograph/,
    );
  });

  it('escalates an abbreviation', () => {
    for (const headword of ['NATO', 'U.S.A.']) {
      expect(escalationReasons(input({ headword })).join(' ')).toMatch(/abbreviation/);
    }
  });

  it('escalates a proper name', () => {
    expect(escalationReasons(input({ headword: 'Leicester' })).join(' ')).toMatch(/proper name/);
  });

  it('does not mistake an ordinary lowercase word for a name', () => {
    expect(escalationReasons(input({ headword: 'rehearse' })).join(' ')).not.toMatch(/proper name/);
  });

  it('escalates any disagreement, and says which kind', () => {
    const stress = escalationReasons(
      input({
        candidates: [
          { toolId: 'misaki', ipa: 'ˈkɑntrækt' },
          { toolId: 'microsoft-phonetic-matching', ipa: 'kɑnˈtrækt' },
        ],
      }),
    );
    expect(stress.join(' ')).toMatch(/stress disagreement/);

    const segments = escalationReasons(
      input({
        candidates: [
          { toolId: 'misaki', ipa: 'rɪˈhɜːrs' },
          { toolId: 'microsoft-phonetic-matching', ipa: 'riˈhɑrs' },
        ],
      }),
    );
    expect(segments.join(' ')).toMatch(/segment disagreement/);
  });

  it('escalates when there is only one tool to ask', () => {
    // One tool agreeing with itself is not evidence.
    expect(escalationReasons(input({ comparisonAvailable: false })).join(' ')).toMatch(
      /single tool/,
    );
    expect(
      escalationReasons(input({ candidates: [{ toolId: 'misaki', ipa: 'rɪˈhɜːrs' }] })).join(' '),
    ).toMatch(/single tool/);
  });

  it('escalates output in an unexpected notation', () => {
    expect(
      escalationReasons(
        input({ candidates: [{ toolId: 'misaki', ipa: 'r I h 3 r s' }, { toolId: 'x', ipa: 'r I h 3 r s' }] }),
      ).join(' '),
    ).toMatch(/unexpected symbols/);
  });

  it('collects every reason rather than the first', () => {
    expect(
      escalationReasons(
        input({ headword: 'Reading', partsOfSpeech: ['noun', 'verb'], comparisonAvailable: false }),
      ).length,
    ).toBe(3);
  });
});

describe('validateIpa', () => {
  it('accepts a well-formed transcription', () => {
    expect(validateIpa('rɪˈhɜːrs', 'en-US')).toEqual([]);
  });

  it('rejects an unsupported accent', () => {
    expect(validateIpa('rɪˈhɜːrs', 'en-GB').join(' ')).toMatch(/not supported/);
  });

  it('rejects an empty transcription', () => {
    expect(validateIpa('   ', 'en-US').join(' ')).toMatch(/empty/);
  });

  it('rejects another notation', () => {
    expect(validateIpa('rIh3rs', 'en-US').join(' ')).toMatch(/unexpected symbols/);
  });

  it('requires primary stress on a multi-syllable word', () => {
    expect(validateIpa('rɪhɜːrs', 'en-US').join(' ')).toMatch(/primary stress/);
  });

  it('does not demand stress on a single-vowel word', () => {
    expect(validateIpa('kæt', 'en-US')).toEqual([]);
  });
});
