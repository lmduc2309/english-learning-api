import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  CreateCompetitionRoomDto,
  JoinCompetitionRoomDto,
  PlayerCredentialsDto,
  StartCompetitionDto,
  SubmitCompetitionAnswerDto,
  UseCompetitionHintDto,
} from './dto/competition.dto';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionQuestion, CompetitionRoom } from './entities/competition-room.entity';
import { LlmService } from '../llm/llm.service';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 12;

@Injectable()
export class CompetitionService {
  constructor(
    @InjectRepository(CompetitionRoom)
    private readonly rooms: Repository<CompetitionRoom>,
    @InjectRepository(CompetitionPlayer)
    private readonly players: Repository<CompetitionPlayer>,
    @InjectRepository(CompetitionAnswer)
    private readonly answers: Repository<CompetitionAnswer>,
    private readonly dataSource: DataSource,
    private readonly llm: LlmService,
  ) {}

  async createRoom(dto: CreateCompetitionRoomDto) {
    const hostToken = this.makeToken();
    const playerToken = this.makeToken();
    const words = [...new Set(dto.words.map((word) => word.trim().toLocaleLowerCase()))];
    const generated = await this.llm.generateRecallClues(words);
    const room = this.rooms.create({
      code: await this.makeRoomCode(),
      name: dto.name.trim(),
      hostName: dto.hostName.trim(),
      hostTokenHash: this.hash(hostToken),
      secondsPerQuestion: dto.secondsPerQuestion,
      status: 'lobby',
      startedAt: null,
      endedAt: null,
      questions: generated.map((card) => ({
        prompt: card.clue,
        answer: card.word,
        hint: this.makeHint(card.word),
      })),
    });
    await this.rooms.save(room);
    const player = await this.players.save(this.players.create({
      roomId: room.id,
      name: dto.hostName.trim(),
      tokenHash: this.hash(playerToken),
      score: 0,
      lastSeenAt: new Date(),
    }));

    return {
      code: room.code,
      hostToken,
      playerId: player.id,
      playerToken,
    };
  }

  async joinRoom(rawCode: string, dto: JoinCompetitionRoomDto) {
    const room = await this.getRoom(rawCode);
    await this.refreshRoomStatus(room);
    if (room.status !== 'lobby') {
      throw new ConflictException('This game has already started.');
    }
    const playerCount = await this.players.countBy({ roomId: room.id });
    if (playerCount >= MAX_PLAYERS) {
      throw new ConflictException('This room is full.');
    }

    const name = dto.name.trim();
    const duplicate = await this.players.findOneBy({ roomId: room.id, name });
    if (duplicate) {
      throw new ConflictException('That name is already being used in this room.');
    }

    const playerToken = this.makeToken();
    const player = await this.players.save(this.players.create({
      roomId: room.id,
      name,
      tokenHash: this.hash(playerToken),
      score: 0,
      lastSeenAt: new Date(),
    }));
    return { code: room.code, playerId: player.id, playerToken };
  }

