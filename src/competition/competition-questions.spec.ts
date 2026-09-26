import {
  inferCompetitionQuestionMode,
  makeCompetitionQuestionRequests,
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
});
