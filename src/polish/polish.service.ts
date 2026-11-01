import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Raw, Repository } from 'typeorm';
import { LlmService } from '../llm/llm.service';
import { SavePhraseDto } from './dto/save-phrase.dto';
import { SaveSessionDto } from './dto/save-session.dto';
import { UpdatePhraseDto } from './dto/update-phrase.dto';
import { PolishCorrectionEntity } from './entities/polish-correction.entity';
import { PolishPhrase } from './entities/polish-phrase.entity';
import { PolishSession } from './entities/polish-session.entity';
import { patternKind, SITUATIONS } from './polish.catalog';
import { buildNotebook, NotebookView } from './polish.notebook';
import {
  buildPolishMessages,
  missingProtectedTokens,
  parsePolishResponse,
  PolishParseError,
} from './polish.prompt';
import { CorrectionKind, PolishCorrection, PolishResult, PolishTone } from './polish.types';

const MAX_ATTEMPTS = 2;
const MAX_SOURCE_SENTENCE = 1000;

export interface PhraseView {
  id: string;
  text: string;
  sourceSentence: string;
  situationCode: string;
  createdAt: Date;
}

const toPhraseView = (p: PolishPhrase): PhraseView => ({
  id: p.id,
  text: p.text,
  sourceSentence: p.sourceSentence,
  situationCode: p.situationCode,
  createdAt: p.createdAt,
});

@Injectable()
export class PolishService {
  constructor(
    private readonly llm: LlmService,
    @InjectRepository(PolishSession) private sessionRepo: Repository<PolishSession>,
    @InjectRepository(PolishCorrectionEntity) private correctionRepo: Repository<PolishCorrectionEntity>,
    @InjectRepository(PolishPhrase) private phraseRepo: Repository<PolishPhrase>,
  ) {}

