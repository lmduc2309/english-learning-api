import { Injectable, Logger } from '@nestjs/common';
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
    _userId: string,
    _dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    throw new Error('not yet implemented');
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
