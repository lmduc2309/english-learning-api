import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { LlmService } from '../llm/llm.service';
import { CompetitionService } from './competition.service';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionRoom } from './entities/competition-room.entity';

describe('CompetitionService Hope Star', () => {
  const token = 't'.repeat(48);

  function setup(options: {
    selectedQuestion?: number | null;
    existingAnswer?: CompetitionAnswer;
    playerCount?: number;
    completedAnswerCount?: number;
    gameMode?: 'typed' | 'paragraph-race';
    elapsedMs?: number;
  } = {}) {
    const gameMode = options.gameMode ?? 'paragraph-race';
    const room = {
      id: 'room-1',
      code: 'ABC123',
      status: 'playing',
      startedAt: new Date(Date.now() - (options.elapsedMs ?? 1000)),
      secondsPerQuestion: 45,
      questions: [{
        type: 'fill-blank',
        gameMode,
        prompt: 'A [[1]] and [[2]] sentence.',
        answer: gameMode === 'paragraph-race' ? '["clear","short"]' : 'clear',
        answers: gameMode === 'paragraph-race' ? ['clear', 'short'] : undefined,
        options: gameMode === 'paragraph-race' ? ['short', 'clear'] : undefined,
        hint: '',
      }],
    } as CompetitionRoom;
    const player = {
      id: 'player-1',
      roomId: room.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      score: 0,
      hopeStarQuestionIndex: options.selectedQuestion ?? null,
      lastSeenAt: new Date(),
    } as CompetitionPlayer;
    const manager = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === CompetitionRoom) return room;
        if (entity === CompetitionPlayer) return player;
        if (entity === CompetitionAnswer) return options.existingAnswer ?? null;
        return null;
      }),
      count: jest.fn(async (entity: unknown) => entity === CompetitionPlayer
        ? options.playerCount ?? 1
        : options.completedAnswerCount ?? 1),
      create: jest.fn((_entity: unknown, input: object) => input),
      save: jest.fn(async (input: object) => input),
    };
    const rooms = {
      findOneBy: jest.fn(async () => room),
    } as unknown as Repository<CompetitionRoom>;
    const players = {
      findOneBy: jest.fn(async () => player),
    } as unknown as Repository<CompetitionPlayer>;
    const dataSource = {
      transaction: jest.fn(async (work: (transactionManager: typeof manager) => unknown) => work(manager)),
    } as unknown as DataSource;
    const service = new CompetitionService(
      rooms,
      players,
      {} as Repository<CompetitionAnswer>,
      dataSource,
      {} as LlmService,
    );
    const credentials = { playerId: player.id, playerToken: token, questionIndex: 0 };
    return { service, room, player, manager, credentials };
  }

  it('locks the one-time star to the active paragraph', async () => {
    const { service, player, credentials } = setup();

    await expect(service.activateHopeStar('ABC123', credentials)).resolves.toEqual({
      questionIndex: 0,
      bonusPoints: 1000,
    });
    expect(player.hopeStarQuestionIndex).toBe(0);
    await expect(service.activateHopeStar('ABC123', credentials)).rejects.toBeInstanceOf(ConflictException);
  });

  it('adds 1,000 points on top of the regular score for a correct starred answer', async () => {
    const { service, player, credentials } = setup({ selectedQuestion: 0 });

    const result = await service.submitAnswer('ABC123', {
      ...credentials,
      answer: '["clear","short"]',
    });

    expect(result.hopeStarBonus).toBe(1000);
    expect(result.points).toBe(result.basePoints + 1000);
    expect(player.score).toBe(result.points);
  });

  it('consumes the star without a bonus when the answer is wrong', async () => {
    const { service, player, credentials } = setup({ selectedQuestion: 0 });

    const result = await service.submitAnswer('ABC123', {
      ...credentials,
      answer: '["short","clear"]',
    });

    expect(result).toMatchObject({ correct: false, points: 0, basePoints: 0, hopeStarBonus: 0 });
    expect(player.score).toBe(0);
    expect(player.hopeStarQuestionIndex).toBe(0);
  });

  it.each([
    ['Paragraph Race', 'paragraph-race', '["clear","short"]'],
    ['Flashcard Race', 'typed', 'clear'],
  ] as const)('starts a five-second transition when everyone finishes %s', async (_label, gameMode, answer) => {
    const { service, room, credentials } = setup({ gameMode });
    const originalStart = room.startedAt!.getTime();

    await service.submitAnswer('ABC123', { ...credentials, answer });

    const remainingMs = room.startedAt!.getTime() + 45_000 - Date.now();
    expect(room.startedAt!.getTime()).toBeLessThan(originalStart);
    expect(remainingMs).toBeGreaterThanOrEqual(4900);
    expect(remainingMs).toBeLessThanOrEqual(5000);
  });

  it('keeps the normal deadline while another player is still answering', async () => {
    const { service, room, credentials } = setup({
      gameMode: 'typed',
      playerCount: 2,
      completedAnswerCount: 1,
    });
    const originalStart = room.startedAt!.getTime();

    await service.submitAnswer('ABC123', { ...credentials, answer: 'clear' });

    expect(room.startedAt!.getTime()).toBe(originalStart);
  });

  it('still gives a full five-second transition when the original timer is nearly over', async () => {
    const { service, room, credentials } = setup({ gameMode: 'typed', elapsedMs: 44_000 });

    await service.submitAnswer('ABC123', { ...credentials, answer: 'clear' });

    const remainingMs = room.startedAt!.getTime() + 45_000 - Date.now();
    expect(remainingMs).toBeGreaterThanOrEqual(4900);
    expect(remainingMs).toBeLessThanOrEqual(5000);
  });
});