  async getSnapshot(rawCode: string, credentials: PlayerCredentialsDto) {
    const room = await this.getRoom(rawCode);
    const player = await this.authenticatePlayer(room, credentials);
    await this.refreshRoomStatus(room);

    player.lastSeenAt = new Date();
    await this.players.save(player);

    const roomPlayers = await this.players.find({
      where: { roomId: room.id },
      order: { score: 'DESC', joinedAt: 'ASC' },
    });
    const playerAnswers = await this.answers.find({
      where: { roomId: room.id, playerId: player.id },
      order: { questionIndex: 'ASC' },
    });
    const now = Date.now();
    const questionIndex = this.currentQuestionIndex(room, now);
    const currentAnswer = questionIndex >= 0
      ? playerAnswers.find((answer) => answer.questionIndex === questionIndex)
      : undefined;
    const question = questionIndex >= 0 && questionIndex < room.questions.length
      ? room.questions[questionIndex]
      : undefined;
    const questionStart = room.startedAt && questionIndex >= 0
      ? room.startedAt.getTime() + questionIndex * room.secondsPerQuestion * 1000
      : null;
    const questionEnd = questionStart == null
      ? null
      : questionStart + room.secondsPerQuestion * 1000;

    return {
      code: room.code,
      name: room.name,
      hostName: room.hostName,
      status: room.status,
      questionCount: room.questions.length,
      secondsPerQuestion: room.secondsPerQuestion,
      startedAt: room.startedAt?.toISOString() ?? null,
      serverNow: new Date(now).toISOString(),
      questionIndex,
      question: question ? {
        prompt: question.prompt,
        hint: currentAnswer?.usedHint ? question.hint : null,
        answer: currentAnswer?.isCorrect != null || (questionEnd != null && now >= questionEnd)
          ? question.answer
          : null,
      } : null,
      questionEndsAt: questionEnd == null ? null : new Date(questionEnd).toISOString(),
      me: {
        id: player.id,
        name: player.name,
        score: player.score,
        answer: currentAnswer?.isCorrect == null ? null : {
          text: currentAnswer.answer,
          correct: currentAnswer.isCorrect,
          points: currentAnswer.points,
          usedHint: currentAnswer.usedHint,
        },
      },
      players: roomPlayers.map((entry, index) => ({
        id: entry.id,
        name: entry.name,
        score: entry.score,
        rank: index + 1,
        isHost: entry.name === room.hostName,
      })),
      results: room.status === 'finished'
        ? roomPlayers.map((entry, index) => ({
          id: entry.id,
          name: entry.name,
          score: entry.score,
          rank: index + 1,
        }))
        : null,
    };
  }

  async startRoom(rawCode: string, dto: StartCompetitionDto) {
    const room = await this.getRoom(rawCode);
    await this.authenticatePlayer(room, dto);
    if (this.hash(dto.hostToken) !== room.hostTokenHash) {
      throw new UnauthorizedException('Only the room host can start the game.');
    }
    if (room.status !== 'lobby') {
      throw new ConflictException('This game has already started.');
    }
    room.status = 'playing';
    // A short runway lets every polling client receive the same first question.
    room.startedAt = new Date(Date.now() + 3000);
    await this.rooms.save(room);
    return { startedAt: room.startedAt.toISOString() };
  }

  async useHint(rawCode: string, dto: UseCompetitionHintDto) {
    const room = await this.getRoom(rawCode);
    const player = await this.authenticatePlayer(room, dto);
    this.assertActiveQuestion(room, dto.questionIndex);

    let answer = await this.answers.findOneBy({
      playerId: player.id,
      questionIndex: dto.questionIndex,
    });
    if (answer?.isCorrect != null) {
      throw new ConflictException('You already answered this question.');
    }
    if (!answer) {
      answer = this.answers.create({
        roomId: room.id,
        playerId: player.id,
        questionIndex: dto.questionIndex,
        answer: '',
        isCorrect: null,
        usedHint: true,
        points: 0,
        responseMs: null,
      });
    } else {
      answer.usedHint = true;
    }
    await this.answers.save(answer);
    return { hint: room.questions[dto.questionIndex].hint, pointMultiplier: 0.5 };
  }

