import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { VerbalMappingService } from './verbal-mapping.service';
import { VerbalMappingSession } from './entities/verbal-mapping-session.entity';
import { VerbalMappingAttempt } from './entities/verbal-mapping-attempt.entity';
import { LlmService } from '../llm/llm.service';
import { WordListService } from '../word-list/word-list.service';

function makeSessionRepo() {
  return {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: any) => ({ id: 'sess-uuid', ...x })),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

function makeAttemptRepo() {
  return {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: any) => ({ id: 'att-uuid', ...x })),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

async function buildService(overrides: {
  llmService?: Partial<LlmService>;
  wordListService?: Partial<WordListService>;
  sessionRepo?: ReturnType<typeof makeSessionRepo>;
  attemptRepo?: ReturnType<typeof makeAttemptRepo>;
} = {}) {
  const sessionRepo = overrides.sessionRepo ?? makeSessionRepo();
  const attemptRepo = overrides.attemptRepo ?? makeAttemptRepo();
  const module = await Test.createTestingModule({
    providers: [
      VerbalMappingService,
      { provide: getRepositoryToken(VerbalMappingSession), useValue: sessionRepo },
      { provide: getRepositoryToken(VerbalMappingAttempt), useValue: attemptRepo },
      {
        provide: LlmService,
        useValue: {
          generateVietnameseSentences: jest.fn(),
          gradeSpokenAnswer: jest.fn(),
          ...overrides.llmService,
        },
      },
      {
        provide: WordListService,
        useValue: {
          findAll: jest.fn(),
          ...overrides.wordListService,
        },
      },
    ],
  }).compile();
  return { svc: module.get(VerbalMappingService), sessionRepo, attemptRepo };
}

