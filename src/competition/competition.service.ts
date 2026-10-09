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
  ClaimCompetitionTurnDto,
  JoinCompetitionRoomDto,
  PlayerCredentialsDto,
  StartCompetitionDto,
  SubmitCompetitionAnswerDto,
  UseCompetitionHintDto,
} from './dto/competition.dto';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import {
  CompetitionQuestion,
  CompetitionRoom,
} from './entities/competition-room.entity';
import { LlmService } from '../llm/llm.service';
import {
  competitionPoints,
  inferCompetitionQuestionMode,
  inferCompetitionGameMode,
  makeParagraphWordSets,
  makeCompetitionQuestionRequests,
  paragraphAnswersMatch,
  parseManualParagraph,
  PARAGRAPH_RACE_SECONDS,
} from './competition-questions';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 12;
const MAX_VOICE_ATTEMPTS = 3;
const VOICE_COUNTDOWN_MS = 3000;
const VOICE_SPEAKING_MS = 6000;
const VOICE_CLAIM_WINDOW_MS = VOICE_COUNTDOWN_MS + VOICE_SPEAKING_MS;

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
    const words = [...new Set((dto.words ?? [])
      .map((word) => word.trim().toLocaleLowerCase())
      .filter(Boolean))];
    const questionMode = dto.questionMode ?? 'recall';
    const gameMode = dto.gameMode ?? 'typed';
    if (dto.paragraphs && gameMode !== 'paragraph-race') {
      throw new BadRequestException('Only Paragraph Race accepts written paragraphs.');
    }
    if (gameMode === 'paragraph-race' && !dto.paragraphs && (words.length < 60 || words.length > 90)) {
      throw new BadRequestException('Paragraph Race requires 60 to 90 unique words.');
    }
    if (gameMode !== 'paragraph-race' && words.length > 30) {
      throw new BadRequestException('Flashcard races support up to 30 unique words.');
    }

    let questions: CompetitionQuestion[];
    if (gameMode === 'paragraph-race') {
      const generated = dto.paragraphs
        ? this.parseManualParagraphs(dto.paragraphs)
        : await this.llm.generateParagraphRaceCards(makeParagraphWordSets(words));
      questions = generated.map((card) => ({
        type: 'fill-blank',
        gameMode,
        prompt: card.prompt,
        answer: JSON.stringify(card.answers),
        answers: card.answers,
        options: this.shuffle(card.answers),
        hint: '',
      }));
    } else {
      const effectiveQuestionMode = gameMode === 'voice-buzz' ? 'fill-blank' : questionMode;
      const requests = makeCompetitionQuestionRequests(words, effectiveQuestionMode);
      const generated = await this.llm.generateCompetitionCards(requests);
      questions = generated.map((card) => ({
        type: card.type,
        gameMode,
        partOfSpeech: card.partOfSpeech,
        prompt: card.prompt,
        answer: card.word,
        hint: this.makeHint(card.word),
      }));
    }
    const room = this.rooms.create({
      code: await this.makeRoomCode(),
      name: dto.name.trim(),
      hostName: dto.hostName.trim(),
      hostTokenHash: this.hash(hostToken),
      secondsPerQuestion: gameMode === 'paragraph-race' ? PARAGRAPH_RACE_SECONDS : dto.secondsPerQuestion,
      status: 'lobby',
      startedAt: null,
      endedAt: null,
      questions,
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
    const now = Date.now();
    const questionIndex = this.currentQuestionIndex(room, now);
    const gameMode = inferCompetitionGameMode(room.questions);
    const playerAnswers = await this.answers.find({
      where: { roomId: room.id, playerId: player.id },
      order: { questionIndex: 'ASC' },
    });
    const allAnswers = gameMode === 'voice-buzz' && questionIndex >= 0
      ? await this.answers.find({
        where: { roomId: room.id, questionIndex },
        order: { createdAt: 'ASC' },
        relations: { player: true },
      })
      : [];
    const claim = gameMode === 'voice-buzz'
      ? this.describeVoiceClaim(allAnswers, room.questions[questionIndex], now)
      : null;
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
    const revealAnswer = currentAnswer?.isCorrect != null
      || (questionEnd != null && now >= questionEnd);

    return {
      code: room.code,
      name: room.name,
      hostName: room.hostName,
      status: room.status,
      gameMode,
      questionMode: inferCompetitionQuestionMode(room.questions),
      questionCount: room.questions.length,
      secondsPerQuestion: room.secondsPerQuestion,
      startedAt: room.startedAt?.toISOString() ?? null,
      serverNow: new Date(now).toISOString(),
      questionIndex,
      question: question ? {
        type: question.type ?? 'recall',
        gameMode: question.gameMode ?? 'typed',
        partOfSpeech: question.partOfSpeech,
        prompt: question.prompt,
        hint: currentAnswer?.usedHint ? question.hint : null,
        claim,
        options: gameMode === 'paragraph-race' ? question.options ?? [] : undefined,
        answers: gameMode === 'paragraph-race'
          ? revealAnswer ? question.answers ?? [] : null
          : undefined,
        answer: gameMode === 'paragraph-race'
          ? null
          : gameMode === 'voice-buzz'
          ? (claim?.status === 'resolved' || claim?.status === 'exhausted' || (questionEnd != null && now >= questionEnd))
            ? question.answer
            : null
          : revealAnswer
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
    if (inferCompetitionGameMode(room.questions) === 'paragraph-race') {
      throw new ConflictException('Hints are not used in Paragraph Race.');
    }
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

  async claimTurn(rawCode: string, dto: ClaimCompetitionTurnDto) {
    const room = await this.getRoom(rawCode);
    const player = await this.authenticatePlayer(room, dto);
    if (inferCompetitionGameMode(room.questions) !== 'voice-buzz') {
      throw new ConflictException('This room uses typed answers.');
    }
    this.assertActiveQuestion(room, dto.questionIndex);

    return this.dataSource.transaction(async (manager) => {
      const lockedRoom = await manager.findOne(CompetitionRoom, {
        where: { id: room.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRoom) throw new NotFoundException('Room not found.');
      const attempts = await manager.find(CompetitionAnswer, {
        where: { roomId: room.id, questionIndex: dto.questionIndex },
        order: { createdAt: 'ASC' },
      });
      if (attempts.some((attempt) => attempt.isCorrect === true)) {
        throw new ConflictException('This question has already been solved.');
      }
      if (attempts.length >= MAX_VOICE_ATTEMPTS) {
        throw new ConflictException('This question has used all 3 attempts.');
      }
      const pending = attempts.find((attempt) => attempt.isCorrect === null
        && Date.now() - attempt.createdAt.getTime() < VOICE_CLAIM_WINDOW_MS);
      if (pending) {
        throw new ConflictException('Another player currently has the speaking turn.');
      }
      if (attempts.some((attempt) => attempt.playerId === player.id)) {
        throw new ConflictException('You already used your turn on this question.');
      }
      const attempt = await manager.save(manager.create(CompetitionAnswer, {
        roomId: room.id,
        playerId: player.id,
        questionIndex: dto.questionIndex,
        answer: '',
        isCorrect: null,
        usedHint: false,
        points: 0,
        responseMs: null,
      }));
      return {
        attemptCount: attempts.length + 1,
        maxAttempts: MAX_VOICE_ATTEMPTS,
        claimedBy: { id: player.id, name: player.name },
        claimEndsAt: new Date(attempt.createdAt.getTime() + VOICE_CLAIM_WINDOW_MS).toISOString(),
      };
    });
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
      const isVoiceBuzz = inferCompetitionGameMode(room.questions) === 'voice-buzz';
      if (isVoiceBuzz) {
        if (!attempt) throw new ConflictException('Claim the speaking turn first.');
        const claimAge = Date.now() - attempt.createdAt.getTime();
        if (claimAge < VOICE_COUNTDOWN_MS) {
          throw new ConflictException('Wait for the countdown to finish.');
        }
        if (claimAge >= VOICE_CLAIM_WINDOW_MS) {
          attempt.answer = dto.answer.trim();
          attempt.isCorrect = false;
          attempt.points = 0;
          attempt.responseMs = VOICE_CLAIM_WINDOW_MS;
          await manager.save(attempt);
          return { correct: false, points: 0, score: player.score, answer: question.answer };
        }
      }
      const correct = isVoiceBuzz || inferCompetitionGameMode(room.questions) !== 'paragraph-race'
        ? this.isCorrect(dto.answer, question.answer)
        : paragraphAnswersMatch(dto.answer, question.answers ?? []);
      const responseMs = Date.now()
        - room.startedAt!.getTime()
        - dto.questionIndex * room.secondsPerQuestion * 1000;
      const remainingRatio = Math.max(0, 1 - responseMs / (room.secondsPerQuestion * 1000));
      const rawPoints = competitionPoints(inferCompetitionGameMode(room.questions), correct, remainingRatio);
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
        answer: inferCompetitionGameMode(room.questions) === 'paragraph-race'
          ? null
          : question.answer,
        answers: inferCompetitionGameMode(room.questions) === 'paragraph-race'
          ? question.answers ?? []
          : undefined,
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

  private parseManualParagraphs(paragraphs: string[]) {
    return paragraphs.map((text, index) => {
      const parsed = parseManualParagraph(text);
      if ('error' in parsed) {
        throw new BadRequestException(`Paragraph ${index + 1} ${parsed.error}.`);
      }
      return parsed;
    });
  }

  private shuffle(words: string[]) {
    const result = [...words];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = randomBytes(1)[0] % (index + 1);
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    if (result.length > 1 && result.every((word, index) => word === words[index])) {
      result.push(result.shift()!);
    }
    return result;
  }

  private makeHint(answer: string) {
    const words = answer.split(/\s+/);
    const shape = words
      .map((word) => `${word.charAt(0).toUpperCase()}${'•'.repeat(Math.max(0, word.length - 1))}`)
      .join(' ');
    const letters = words.reduce((total, word) => total + word.length, 0);
    return `${shape} · ${letters} letter${letters === 1 ? '' : 's'}`;
  }

  private describeVoiceClaim(
    attempts: CompetitionAnswer[],
    question: { answer: string } | undefined,
    now: number,
  ) {
    if (!question) return null;
    const attemptCount = attempts.length;
    if (attempts.some((attempt) => attempt.isCorrect === true)) {
      return { status: 'resolved' as const, attemptCount, maxAttempts: MAX_VOICE_ATTEMPTS, claimedBy: null, claimEndsAt: null };
    }
    const pending = attempts.find((attempt) => attempt.isCorrect === null
      && now - attempt.createdAt.getTime() < VOICE_CLAIM_WINDOW_MS);
    if (pending) {
      const countdownEndsAt = pending.createdAt.getTime() + VOICE_COUNTDOWN_MS;
      return {
        status: now < countdownEndsAt ? 'countdown' as const : 'speaking' as const,
        attemptCount,
        maxAttempts: MAX_VOICE_ATTEMPTS,
        claimedBy: pending.player ? { id: pending.player.id, name: pending.player.name } : { id: pending.playerId, name: 'A player' },
        claimEndsAt: new Date(pending.createdAt.getTime() + VOICE_CLAIM_WINDOW_MS).toISOString(),
      };
    }
    if (attemptCount >= MAX_VOICE_ATTEMPTS) {
      return { status: 'exhausted' as const, attemptCount, maxAttempts: MAX_VOICE_ATTEMPTS, claimedBy: null, claimEndsAt: null };
    }
    return { status: 'idle' as const, attemptCount, maxAttempts: MAX_VOICE_ATTEMPTS, claimedBy: null, claimEndsAt: null };
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