  async submitAnswer(rawCode: string, dto: SubmitCompetitionAnswerDto) {
    const room = await this.getRoom(rawCode);
    await this.authenticatePlayer(room, dto);
    this.assertActiveQuestion(room, dto.questionIndex);

    return this.dataSource.transaction(async (manager) => {
      const player = await manager.findOne(CompetitionPlayer, {
        where: { id: dto.playerId, roomId: room.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!player || player.tokenHash !== this.hash(dto.playerToken)) {
        throw new UnauthorizedException('Your player session is invalid.');
      }
      let attempt = await manager.findOne(CompetitionAnswer, {
        where: { playerId: player.id, questionIndex: dto.questionIndex },
        lock: { mode: 'pessimistic_write' },
      });
      if (attempt?.isCorrect != null) {
        throw new ConflictException('You already answered this question.');
      }

      const question = room.questions[dto.questionIndex];
      const correct = this.isCorrect(dto.answer, question.answer);
      const responseMs = Date.now()
        - room.startedAt!.getTime()
        - dto.questionIndex * room.secondsPerQuestion * 1000;
      const remainingRatio = Math.max(0, 1 - responseMs / (room.secondsPerQuestion * 1000));
      const rawPoints = correct ? 700 + Math.round(300 * remainingRatio) : 0;
      const points = attempt?.usedHint ? Math.round(rawPoints * 0.5) : rawPoints;

      if (!attempt) {
        attempt = manager.create(CompetitionAnswer, {
          roomId: room.id,
          playerId: player.id,
          questionIndex: dto.questionIndex,
          usedHint: false,
        });
      }
      attempt.answer = dto.answer.trim();
      attempt.isCorrect = correct;
      attempt.points = points;
      attempt.responseMs = Math.max(0, responseMs);
      await manager.save(attempt);

      player.score += points;
      player.lastSeenAt = new Date();
      await manager.save(player);
      return {
        correct,
        points,
        score: player.score,
        answer: question.answer,
      };
    });
  }

  private async getRoom(rawCode: string): Promise<CompetitionRoom> {
    const code = rawCode.trim().toUpperCase();
    const room = await this.rooms.findOneBy({ code });
    if (!room) throw new NotFoundException('Room not found. Check the code and try again.');
    return room;
  }

  private async authenticatePlayer(room: CompetitionRoom, credentials: PlayerCredentialsDto) {
    if (!credentials.playerId || !credentials.playerToken) {
      throw new UnauthorizedException('Join the room before viewing the game.');
    }
    const player = await this.players.findOneBy({ id: credentials.playerId, roomId: room.id });
    if (!player || player.tokenHash !== this.hash(credentials.playerToken)) {
      throw new UnauthorizedException('Your player session is invalid.');
    }
    return player;
  }

  private assertActiveQuestion(room: CompetitionRoom, questionIndex: number) {
    if (room.status !== 'playing' || !room.startedAt) {
      throw new ConflictException('The game is not currently running.');
    }
    if (this.currentQuestionIndex(room, Date.now()) !== questionIndex) {
      throw new BadRequestException('That question is no longer active.');
    }
  }

  private async refreshRoomStatus(room: CompetitionRoom) {
    if (room.status !== 'playing' || !room.startedAt) return;
    const finishAt = room.startedAt.getTime()
      + room.questions.length * room.secondsPerQuestion * 1000;
    if (Date.now() >= finishAt) {
      room.status = 'finished';
      room.endedAt = new Date(finishAt);
      await this.rooms.save(room);
    }
  }

  private currentQuestionIndex(room: CompetitionRoom, now: number) {
    if (room.status === 'lobby' || !room.startedAt) return -1;
    const index = Math.floor((now - room.startedAt.getTime()) / (room.secondsPerQuestion * 1000));
    if (index < 0) return -1;
    return Math.min(index, room.questions.length);
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isCorrect(given: string, expected: string) {
    const normalized = this.normalize(given);
    return expected.split(/[|/]/).some((answer) => this.normalize(answer) === normalized);
  }

  private makeHint(answer: string) {
    const words = answer.split(/\s+/);
    const shape = words
      .map((word) => `${word.charAt(0).toUpperCase()}${'•'.repeat(Math.max(0, word.length - 1))}`)
      .join(' ');
    const letters = words.reduce((total, word) => total + word.length, 0);
    return `${shape} · ${letters} letter${letters === 1 ? '' : 's'}`;
  }

  private makeToken() {
    return randomBytes(24).toString('hex');
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async makeRoomCode() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const bytes = randomBytes(6);
      const code = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
      if (!(await this.rooms.existsBy({ code }))) return code;
    }
    throw new ConflictException('Could not create a room code. Please try again.');
  }
}
