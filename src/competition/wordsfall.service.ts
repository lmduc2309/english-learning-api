import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CreateWordsfallRoomDto, JoinWordsfallRoomDto, StartWordsfallRoomDto, SubmitWordsfallAnswerDto, WordsfallCredentialsDto } from './dto/wordsfall.dto';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionRoom } from './entities/competition-room.entity';

export const WORDSFALL_DURATION_MS = 90_000;
export const WORDSFALL_SPAWN_MS = 2_100;
export const WORDSFALL_FALL_MS = 7_500;
const WORD_COUNT = Math.ceil(WORDSFALL_DURATION_MS / WORDSFALL_SPAWN_MS);
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function normalize(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('vi').trim().replace(/\s+/g, ' ');
}

@Injectable()
export class WordsfallService {
  constructor(
    @InjectRepository(CompetitionRoom) private readonly rooms: Repository<CompetitionRoom>,
    @InjectRepository(CompetitionPlayer) private readonly players: Repository<CompetitionPlayer>,
    @InjectRepository(CompetitionAnswer) private readonly answers: Repository<CompetitionAnswer>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateWordsfallRoomDto) {
    const pairs = dto.pairs.map((pair) => ({ en: pair.en.trim(), vi: pair.vi.trim() }));
    if (pairs.some((pair) => !pair.en || !pair.vi)) throw new BadRequestException('Every word pair needs both languages.');
    const unique = new Set(pairs.map((pair) => `${normalize(pair.en)}|${normalize(pair.vi)}`));
    if (unique.size < 3) throw new BadRequestException('Add at least 3 different word pairs.');
    const hostToken = this.token();
    const playerToken = this.token();
    const shuffled = [...pairs];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = randomBytes(1)[0] % (index + 1);
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    const questions = Array.from({ length: WORD_COUNT }, (_, index) => {
      const pair = shuffled[index % shuffled.length];
      return {
        type: 'recall' as const,
        gameMode: 'wordsfall' as const,
        prompt: dto.direction === 'en-vi' ? pair.en : pair.vi,
        answer: dto.direction === 'en-vi' ? pair.vi : pair.en,
        hint: dto.direction,
      };
    });
    const room = await this.rooms.save(this.rooms.create({
      code: await this.roomCode(), name: dto.name.trim(), hostName: dto.hostName.trim(),
      hostTokenHash: this.hash(hostToken), status: 'lobby',
      questions, secondsPerQuestion: 90, startedAt: null, endedAt: null,
    }));
    const player = await this.players.save(this.players.create({
      roomId: room.id, name: dto.hostName.trim(), tokenHash: this.hash(playerToken),
      score: 0, lastSeenAt: new Date(),
    }));
    return { code: room.code, playerId: player.id, playerToken, hostToken };
  }

  async join(rawCode: string, dto: JoinWordsfallRoomDto) {
    const room = await this.room(rawCode);
    if (room.status !== 'lobby') throw new ConflictException('This Wordsfall round has already started.');
    if (await this.players.countBy({ roomId: room.id }) >= 12) throw new ConflictException('This room is full.');
    const name = dto.name.trim();
    if (await this.players.existsBy({ roomId: room.id, name })) throw new ConflictException('That name is already used in this room.');
    const playerToken = this.token();
    const player = await this.players.save(this.players.create({
      roomId: room.id, name, tokenHash: this.hash(playerToken), score: 0, lastSeenAt: new Date(),
    }));
    return { code: room.code, playerId: player.id, playerToken };
  }

  async snapshot(rawCode: string, credentials: WordsfallCredentialsDto) {
    const room = await this.room(rawCode);
    const player = await this.auth(room, credentials);
    const now = Date.now();
    await this.finishIfNeeded(room, now);
    player.lastSeenAt = new Date(now);
    await this.players.save(player);
    const [players, solved] = await Promise.all([
      this.players.find({ where: { roomId: room.id }, order: { score: 'DESC', joinedAt: 'ASC' } }),
      this.answers.find({ where: { roomId: room.id, playerId: player.id, isCorrect: true } }),
    ]);
    return {
      code: room.code, name: room.name, hostName: room.hostName, status: room.status,
      direction: room.questions[0].hint as 'en-vi' | 'vi-en',
      startedAt: room.startedAt?.toISOString() ?? null,
      endsAt: room.startedAt ? new Date(room.startedAt.getTime() + WORDSFALL_DURATION_MS).toISOString() : null,
      serverNow: new Date(now).toISOString(), durationMs: WORDSFALL_DURATION_MS,
      spawnIntervalMs: WORDSFALL_SPAWN_MS, fallMs: WORDSFALL_FALL_MS,
      words: room.questions.map((question, index) => ({ index, prompt: question.prompt, answer: question.answer })),
      solvedIndices: solved.map((entry) => entry.questionIndex),
      me: { id: player.id, name: player.name, score: player.score },
      players: players.map((entry, index) => ({ id: entry.id, name: entry.name, score: entry.score, rank: index + 1, isHost: entry.name === room.hostName })),
    };
  }

