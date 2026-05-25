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

    // 2. Generate sentences via LLM
    const generated = await this.llmService.generateVietnameseSentences(
      normalized,
      dto.numSentences,
      dto.difficulty,
    );
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
    _userId: string,
    _sessionId: string,
    _dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptResponseDto> {
    throw new Error('not yet implemented');
  }

  async finish(
    _userId: string,
    _sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    throw new Error('not yet implemented');
  }

  async getSummary(
    _userId: string,
    _sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    throw new Error('not yet implemented');
  }
}
