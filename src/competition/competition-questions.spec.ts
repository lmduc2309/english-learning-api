import {
  competitionPoints,
  inferCompetitionGameMode,
  inferCompetitionQuestionMode,
  makeParagraphWordSets,
  makeCompetitionQuestionRequests,
  paragraphAnswersMatch,
  parseManualParagraph,
  parseParagraphAnswer,
} from './competition-questions';

describe('competition question modes', () => {
  it('assigns every word to the selected single question type', () => {
    expect(makeCompetitionQuestionRequests(['brief', 'vivid'], 'fill-blank')).toEqual([
      { word: 'brief', type: 'fill-blank' },
      { word: 'vivid', type: 'fill-blank' },
    ]);
  });

  it('creates a balanced mixed sequence containing both question types', () => {
    const requests = makeCompetitionQuestionRequests(
      ['brief', 'vivid', 'hesitate', 'resilient', 'reluctant'],
      'mixed',
    );

    expect(requests.map(({ type }) => type)).toEqual([
      'recall',
      'fill-blank',
      'recall',
      'fill-blank',
      'recall',
    ]);
  });

  it('treats legacy questions without a type as recall questions', () => {
    expect(inferCompetitionQuestionMode([
      { prompt: 'A short clue.', answer: 'brief', hint: 'B••••' },
    ])).toBe('recall');
  });

  it('infers mixed mode when a room contains both question types', () => {
    expect(inferCompetitionQuestionMode([
      { type: 'recall', prompt: 'A clue.', answer: 'brief', hint: 'B••••' },
      { type: 'fill-blank', prompt: 'A _____ scene.', answer: 'vivid', hint: 'V••••' },
    ])).toBe('mixed');
  });

  it('defaults legacy rooms to typed play and preserves voice-buzz mode', () => {
    expect(inferCompetitionGameMode([
      { prompt: 'A clue.', answer: 'brief', hint: 'B••••' },
    ])).toBe('typed');
    expect(inferCompetitionGameMode([
      { gameMode: 'voice-buzz', type: 'fill-blank', prompt: 'A _____ scene.', answer: 'vivid', hint: 'V••••' },
    ])).toBe('voice-buzz');
  });

  it('builds 30 paragraph sets with four or five words and covers the input', () => {
    const words = Array.from({ length: 90 }, (_, index) => `word-${index + 1}`);
    const sets = makeParagraphWordSets(words);

    expect(sets).toHaveLength(30);
    expect(sets.every((set) => set.length === 4 || set.length === 5)).toBe(true);
    expect(new Set(sets.flat())).toEqual(new Set(words));
  });

  it('parses only JSON arrays of paragraph answers', () => {
    expect(parseParagraphAnswer('["brief","vivid"]')).toEqual(['brief', 'vivid']);
    expect(parseParagraphAnswer('{"brief":true}')).toBeNull();
    expect(parseParagraphAnswer('["brief",2]')).toBeNull();
  });

  it('requires every paragraph answer in the correct slot order', () => {
    expect(paragraphAnswersMatch('["Brief!","vivid"]', ['brief', 'vivid'])).toBe(true);
    expect(paragraphAnswersMatch('["vivid","brief"]', ['brief', 'vivid'])).toBe(false);
    expect(paragraphAnswersMatch('["brief"]', ['brief', 'vivid'])).toBe(false);
  });
});

describe('parseManualParagraph', () => {
  it('turns bracketed words into ordered markers and answers', () => {
    expect(parseManualParagraph('  Maya [went] to the coast with a [ brief ] map.\n')).toEqual({
      prompt: 'Maya [[1]] to the coast with a [[2]] map.',
      answers: ['went', 'brief'],
    });
  });

  it('requires two to six blanks', () => {
    expect(parseManualParagraph('Only [one] blank here.')).toEqual({ error: 'needs 2 to 6 words in [brackets]' });
    expect(parseManualParagraph('[a] [b] [c] [d] [e] [f] [g]')).toEqual({ error: 'needs 2 to 6 words in [brackets]' });
  });

  it('rejects repeated answers, empty or stray brackets, and long paragraphs', () => {
    expect(parseManualParagraph('[Brief] and [brief] again.')).toEqual({ error: 'uses the same word twice' });
    expect(parseManualParagraph('[went] and [] here.')).toEqual({ error: 'has an empty or unclosed [ ]' });
    expect(parseManualParagraph('[went] and [brief here.')).toEqual({ error: 'has an empty or unclosed [ ]' });
    expect(parseManualParagraph(`[went] [brief] ${'x'.repeat(700)}`)).toEqual({ error: 'is longer than 700 characters' });
  });
});

describe('competitionPoints', () => {
  it('scores Paragraph Race from 500 to 1000 by time left', () => {
    expect(competitionPoints('paragraph-race', true, 1)).toBe(1000);
    expect(competitionPoints('paragraph-race', true, 0.5)).toBe(750);
    expect(competitionPoints('paragraph-race', true, 0)).toBe(500);
  });

  it('keeps 700 to 1000 for the other modes', () => {
    expect(competitionPoints('typed', true, 1)).toBe(1000);
    expect(competitionPoints('voice-buzz', true, 0)).toBe(700);
  });

  it('gives nothing for a wrong answer', () => {
    expect(competitionPoints('paragraph-race', false, 1)).toBe(0);
  });
});