  async polish(text: string, tone: PolishTone): Promise<PolishResult> {
    let retryNote: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await this.llm.completeOwnerTool(
        buildPolishMessages(text, tone, retryNote),
        { temperature: 0.3, timeoutMs: 25000 },
      );
      try {
        const result = parsePolishResponse(raw, text, tone);
        const missing = missingProtectedTokens(text, result.finalText);
        if (missing.length === 0) return result;
        retryNote = `Your previous answer dropped or changed these items that must appear unchanged: ${missing.join(', ')}. Return the JSON again and keep them exactly.`;
      } catch (err) {
        if (!(err instanceof PolishParseError)) throw err;
        retryNote = `Your previous answer was invalid (${err.message}). Return only the JSON object in the required format.`;
      }
    }
    throw new BadGatewayException('Could not produce a reliable polish result');
  }

  async saveSession(userId: string, dto: SaveSessionDto): Promise<{ id: string }> {
    return this.sessionRepo.manager.transaction(async (em) => {
      const sessionRepo = em.getRepository(PolishSession);
      const correctionRepo = em.getRepository(PolishCorrectionEntity);
      const session = await sessionRepo.save(
        sessionRepo.create({
          userId,
          sourceApp: dto.sourceApp,
          tone: dto.tone,
          rawText: dto.rawText,
          editedText: dto.editedText,
        }),
      );
      if (dto.corrections.length > 0) {
        await correctionRepo.save(
          dto.corrections.map((c) => {
            const kind = patternKind(c.patternCode);
            return correctionRepo.create({
              sessionId: session.id,
              kind: kind ?? c.kind,
              patternCode: kind ? c.patternCode : 'other',
              wrongText: c.wrong,
              rightText: c.right,
              explanationVi: c.explanationVi,
              minor: c.minor,
            });
          }),
        );
      }
      return { id: session.id };
    });
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    const res = await this.sessionRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Session not found');
  }

  async listSessions(userId: string, limit = 50) {
    const sessions = await this.sessionRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (sessions.length === 0) return [];
    const rows = await this.correctionRepo.find({
      where: { sessionId: In(sessions.map((s) => s.id)) },
    });
    return sessions.map((s) => ({
      id: s.id,
      sourceApp: s.sourceApp,
      tone: s.tone,
      rawText: s.rawText,
      editedText: s.editedText,
      createdAt: s.createdAt,
      corrections: rows
        .filter((c) => c.sessionId === s.id)
        .map(
          (c): PolishCorrection => ({
            kind: c.kind as CorrectionKind,
            patternCode: c.patternCode,
            wrong: c.wrongText,
            right: c.rightText,
            explanationVi: c.explanationVi,
            minor: c.minor,
          }),
        ),
    }));
  }

  async notebook(userId: string): Promise<NotebookView> {
    const sessions = await this.sessionRepo.find({ where: { userId } });
    const rows = sessions.length
      ? await this.correctionRepo.find({ where: { sessionId: In(sessions.map((s) => s.id)) } })
      : [];
    return buildNotebook(
      sessions.map((s) => ({
        id: s.id,
        rawText: s.rawText,
        editedText: s.editedText,
        createdAt: s.createdAt,
        corrections: rows
          .filter((c) => c.sessionId === s.id)
          .map(
            (c): PolishCorrection => ({
              kind: c.kind as CorrectionKind,
              patternCode: c.patternCode,
              wrong: c.wrongText,
              right: c.rightText,
              explanationVi: c.explanationVi,
              minor: c.minor,
            }),
          ),
      })),
      new Date(),
    );
  }

  async savePhrase(userId: string, dto: SavePhraseDto): Promise<PhraseView> {
    const existing = await this.phraseRepo.findOne({
      where: {
        userId,
        text: Raw((col) => `lower(${col}) = lower(:text)`, { text: dto.text }),
      },
    });
    if (existing) return toPhraseView(existing);
    let sessionId: string | null = null;
    if (dto.sessionId) {
      const session = await this.sessionRepo.findOne({ where: { id: dto.sessionId, userId } });
      if (!session) throw new NotFoundException('Session not found');
      sessionId = session.id;
    }
    // Code points, matching class-validator's length count.
    const sourceSentence = Array.from(dto.sourceSentence).slice(0, MAX_SOURCE_SENTENCE).join('');
    const situationCode = await this.tagSituation(dto.text, sourceSentence);
    const saved = await this.phraseRepo.save(
      this.phraseRepo.create({
        userId,
        sessionId,
        text: dto.text,
        sourceSentence,
        situationCode,
      }),
    );
    return toPhraseView(saved);
  }

  async listPhrases(userId: string): Promise<PhraseView[]> {
    const rows = await this.phraseRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return rows.map(toPhraseView);
  }

  async updatePhrase(userId: string, id: string, dto: UpdatePhraseDto): Promise<PhraseView> {
    const phrase = await this.phraseRepo.findOne({ where: { id, userId } });
    if (!phrase) throw new NotFoundException('Phrase not found');
    phrase.situationCode = dto.situationCode;
    return toPhraseView(await this.phraseRepo.save(phrase));
  }

  async deletePhrase(userId: string, id: string): Promise<void> {
    const res = await this.phraseRepo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Phrase not found');
  }

  private async tagSituation(text: string, sentence: string): Promise<string> {
    try {
      const raw = await this.llm.completeOwnerTool(
        [
          {
            role: 'system',
            content: `Classify the situation in which a workplace English phrase is used. Answer with JSON {"situation": code} where code is exactly one of: ${SITUATIONS.map((s) => s.code).join(', ')}. Use "other" if none fits.`,
          },
          { role: 'user', content: `Phrase: ${text}\nSentence: ${sentence}` },
        ],
        { temperature: 0, timeoutMs: 15000 },
      );
      const code = JSON.parse(raw)?.situation;
      return SITUATIONS.some((s) => s.code === code) ? code : 'other';
    } catch {
      return 'other';
    }
  }
}
