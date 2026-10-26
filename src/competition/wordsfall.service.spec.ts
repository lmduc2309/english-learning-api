import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionRoom } from './entities/competition-room.entity';
import { WordsfallService, WORDSFALL_DURATION_MS, WORDSFALL_FALL_MS, WORDSFALL_SPAWN_MS } from './wordsfall.service';

describe('WordsfallService', () => {
  function createService() {
    const room = {
      id: 'room-1', code: 'ABC123', status: 'playing',
      startedAt: new Date(Date.now() - 1000),
      questions: [{ type: 'recall', gameMode: 'wordsfall', prompt: 'apple', answer: 'quả táo', hint: 'en-vi' }],
    } as CompetitionRoom;
    const player = { id: 'player-1', roomId: room.id, name: 'Linh', tokenHash: '', score: 0 } as CompetitionPlayer;
    const rooms = {
      findOneBy: jest.fn().mockResolvedValue(room),
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest.fn((input) => ({ id: room.id, ...input })),
      save: jest.fn(async (input) => input),
    } as unknown as Repository<CompetitionRoom>;
    const players = {
      create: jest.fn((input) => ({ id: player.id, ...input })),
      save: jest.fn(async (input) => input),
    } as unknown as Repository<CompetitionPlayer>;
    const manager = {
      findOne: jest.fn(async (entity) => entity === CompetitionRoom ? room : player),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((_entity, input) => input),
      save: jest.fn(async (input) => input),
    };
    const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) } as unknown as DataSource;
    const service = new WordsfallService(rooms, players, {} as Repository<CompetitionAnswer>, dataSource);
    return { service, room, player, rooms, manager };
  }

  it('creates one shared 90-second schedule from host word pairs', async () => {
    const { service, rooms } = createService();
    await service.create({
      name: 'Wordsfall friends', hostName: 'Linh', direction: 'vi-en',
      pairs: [{ en: 'apple', vi: 'quả táo' }, { en: 'book', vi: 'quyển sách' }, { en: 'water', vi: 'nước' }],
    });
    const created = (rooms.create as jest.Mock).mock.calls[0][0] as CompetitionRoom;
    expect(created.questions).toHaveLength(Math.ceil(WORDSFALL_DURATION_MS / WORDSFALL_SPAWN_MS));
    expect(created.questions[0].gameMode).toBe('wordsfall');
    expect(created.questions[0].hint).toBe('vi-en');
    expect(created.questions.every((word) => ['quả táo', 'quyển sách', 'nước'].includes(word.prompt))).toBe(true);
  });

  it('scores a correct live word once using the server clock', async () => {
    const { service, player, manager } = createService();
    player.tokenHash = createHash('sha256').update('x'.repeat(48)).digest('hex');
    const result = await service.answer('ABC123', {
      playerId: player.id, playerToken: 'x'.repeat(48), wordIndex: 0, answer: '  Quả Táo  ',
    });
    expect(result.correct).toBe(true);
    expect(result.points).toBeGreaterThanOrEqual(100);
    expect(result.points).toBeLessThanOrEqual(150);
    expect(player.score).toBe(result.points);
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired word without changing the score', async () => {
    const { service, room, player, manager } = createService();
    player.tokenHash = createHash('sha256').update('x'.repeat(48)).digest('hex');
    room.startedAt = new Date(Date.now() - WORDSFALL_FALL_MS - 100);
    await expect(service.answer('ABC123', {
      playerId: player.id, playerToken: 'x'.repeat(48), wordIndex: 0, answer: 'quả táo',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(player.score).toBe(0);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not award a second score for the same player and word', async () => {
    const { service, player, manager } = createService();
    player.tokenHash = createHash('sha256').update('x'.repeat(48)).digest('hex');
    manager.exists.mockResolvedValue(true);
    await expect(service.answer('ABC123', {
      playerId: player.id, playerToken: 'x'.repeat(48), wordIndex: 0, answer: 'quả táo',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(player.score).toBe(0);
  });
});
