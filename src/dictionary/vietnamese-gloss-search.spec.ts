import {
  normalizeVietnameseSearch,
  rankVietnameseGlosses,
  VietnameseGlossCandidate,
} from './vietnamese-gloss-search';

const candidates: VietnameseGlossCandidate[] = [
  {
    word: 'study',
    definitionVi: 'học; nghiên cứu một môn học',
    definitionEn: 'To spend time learning about a subject.',
    partOfSpeech: 'verb',
    senseId: 'study-1',
    senseOrder: 1,
    learnerRank: 100,
    examples: [{ en: 'I study English.', vi: 'Tôi học tiếng Anh.' }],
  },
  {
    word: 'learn',
    definitionVi: 'học được một kỹ năng hoặc kiến thức',
    definitionEn: 'To gain knowledge or skill.',
    partOfSpeech: 'verb',
    senseId: 'learn-1',
    senseOrder: 1,
    learnerRank: 50,
  },
  {
    word: 'research',
    definitionVi: 'nghiên cứu có hệ thống',
    definitionEn: 'To investigate systematically.',
    partOfSpeech: 'verb',
    senseId: 'research-1',
    senseOrder: 1,
    learnerRank: 500,
  },
];

describe('Vietnamese gloss search', () => {
  it('matches Vietnamese with or without diacritics', () => {
    expect(normalizeVietnameseSearch('  Nghiên cứu  ')).toBe('nghien cuu');
    expect(rankVietnameseGlosses('hoc', candidates).map((match) => match.word))
      .toEqual(['learn', 'study']);
  });

  it('ranks an exact reviewed gloss before token and substring matches', () => {
    const result = rankVietnameseGlosses('học', [
      ...candidates,
      { ...candidates[0], word: 'school', senseId: 'school-1', definitionVi: 'học' },
    ]);
    expect(result[0]).toMatchObject({ word: 'school', score: 100 });
    expect(result[1].score).toBe(90);
  });

  it('returns no match for unrelated text', () => {
    expect(rankVietnameseGlosses('bầu trời', candidates)).toEqual([]);
  });
});
