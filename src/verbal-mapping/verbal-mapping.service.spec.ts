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