  async start(rawCode: string, dto: StartWordsfallRoomDto) {
    const room = await this.room(rawCode);
    await this.auth(room, dto);
    if (this.hash(dto.hostToken) !== room.hostTokenHash) throw new UnauthorizedException('Only the host can start the round.');
    if (room.status !== 'lobby') throw new ConflictException('This round has already started.');
    room.status = 'playing';
    room.startedAt = new Date(Date.now() + 3_000);
    await this.rooms.save(room);
    return { startedAt: room.startedAt.toISOString() };
  }

  async answer(rawCode: string, dto: SubmitWordsfallAnswerDto) {
    const room = await this.room(rawCode);
    if (room.questions[0]?.gameMode !== 'wordsfall') throw new NotFoundException('Wordsfall room not found.');
    return this.dataSource.transaction(async (manager) => {
      const lockedRoom = await manager.findOne(CompetitionRoom, { where: { id: room.id }, lock: { mode: 'pessimistic_write' } });
      if (!lockedRoom || !lockedRoom.startedAt || lockedRoom.status !== 'playing') throw new ConflictException('The round is not running.');
      const player = await manager.findOne(CompetitionPlayer, { where: { id: dto.playerId, roomId: room.id }, lock: { mode: 'pessimistic_write' } });
      if (!player || player.tokenHash !== this.hash(dto.playerToken)) throw new UnauthorizedException('Your player session is invalid.');
      const question = lockedRoom.questions[dto.wordIndex];
      if (!question) throw new BadRequestException('That word does not exist.');
      const elapsed = Date.now() - lockedRoom.startedAt.getTime();
      const wordAge = elapsed - dto.wordIndex * WORDSFALL_SPAWN_MS;
      if (elapsed < 0 || elapsed >= WORDSFALL_DURATION_MS || wordAge < 0 || wordAge >= WORDSFALL_FALL_MS) {
        throw new ConflictException('That word has already fallen.');
      }
      if (await manager.exists(CompetitionAnswer, { where: { playerId: player.id, questionIndex: dto.wordIndex } })) {
        throw new ConflictException('You already scored this word.');
      }
      if (normalize(dto.answer) !== normalize(question.answer)) return { correct: false, points: 0, score: player.score };
      const points = 100 + Math.round(50 * (1 - wordAge / WORDSFALL_FALL_MS));
      await manager.save(manager.create(CompetitionAnswer, {
        roomId: room.id, playerId: player.id, questionIndex: dto.wordIndex,
        answer: dto.answer.trim(), isCorrect: true, points, usedHint: false, responseMs: Math.max(0, wordAge),
      }));
      player.score += points;
      player.lastSeenAt = new Date();
      await manager.save(player);
      return { correct: true, points, score: player.score };
    });
  }

  private async finishIfNeeded(room: CompetitionRoom, now: number) {
    if (room.status !== 'playing' || !room.startedAt) return;
    const end = room.startedAt.getTime() + WORDSFALL_DURATION_MS;
    if (now >= end) { room.status = 'finished'; room.endedAt = new Date(end); await this.rooms.save(room); }
  }

  private async room(rawCode: string) {
    const room = await this.rooms.findOneBy({ code: rawCode.trim().toUpperCase() });
    if (!room || room.questions[0]?.gameMode !== 'wordsfall') throw new NotFoundException('Wordsfall room not found.');
    return room;
  }

  private async auth(room: CompetitionRoom, credentials: WordsfallCredentialsDto) {
    if (!credentials.playerId || !credentials.playerToken) throw new UnauthorizedException('Join the room first.');
    const player = await this.players.findOneBy({ id: credentials.playerId, roomId: room.id });
    if (!player || player.tokenHash !== this.hash(credentials.playerToken)) throw new UnauthorizedException('Your player session is invalid.');
    return player;
  }

  private token() { return randomBytes(24).toString('hex'); }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private async roomCode() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const bytes = randomBytes(6);
      const code = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
      if (!(await this.rooms.existsBy({ code }))) return code;
    }
    throw new ConflictException('Could not create a room code. Please try again.');
  }
}