describe('VerbalMappingService.startSession', () => {
  it('generates sentences from typed words and persists a session', async () => {
    const llmService = {
      generateVietnameseSentences: jest.fn().mockResolvedValue([
        { vi: 'Tôi đi bộ.', words: ['walk'] },
        { vi: 'Anh ấy thông minh.', words: ['intelligent'] },
      ]),
    };
    const { svc, sessionRepo } = await buildService({ llmService });
    const result = await svc.startSession('user-1', {
      words: ['walk', 'intelligent'],
      numSentences: 2,
      difficulty: 'intermediate',
    });
    expect(llmService.generateVietnameseSentences).toHaveBeenCalledWith(
      ['walk', 'intelligent'],
      2,
      'intermediate',
    );
    expect(sessionRepo.save).toHaveBeenCalled();
    expect(result.sessionId).toBe('sess-uuid');
    expect(result.sentences).toEqual([
      { index: 0, vi: 'Tôi đi bộ.', words: ['walk'] },
      { index: 1, vi: 'Anh ấy thông minh.', words: ['intelligent'] },
    ]);
  });

  it('resolves words from wordListId when provided', async () => {
    const wordListService = {
      findAll: jest.fn().mockResolvedValue([
        { word: 'apple' },
        { word: 'banana' },
      ]),
    };
    const llmService = {
      generateVietnameseSentences: jest.fn().mockResolvedValue([
        { vi: 'Tôi ăn táo.', words: ['apple'] },
      ]),
    };
    const { svc } = await buildService({ llmService, wordListService });
    await svc.startSession('user-1', {
      words: [],
      wordListId: '00000000-0000-0000-0000-000000000001',
      numSentences: 1,
      difficulty: 'beginner',
    });
    expect(wordListService.findAll).toHaveBeenCalledWith('user-1');
    expect(llmService.generateVietnameseSentences).toHaveBeenCalledWith(
      ['apple', 'banana'],
      1,
      'beginner',
    );
  });

  it('throws 400 when no words and no wordListId resolve to anything', async () => {
    const { svc } = await buildService({});
    await expect(
      svc.startSession('user-1', {
        words: [],
        numSentences: 1,
        difficulty: 'beginner',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'No words provided',
    });
  });

  it('lowercases, dedupes, and trims typed words', async () => {
    const llmService = {
      generateVietnameseSentences: jest.fn().mockResolvedValue([
        { vi: 'x', words: ['walk'] },
      ]),
    };
    const { svc } = await buildService({ llmService });
    await svc.startSession('user-1', {
      words: ['Walk', '  walk  ', 'RUN', 'run'],
      numSentences: 1,
      difficulty: 'intermediate',
    });
    expect(llmService.generateVietnameseSentences).toHaveBeenCalledWith(
      ['walk', 'run'],
      1,
      'intermediate',
    );
  });
});

describe('VerbalMappingService.submitAttempt', () => {
  const sampleSession = {
    id: 'sess-1',
    userId: 'user-1',
    finishedAt: null,
    sentences: [
      { index: 0, vi: 'Tôi đi bộ.', words: ['walk'] },
      { index: 1, vi: 'Anh ấy thông minh.', words: ['intelligent'] },
    ],
  };

  it('grades a transcript and upserts an attempt row', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    const llmService = {
      gradeSpokenAnswer: jest.fn().mockResolvedValue({
        verdict: 'correct',
        score: 90,
        feedback: 'Great job!',
        suggestedAnswer: 'I walk.',
      }),
    };
    const { svc } = await buildService({ sessionRepo, attemptRepo, llmService });
    const result = await svc.submitAttempt('user-1', 'sess-1', {
      sentenceIndex: 0,
      transcript: 'I walked',
    });
    expect(llmService.gradeSpokenAnswer).toHaveBeenCalledWith({
      vietnamese: 'Tôi đi bộ.',
      userTranscript: 'I walked',
      words: ['walk'],
    });
    expect(attemptRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        userId: 'user-1',
        sentenceIndex: 0,
        viSentence: 'Tôi đi bộ.',
        targetWords: ['walk'],
        transcript: 'I walked',
        verdict: 'correct',
        score: 90,
        feedback: 'Great job!',
        suggestedAnswer: 'I walk.',
      }),
      ['sessionId', 'sentenceIndex'],
    );
    expect(result).toEqual({
      verdict: 'correct',
      score: 90,
      feedback: 'Great job!',
      suggestedAnswer: 'I walk.',
    });
  });

  it('returns 404 when the session does not exist or belongs to another user', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(null);
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 0,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('returns 409 when the session is already finished', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      ...sampleSession,
      finishedAt: new Date(),
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 0,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('returns 404 when sentenceIndex is out of range', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 99,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('persists a safe fallback grade when LlmService.gradeSpokenAnswer throws', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    const llmService = {
      gradeSpokenAnswer: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { svc } = await buildService({ sessionRepo, attemptRepo, llmService });
    const result = await svc.submitAttempt('user-1', 'sess-1', {
      sentenceIndex: 0,
      transcript: 'I walked',
    });
    expect(result.verdict).toBe('partial');
    expect(result.score).toBe(50);
    expect(result.feedback).toMatch(/could not grade/i);
    expect(result.suggestedAnswer).toBe('Tôi đi bộ.');
    expect(attemptRepo.upsert).toHaveBeenCalled();
  });
});

describe('VerbalMappingService.finish', () => {
  const sampleSession = {
    id: 'sess-1',
    userId: 'user-1',
    finishedAt: null,
    sentences: [
      { index: 0, vi: 'A', words: ['x'] },
      { index: 1, vi: 'B', words: ['y'] },
    ],
  };

  it('computes total score, sets finishedAt, and returns summary', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([
      { score: 80, verdict: 'correct', targetWords: ['x'] },
      { score: 60, verdict: 'partial', targetWords: ['y'] },
    ]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.finish('user-1', 'sess-1');
    expect(result.totalScore).toBe(70);
    expect(result.rounds).toBe(2);
    expect(result.perWord).toEqual(
      expect.arrayContaining([
        { word: 'x', attempts: 1, avgScore: 80 },
        { word: 'y', attempts: 1, avgScore: 60 },
      ]),
    );
    expect(sessionRepo.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      expect.objectContaining({ finishedAt: expect.any(Date), totalScore: '70.00' }),
    );
  });

  it('returns 404 when session is missing or owned by someone else', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(null);
    const { svc } = await buildService({ sessionRepo });
    await expect(svc.finish('user-1', 'sess-1')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('returns 409 when session is already finished', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      ...sampleSession,
      finishedAt: new Date(),
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(svc.finish('user-1', 'sess-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('totalScore is 0 when there are no attempts', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.finish('user-1', 'sess-1');
    expect(result.totalScore).toBe(0);
    expect(result.rounds).toBe(0);
    expect(result.perWord).toEqual([]);
  });
});

describe('VerbalMappingService.getSummary', () => {
  it('returns the summary of a previously-finished session', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      finishedAt: new Date(),
      sentences: [],
    });
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([
      { score: 100, verdict: 'correct', targetWords: ['a'] },
    ]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.getSummary('user-1', 'sess-1');
    expect(result.totalScore).toBe(100);
    expect(result.rounds).toBe(1);
  });

  it('returns 404 when the session is owned by another user', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      userId: 'other-user',
      finishedAt: new Date(),
      sentences: [],
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.getSummary('user-1', 'sess-1'),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });
});
