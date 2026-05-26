import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmService } from '../llm/llm.service';
import { WordListService } from '../word-list/word-list.service';
import { VerbalMappingSession } from './entities/verbal-mapping-session.entity';
import { VerbalMappingAttempt } from './entities/verbal-mapping-attempt.entity';
import { StartSessionDto } from './dto/start-session.dto';
import { StartSessionResponseDto } from './dto/start-session.response.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitAttemptResponseDto } from './dto/submit-attempt.response.dto';
import { FinishSessionResponseDto } from './dto/finish-session.response.dto';

@Injectable()
export class VerbalMappingService {
  private readonly logger = new Logger(VerbalMappingService.name);

  constructor(
    @InjectRepository(VerbalMappingSession)
    private sessionRepo: Repository<VerbalMappingSession>,
    @InjectRepository(VerbalMappingAttempt)
    private attemptRepo: Repository<VerbalMappingAttempt>,
    private llmService: LlmService,
    private wordListService: WordListService,
  ) {}

  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    // 1. Resolve words: prefer wordListId, else typed
    let words: string[];
    if (dto.wordListId) {
      const items = await this.wordListService.findAll(userId);
      words = items.map((i: { word: string }) => i.word);
    } else {
      words = dto.words;
    }
    // Normalize: lowercase + trim + dedupe; preserve first-seen order; cap at 30
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const w of words) {
      const cleaned = w.trim().toLowerCase();
      if (cleaned.length > 0 && !seen.has(cleaned)) {
        seen.add(cleaned);
        normalized.push(cleaned);
        if (normalized.length >= 30) break;
      }
    }
    if (normalized.length === 0) {
      throw new HttpException('No words provided', HttpStatus.BAD_REQUEST);
    }

    // 2. Generate sentences via LLM. Wrap any failure (parse / network / model)
    //    as 502 per the spec so the client sees a "try again" signal rather
    //    than a generic 500.
    let generated: Array<{ vi: string; words: string[] }>;
    try {
      generated = await this.llmService.generateVietnameseSentences(
        normalized,
        dto.numSentences,
        dto.difficulty,
      );
    } catch (err) {
      this.logger.warn(
        `Sentence generation failed for user=${userId}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Failed to generate sentences, please try again',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const sentences = generated.map((s, idx) => ({
      index: idx,
      vi: s.vi,
      words: s.words,
    }));

    // 3. Persist session
    const entity = this.sessionRepo.create({
      userId,
      wordListId: dto.wordListId ?? null,
      sourceWords: normalized,
      numSentences: dto.numSentences,
      difficulty: dto.difficulty,
      sentences,
      finishedAt: null,
      totalScore: null,
    });
    const saved = await this.sessionRepo.save(entity);
    return { sessionId: saved.id, sentences };
  }

  async submitAttempt(
    userId: string,
    sessionId: string,
    dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptResponseDto> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    if (session.finishedAt) {
      throw new HttpException(
        'Session already finished',
        HttpStatus.CONFLICT,
      );
    }
    const sentence = session.sentences.find(
      (s) => s.index === dto.sentenceIndex,
    );
    if (!sentence) {
      throw new HttpException('Sentence not found', HttpStatus.NOT_FOUND);
    }

    let grade: SubmitAttemptResponseDto;
    try {
      grade = await this.llmService.gradeSpokenAnswer({
        vietnamese: sentence.vi,
        userTranscript: dto.transcript,
        words: sentence.words,
      });
    } catch (err) {
      this.logger.warn(
        `Grading failed for session=${sessionId} index=${dto.sentenceIndex}: ${(err as Error).message}`,
      );
      grade = {
        verdict: 'partial',
        score: 50,
        feedback: 'Could not grade that attempt; please try again.',
        suggestedAnswer: sentence.vi,
      };
    }

    await this.attemptRepo.upsert(
      {
        sessionId,
        userId,
        sentenceIndex: dto.sentenceIndex,
        viSentence: sentence.vi,
        targetWords: sentence.words,
        transcript: dto.transcript,
        verdict: grade.verdict,
        score: grade.score,
        feedback: grade.feedback,
        suggestedAnswer: grade.suggestedAnswer,
      },
      ['sessionId', 'sentenceIndex'],
    );

    return grade;
  }

  async finish(
    userId: string,
    sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    if (session.finishedAt) {
      throw new HttpException('Session already finished', HttpStatus.CONFLICT);
    }
    const summary = await this.buildSummary(userId, sessionId);
    await this.sessionRepo.update(
      { id: sessionId },
      {
        finishedAt: new Date(),
        totalScore: summary.totalScore.toFixed(2),
      },
    );
    return summary;
  }

  async getSummary(
    userId: string,
    sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    return this.buildSummary(userId, sessionId);
  }

  private async buildSummary(
    _userId: string,
    sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    const attempts = await this.attemptRepo.find({
      where: { sessionId },
    });
    if (attempts.length === 0) {
      return { totalScore: 0, rounds: 0, perWord: [] };
    }
    const totalScore = Math.round(
      attempts.reduce((acc, a) => acc + (a.score ?? 0), 0) / attempts.length,
    );
    const perWordMap = new Map<string, { sum: number; count: number }>();
    for (const a of attempts) {
      for (const w of a.targetWords ?? []) {
        const cur = perWordMap.get(w) ?? { sum: 0, count: 0 };
        cur.sum += a.score ?? 0;
        cur.count += 1;
        perWordMap.set(w, cur);
      }
    }
    const perWord = Array.from(perWordMap.entries()).map(([word, v]) => ({
      word,
      attempts: v.count,
      avgScore: Math.round(v.sum / v.count),
    }));
    return { totalScore, rounds: attempts.length, perWord };
  }
}
