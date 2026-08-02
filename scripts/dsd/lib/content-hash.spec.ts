import {
  CONTENT_HASH_VERSION,
  normalizeContent,
  contentHash,
  definitionHash,
  translationHash,
  exampleHash,
} from './content-hash';

describe('normalizeContent', () => {
  it('applies NFC so decomposed and composed forms converge', () => {
    expect(normalizeContent('café')).toBe(normalizeContent('café'));
  });

  it('collapses internal whitespace and trims', () => {
    expect(normalizeContent('  a   b \n c ')).toBe('a b c');
  });

  it('folds curly quotes and apostrophes to straight', () => {
    expect(normalizeContent('“it’s”')).toBe('"it\'s"');
  });

  it('is idempotent', () => {
    const once = normalizeContent('  “O’Clock”  ');
    expect(normalizeContent(once)).toBe(once);
  });

  it('preserves Vietnamese diacritics, which are meaning-bearing', () => {
    expect(normalizeContent('diễn tập')).toBe('diễn tập');
    expect(normalizeContent('diễn tập')).not.toBe('dien tap');
  });

  it('preserves case, because casing is part of the content', () => {
    expect(normalizeContent('March')).not.toBe(normalizeContent('march'));
  });
});

describe('contentHash', () => {
  it('returns a sha256 hex digest', () => {
    expect(contentHash('definition', { text: 'A dog.' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across key order', () => {
    expect(contentHash('example', { en: 'A', vi: 'B' })).toBe(
      contentHash('example', { vi: 'B', en: 'A' }),
    );
  });

  it('separates kinds, so identical text in different roles hashes differently', () => {
    // Without a domain tag, a definition and a translation reading the same
    // would share a hash and a provenance event could point at either.
    expect(contentHash('definition', { text: 'x' })).not.toBe(
      contentHash('translation', { text: 'x' }),
    );
  });

  it('changes when the content changes', () => {
    expect(contentHash('definition', { text: 'A dog.' })).not.toBe(
      contentHash('definition', { text: 'A cat.' }),
    );
  });

  it('is unaffected by whitespace differences, which are not content changes', () => {
    expect(contentHash('definition', { text: 'A  dog.' })).toBe(
      contentHash('definition', { text: 'A dog.' }),
    );
  });

  it('is versioned, so a future normalization change is detectable', () => {
    expect(CONTENT_HASH_VERSION).toBe(1);
    expect(contentHash('definition', { text: 'A dog.' })).not.toBe(
      contentHash('definition', { text: 'A dog.' }, 2),
    );
  });
});

describe('per-record helpers', () => {
  it('hashes a definition over its text, part of speech and usage labels', () => {
    const base = { definitionEn: 'To practise.', partOfSpeech: 'verb', usageLabels: ['general'] };
    const hash = definitionHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Part of speech is content: the same wording under a different POS is a
    // different record and must not share an approval.
    expect(definitionHash({ ...base, partOfSpeech: 'noun' })).not.toBe(hash);
    expect(definitionHash({ ...base, usageLabels: ['formal'] })).not.toBe(hash);
  });

  it('ignores usage-label ordering, which carries no meaning', () => {
    expect(definitionHash({ definitionEn: 'x', partOfSpeech: 'verb', usageLabels: ['a', 'b'] })).toBe(
      definitionHash({ definitionEn: 'x', partOfSpeech: 'verb', usageLabels: ['b', 'a'] }),
    );
  });

  it('hashes a translation over locale and text', () => {
    const hash = translationHash({ locale: 'vi', text: 'diễn tập' });
    expect(translationHash({ locale: 'vi', text: 'diễn tập ' })).toBe(hash);
    expect(translationHash({ locale: 'vi', text: 'dien tap' })).not.toBe(hash);
  });

  it('hashes an example over both languages together', () => {
    const hash = exampleHash({ exampleEn: 'They rehearse.', exampleVi: 'Họ diễn tập.' });
    // Changing either side changes the record; the pair is the unit of review.
    expect(exampleHash({ exampleEn: 'They rehearse.', exampleVi: 'Họ tập.' })).not.toBe(hash);
    expect(exampleHash({ exampleEn: 'We rehearse.', exampleVi: 'Họ diễn tập.' })).not.toBe(hash);
  });
});
