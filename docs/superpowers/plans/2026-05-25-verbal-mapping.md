# Verbal Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Verbal Mapping game — a Vietnamese→spoken-English practice mode at `/modes/verbal-mapping` in `english-learning-games`, backed by three new endpoints in `english-learning-api` and two new prompts on `LlmService`.

**Architecture:** Two phases. **Phase A (backend):** add `generateVietnameseSentences` and `gradeSpokenAnswer` methods to `LlmService`; create a `verbal-mapping` NestJS module with two TypeORM entities (sessions + attempts), service, controller (JWT-protected), and unit tests. **Phase B (frontend):** add Jest + RTL infra; add a `/games` card; build the route at `app/modes/verbal-mapping/` with three browser hooks (`useSpeechRecognition`, `useSpeechSynthesis`, `useVerbalMappingSession`), six components, and an api service. Backend lands first so the frontend has something to talk to.

**Tech Stack:** NestJS 10 + TypeORM + Postgres + Jest (backend); Next.js 16 (App Router) + React 19 + Tailwind + AntD icons + Jest + React Testing Library (frontend); Web Speech API for STT/TTS; OpenRouter for grading.

**Spec:** [`docs/superpowers/specs/2026-05-25-verbal-mapping-design.md`](../specs/2026-05-25-verbal-mapping-design.md)

---

## Cross-cutting paths

- Backend root: `/Users/ducleminh/games-and-tools/english-learning-api`
- Frontend root: `/Users/ducleminh/games-and-tools/english-learning-games`

Every Bash command in this plan assumes the engineer is in the project root of whichever side they're touching. State it explicitly at the start of each task.

---

## File Structure

### Backend (`english-learning-api/`)

**Create:**
- `src/verbal-mapping/dto/start-session.dto.ts` — request DTO (class-validator)
- `src/verbal-mapping/dto/start-session.response.dto.ts` — response shape
- `src/verbal-mapping/dto/submit-attempt.dto.ts` — request DTO
- `src/verbal-mapping/dto/submit-attempt.response.dto.ts` — response shape
- `src/verbal-mapping/dto/finish-session.response.dto.ts` — response shape (used by `finish` + `getSummary`)
- `src/verbal-mapping/entities/verbal-mapping-session.entity.ts` — TypeORM entity
- `src/verbal-mapping/entities/verbal-mapping-attempt.entity.ts` — TypeORM entity
- `src/verbal-mapping/verbal-mapping.module.ts`
- `src/verbal-mapping/verbal-mapping.controller.ts`
- `src/verbal-mapping/verbal-mapping.service.ts`
- `src/verbal-mapping/verbal-mapping.service.spec.ts`

**Modify:**
- `src/llm/llm.service.ts` — add `generateVietnameseSentences` + `gradeSpokenAnswer` methods
- `src/llm/llm.service.spec.ts` — tests for the two new methods
- `src/app.module.ts` — register `VerbalMappingModule`

### Frontend (`english-learning-games/`)

**Set up test infrastructure (new):**
- `package.json` — add dev deps + scripts + jest config helpers
- `jest.config.ts` — Next.js + Jest setup
- `jest.setup.ts` — RTL globals

**Create services:**
- `services/verbalMappingApi.ts` — fetch wrapper for the three endpoints

**Create types:**
- `types/index.ts` — append `VerbalMappingConfig` interface; add `'verbal-mapping'` to `GameMode` union

**Create route + components:**
- `app/modes/verbal-mapping/page.tsx` — route entry (auth-guarded; state machine glue)
- `app/modes/verbal-mapping/components/SetupPanel.tsx`
- `app/modes/verbal-mapping/components/WordSourcePicker.tsx`
- `app/modes/verbal-mapping/components/PlayPanel.tsx`
- `app/modes/verbal-mapping/components/MicButton.tsx`
- `app/modes/verbal-mapping/components/ResultPanel.tsx`
- `app/modes/verbal-mapping/components/SummaryPanel.tsx`

**Create hooks:**
- `app/modes/verbal-mapping/hooks/useSpeechRecognition.ts`
- `app/modes/verbal-mapping/hooks/useSpeechSynthesis.ts`
- `app/modes/verbal-mapping/hooks/useVerbalMappingSession.ts`

**Create tests:**
- `app/modes/verbal-mapping/hooks/__tests__/useSpeechRecognition.test.ts`
- `app/modes/verbal-mapping/hooks/__tests__/useVerbalMappingSession.test.ts`

**Modify:**
- `app/games/page.tsx` — add Verbal Mapping card

---

# Phase A — Backend

## Task A1: Add `generateVietnameseSentences` to `LlmService` (TDD)

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Append failing tests to `src/llm/llm.service.spec.ts`**

```ts
describe('LlmService.generateVietnameseSentences', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('returns parsed sentences from the LLM JSON response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              sentences: [
                { vi: 'Tôi đang đi bộ trong công viên.', words: ['walk'] },
                { vi: 'Anh ấy rất thông minh.', words: ['intelligent'] },
              ],
            }),
          },
        },
      ],
    });
    const result = await svc.generateVietnameseSentences(
      ['walk', 'intelligent'],
      2,
      'intermediate',
    );
    expect(result).toEqual([
      { vi: 'Tôi đang đi bộ trong công viên.', words: ['walk'] },
      { vi: 'Anh ấy rất thông minh.', words: ['intelligent'] },
    ]);
    const [args] = mockCreate.mock.calls[0];
    expect(args.response_format).toEqual({ type: 'json_object' });
    expect(args.temperature).toBe(0.7);
    expect(args.max_tokens).toBe(160); // 80 * 2
    expect(args.messages[0].content).toMatch(/Vietnamese teacher/i);
    expect(args.messages[1].content).toContain('walk');
    expect(args.messages[1].content).toContain('intelligent');
    expect(args.messages[1].content).toContain('intermediate');
  });

  it('throws 500 when the LLM response cannot be parsed as JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });
    await expect(
      svc.generateVietnameseSentences(['x'], 1, 'intermediate'),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to generate Vietnamese sentences',
    });
  });

  it('throws 500 when JSON parses but has no sentences array', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ foo: 'bar' }) } }],
    });
    await expect(
      svc.generateVietnameseSentences(['x'], 1, 'intermediate'),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to generate Vietnamese sentences',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm test -- llm.service.spec
```

Expected: 3 new tests fail with `TypeError: svc.generateVietnameseSentences is not a function`.

- [ ] **Step 3: Add the method to `src/llm/llm.service.ts`**

After the `translate()` method body, add:

```ts
async generateVietnameseSentences(
  words: string[],
  numSentences: number,
  difficulty: 'beginner' | 'intermediate' | 'advanced',
): Promise<Array<{ vi: string; words: string[] }>> {
  const wordsStr = words.join(', ');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a Vietnamese teacher creating natural Vietnamese sentences for English learners.',
    },
    {
      role: 'user',
      content: `Generate ${numSentences} Vietnamese sentences. Each must use the English meaning of at least one of these English words: ${wordsStr}.
Match difficulty: ${difficulty}.
Return ONLY valid JSON in this exact format:
{
  "sentences": [
    { "vi": "<Vietnamese sentence>", "words": ["<english word it uses>"] }
  ]
}`,
    },
  ];
  const text = await this.chat(messages, {
    temperature: 0.7,
    maxTokens: 80 * numSentences,
    responseFormat: { type: 'json_object' },
  });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new HttpException(
      'Failed to generate Vietnamese sentences',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  let parsed: { sentences?: Array<{ vi: string; words: string[] }> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new HttpException(
      'Failed to generate Vietnamese sentences',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  if (!parsed.sentences || !Array.isArray(parsed.sentences) || parsed.sentences.length === 0) {
    throw new HttpException(
      'Failed to generate Vietnamese sentences',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return parsed.sentences;
}
```

- [ ] **Step 4: Run tests; expect all pass**

```bash
npm test -- llm.service.spec
```

Expected: previous 21 + 3 new = 24 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: add generateVietnameseSentences for verbal mapping game"
```

---

## Task A2: Add `gradeSpokenAnswer` to `LlmService` (TDD)

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('LlmService.gradeSpokenAnswer', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('returns verdict + score + feedback + suggestedAnswer from the LLM JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: 'correct',
              score: 92,
              feedback: 'Great pronunciation and word choice.',
              suggestedAnswer: 'I am walking in the park.',
            }),
          },
        },
      ],
    });
    const result = await svc.gradeSpokenAnswer({
      vietnamese: 'Tôi đang đi bộ trong công viên.',
      userTranscript: 'I am walking in the park',
      words: ['walk'],
    });
    expect(result).toEqual({
      verdict: 'correct',
      score: 92,
      feedback: 'Great pronunciation and word choice.',
      suggestedAnswer: 'I am walking in the park.',
    });
    const [args] = mockCreate.mock.calls[0];
    expect(args.response_format).toEqual({ type: 'json_object' });
    expect(args.temperature).toBe(0.2);
    expect(args.max_tokens).toBe(300);
    expect(args.messages[0].content).toMatch(/English teacher/i);
    expect(args.messages[1].content).toContain('Tôi đang đi bộ trong công viên.');
    expect(args.messages[1].content).toContain('I am walking in the park');
    expect(args.messages[1].content).toContain('walk');
  });

  it('throws 500 when the LLM response cannot be parsed', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });
    await expect(
      svc.gradeSpokenAnswer({ vietnamese: 'x', userTranscript: 'y', words: ['z'] }),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to grade answer',
    });
  });

  it('throws 500 when JSON parses but verdict is missing', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ score: 100 }) } }],
    });
    await expect(
      svc.gradeSpokenAnswer({ vietnamese: 'x', userTranscript: 'y', words: ['z'] }),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to grade answer',
    });
  });
});
```

- [ ] **Step 2: Run tests; expect failures**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm test -- llm.service.spec
```

- [ ] **Step 3: Add the method to `src/llm/llm.service.ts`**

After the `generateVietnameseSentences` method, add:

```ts
async gradeSpokenAnswer(input: {
  vietnamese: string;
  userTranscript: string;
  words: string[];
}): Promise<{
  verdict: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
  suggestedAnswer: string;
}> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an English teacher grading a learner\'s spoken English translation of a Vietnamese sentence. Be encouraging but honest.',
    },
    {
      role: 'user',
      content: `Vietnamese sentence: "${input.vietnamese}"
Target English words to demonstrate: ${input.words.join(', ')}
Learner's spoken English: "${input.userTranscript}"

Grade the learner. Return ONLY valid JSON in this exact format:
{
  "verdict": "correct" | "partial" | "incorrect",
  "score": <integer 0-100>,
  "feedback": "<one short sentence of feedback>",
  "suggestedAnswer": "<one good English sentence that translates the Vietnamese>"
}`,
    },
  ];
  const text = await this.chat(messages, {
    temperature: 0.2,
    maxTokens: 300,
    responseFormat: { type: 'json_object' },
  });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new HttpException(
      'Failed to grade answer',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  let parsed: {
    verdict?: 'correct' | 'partial' | 'incorrect';
    score?: number;
    feedback?: string;
    suggestedAnswer?: string;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new HttpException(
      'Failed to grade answer',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  if (
    !parsed.verdict ||
    !['correct', 'partial', 'incorrect'].includes(parsed.verdict) ||
    typeof parsed.score !== 'number' ||
    typeof parsed.feedback !== 'string' ||
    typeof parsed.suggestedAnswer !== 'string'
  ) {
    throw new HttpException(
      'Failed to grade answer',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return {
    verdict: parsed.verdict,
    score: Math.max(0, Math.min(100, Math.round(parsed.score))),
    feedback: parsed.feedback,
    suggestedAnswer: parsed.suggestedAnswer,
  };
}
```

- [ ] **Step 4: Run tests; expect all pass**

```bash
npm test -- llm.service.spec
```

Expected: 27 tests passing (24 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: add gradeSpokenAnswer for verbal mapping game"
```

---

## Task A3: Create entities + DTOs

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files (all create):**
- `src/verbal-mapping/entities/verbal-mapping-session.entity.ts`
- `src/verbal-mapping/entities/verbal-mapping-attempt.entity.ts`
- `src/verbal-mapping/dto/start-session.dto.ts`
- `src/verbal-mapping/dto/start-session.response.dto.ts`
- `src/verbal-mapping/dto/submit-attempt.dto.ts`
- `src/verbal-mapping/dto/submit-attempt.response.dto.ts`
- `src/verbal-mapping/dto/finish-session.response.dto.ts`

- [ ] **Step 1: Create the session entity**

`src/verbal-mapping/entities/verbal-mapping-session.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export interface SessionSentence {
  index: number;
  vi: string;
  words: string[];
}

@Entity('verbal_mapping_sessions')
export class VerbalMappingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'word_list_id', type: 'uuid', nullable: true })
  wordListId: string | null;

  @Column({ name: 'source_words', type: 'jsonb' })
  sourceWords: string[];

  @Column({ name: 'num_sentences', type: 'int' })
  numSentences: number;

  @Column({ type: 'varchar', length: 16 })
  difficulty: Difficulty;

  @Column({ type: 'jsonb' })
  sentences: SessionSentence[];

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  totalScore: string | null; // numeric returns as string in TypeORM

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

If `User` is at a different path, adjust the import. Confirm with `find src/auth/entities -name "user.entity.ts"`.

- [ ] **Step 2: Create the attempt entity**

`src/verbal-mapping/entities/verbal-mapping-attempt.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { VerbalMappingSession } from './verbal-mapping-session.entity';

export type Verdict = 'correct' | 'partial' | 'incorrect';

@Entity('verbal_mapping_attempts')
@Unique('uniq_session_sentence', ['sessionId', 'sentenceIndex'])
export class VerbalMappingAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => VerbalMappingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: VerbalMappingSession;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'sentence_index', type: 'int' })
  sentenceIndex: number;

  @Column({ name: 'vi_sentence', type: 'text' })
  viSentence: string;

  @Column({ name: 'target_words', type: 'jsonb' })
  targetWords: string[];

  @Column({ type: 'text' })
  transcript: string;

  @Column({ type: 'varchar', length: 16 })
  verdict: Verdict;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'text' })
  feedback: string;

  @Column({ name: 'suggested_answer', type: 'text' })
  suggestedAnswer: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 3: Create the request DTOs**

`src/verbal-mapping/dto/start-session.dto.ts`:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class StartSessionDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  words: string[];

  @IsOptional()
  @IsUUID()
  wordListId?: string;

  @IsInt()
  @IsIn([5, 10, 15, 20])
  numSentences: number;

  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
```

`src/verbal-mapping/dto/submit-attempt.dto.ts`:

```ts
import { IsInt, IsString, Min } from 'class-validator';

export class SubmitAttemptDto {
  @IsInt()
  @Min(0)
  sentenceIndex: number;

  @IsString()
  transcript: string;
}
```

- [ ] **Step 4: Create the response DTOs**

`src/verbal-mapping/dto/start-session.response.dto.ts`:

```ts
export class StartSessionResponseDto {
  sessionId: string;
  sentences: Array<{ index: number; vi: string; words: string[] }>;
}
```

`src/verbal-mapping/dto/submit-attempt.response.dto.ts`:

```ts
export class SubmitAttemptResponseDto {
  verdict: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
  suggestedAnswer: string;
}
```

`src/verbal-mapping/dto/finish-session.response.dto.ts`:

```ts
export class FinishSessionResponseDto {
  totalScore: number;
  rounds: number;
  perWord: Array<{ word: string; attempts: number; avgScore: number }>;
}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm run build
```

Expected: build succeeds (entities aren't used yet but they compile).

- [ ] **Step 6: Commit**

```bash
git add src/verbal-mapping/entities src/verbal-mapping/dto
git commit -m "verbal-mapping: add session/attempt entities and DTOs"
```

---

## Task A4: Module skeleton + controller + service skeleton

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Create: `src/verbal-mapping/verbal-mapping.module.ts`
- Create: `src/verbal-mapping/verbal-mapping.controller.ts`
- Create: `src/verbal-mapping/verbal-mapping.service.ts`
- Modify: `src/app.module.ts`

This task wires up the module so the routes are reachable (each handler is still a stub that throws `not yet implemented`). The next three tasks fill in the service methods test-first.

- [ ] **Step 1: Create the module file**

`src/verbal-mapping/verbal-mapping.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../llm/llm.module';
import { WordListModule } from '../word-list/word-list.module';
import { VerbalMappingController } from './verbal-mapping.controller';
import { VerbalMappingService } from './verbal-mapping.service';
import { VerbalMappingSession } from './entities/verbal-mapping-session.entity';
import { VerbalMappingAttempt } from './entities/verbal-mapping-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerbalMappingSession, VerbalMappingAttempt]),
    LlmModule,
    WordListModule,
  ],
  controllers: [VerbalMappingController],
  providers: [VerbalMappingService],
})
export class VerbalMappingModule {}
```

- [ ] **Step 2: Create the controller**

`src/verbal-mapping/verbal-mapping.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StartSessionDto } from './dto/start-session.dto';
import { StartSessionResponseDto } from './dto/start-session.response.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { SubmitAttemptResponseDto } from './dto/submit-attempt.response.dto';
import { FinishSessionResponseDto } from './dto/finish-session.response.dto';
import { VerbalMappingService } from './verbal-mapping.service';

@Controller('verbal-mapping')
@UseGuards(JwtAuthGuard)
export class VerbalMappingController {
  constructor(private readonly svc: VerbalMappingService) {}

  @Post('sessions')
  startSession(
    @Request() req,
    @Body() dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    return this.svc.startSession(req.user.userId, dto);
  }

  @Post('sessions/:id/attempts')
  submitAttempt(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitAttemptDto,
  ): Promise<SubmitAttemptResponseDto> {
    return this.svc.submitAttempt(req.user.userId, sessionId, dto);
  }

  @Post('sessions/:id/finish')
  finish(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    return this.svc.finish(req.user.userId, sessionId);
  }

  @Get('sessions/:id/summary')
  summary(
    @Request() req,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<FinishSessionResponseDto> {
    return this.svc.getSummary(req.user.userId, sessionId);
  }
}
```

- [ ] **Step 3: Create the service skeleton**

`src/verbal-mapping/verbal-mapping.service.ts`:

```ts
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
```

- [ ] **Step 4: Wire the module into `AppModule`**

In `src/app.module.ts`, add `import { VerbalMappingModule } from './verbal-mapping/verbal-mapping.module';` to the imports block, and append `VerbalMappingModule,` to the `imports: [...]` array (last entry after `CategoryModule,`).

- [ ] **Step 5: Verify the API boots**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm run build
```

Build must succeed. Optional: start the app briefly to confirm the new tables get created by TypeORM `synchronize` — but only do this if Postgres is running locally; otherwise skip.

- [ ] **Step 6: Verify `WordListService` is exported**

```bash
grep -n "exports" src/word-list/word-list.module.ts
```

If `WordListService` is NOT in the module's `exports` array, edit `src/word-list/word-list.module.ts` to add it:

```ts
@Module({
  // ... unchanged imports/controllers/providers
  exports: [WordListService],
})
```

This is required so `VerbalMappingModule` can inject it.

- [ ] **Step 7: Run the existing test suite — should still pass**

```bash
npm test
```

Expected: 27 tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/verbal-mapping/verbal-mapping.module.ts src/verbal-mapping/verbal-mapping.controller.ts src/verbal-mapping/verbal-mapping.service.ts src/app.module.ts src/word-list/word-list.module.ts
git commit -m "verbal-mapping: scaffold module, controller, service skeleton"
```

(Stage `src/word-list/word-list.module.ts` only if you actually edited it.)

---

## Task A5: TDD `startSession`

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Create: `src/verbal-mapping/verbal-mapping.service.spec.ts`
- Modify: `src/verbal-mapping/verbal-mapping.service.ts`

- [ ] **Step 1: Create the spec file with shared test setup + `startSession` tests**

`src/verbal-mapping/verbal-mapping.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests; verify failures**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm test -- verbal-mapping.service.spec
```

Expected: 4 tests fail (most with `Error: not yet implemented`).

- [ ] **Step 3: Implement `startSession`**

Replace the `startSession` stub in `src/verbal-mapping/verbal-mapping.service.ts` with:

```ts
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
    const { HttpException, HttpStatus } = await import('@nestjs/common');
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
```

Also add the imports at top:

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
```

And remove the inline dynamic `await import(...)` — replace with the top-level import. The final method body should use the top-level imports.

- [ ] **Step 4: Run tests; expect all pass**

```bash
npm test -- verbal-mapping.service.spec
```

Expected: 4 tests passing.

- [ ] **Step 5: Run full test suite — must remain green**

```bash
npm test
```

Expected: 31 tests passing (27 prior + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/verbal-mapping/verbal-mapping.service.ts src/verbal-mapping/verbal-mapping.service.spec.ts
git commit -m "verbal-mapping: implement startSession"
```

---

## Task A6: TDD `submitAttempt`

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Modify: `src/verbal-mapping/verbal-mapping.service.spec.ts`
- Modify: `src/verbal-mapping/verbal-mapping.service.ts`

- [ ] **Step 1: Append failing tests**

Append to `verbal-mapping.service.spec.ts`:

```ts
describe('VerbalMappingService.submitAttempt', () => {
  const sampleSession = {
    id: 'sess-1',
    userId: 'user-1',
    finishedAt: null,
    sentences: [
      { index: 0, vi: 'Tôi đi bộ.', words: ['walk'] },
      { index: 1, vi: 'Anh ấy thông minh.', words: ['intelligent'] },
    ],
  };

  it('grades a transcript and upserts an attempt row', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    const llmService = {
      gradeSpokenAnswer: jest.fn().mockResolvedValue({
        verdict: 'correct',
        score: 90,
        feedback: 'Great job!',
        suggestedAnswer: 'I walk.',
      }),
    };
    const { svc } = await buildService({ sessionRepo, attemptRepo, llmService });
    const result = await svc.submitAttempt('user-1', 'sess-1', {
      sentenceIndex: 0,
      transcript: 'I walked',
    });
    expect(llmService.gradeSpokenAnswer).toHaveBeenCalledWith({
      vietnamese: 'Tôi đi bộ.',
      userTranscript: 'I walked',
      words: ['walk'],
    });
    expect(attemptRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        userId: 'user-1',
        sentenceIndex: 0,
        viSentence: 'Tôi đi bộ.',
        targetWords: ['walk'],
        transcript: 'I walked',
        verdict: 'correct',
        score: 90,
        feedback: 'Great job!',
        suggestedAnswer: 'I walk.',
      }),
      ['sessionId', 'sentenceIndex'],
    );
    expect(result).toEqual({
      verdict: 'correct',
      score: 90,
      feedback: 'Great job!',
      suggestedAnswer: 'I walk.',
    });
  });

  it('returns 404 when the session does not exist or belongs to another user', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(null);
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 0,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('returns 409 when the session is already finished', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      ...sampleSession,
      finishedAt: new Date(),
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 0,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('returns 404 when sentenceIndex is out of range', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.submitAttempt('user-1', 'sess-1', {
        sentenceIndex: 99,
        transcript: 'x',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('persists a safe fallback grade when LlmService.gradeSpokenAnswer throws', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    const llmService = {
      gradeSpokenAnswer: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { svc } = await buildService({ sessionRepo, attemptRepo, llmService });
    const result = await svc.submitAttempt('user-1', 'sess-1', {
      sentenceIndex: 0,
      transcript: 'I walked',
    });
    expect(result.verdict).toBe('partial');
    expect(result.score).toBe(50);
    expect(result.feedback).toMatch(/could not grade/i);
    expect(result.suggestedAnswer).toBe('Tôi đi bộ.');
    expect(attemptRepo.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests; verify failures**

```bash
npm test -- verbal-mapping.service.spec
```

- [ ] **Step 3: Implement `submitAttempt`**

Replace the `submitAttempt` stub with:

```ts
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
```

- [ ] **Step 4: Run tests; verify all pass**

```bash
npm test -- verbal-mapping.service.spec
npm test
```

Expected: 9 verbal-mapping tests passing; 36 total tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/verbal-mapping/verbal-mapping.service.ts src/verbal-mapping/verbal-mapping.service.spec.ts
git commit -m "verbal-mapping: implement submitAttempt with grading + fallback"
```

---

## Task A7: TDD `finish` + `getSummary`

**Backend root:** `/Users/ducleminh/games-and-tools/english-learning-api`

**Files:**
- Modify: `src/verbal-mapping/verbal-mapping.service.spec.ts`
- Modify: `src/verbal-mapping/verbal-mapping.service.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('VerbalMappingService.finish', () => {
  const sampleSession = {
    id: 'sess-1',
    userId: 'user-1',
    finishedAt: null,
    sentences: [
      { index: 0, vi: 'A', words: ['x'] },
      { index: 1, vi: 'B', words: ['y'] },
    ],
  };

  it('computes total score, sets finishedAt, and returns summary', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([
      { score: 80, verdict: 'correct', targetWords: ['x'] },
      { score: 60, verdict: 'partial', targetWords: ['y'] },
    ]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.finish('user-1', 'sess-1');
    expect(result.totalScore).toBe(70);
    expect(result.rounds).toBe(2);
    expect(result.perWord).toEqual(
      expect.arrayContaining([
        { word: 'x', attempts: 1, avgScore: 80 },
        { word: 'y', attempts: 1, avgScore: 60 },
      ]),
    );
    expect(sessionRepo.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      expect.objectContaining({ finishedAt: expect.any(Date), totalScore: '70.00' }),
    );
  });

  it('returns 404 when session is missing or owned by someone else', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(null);
    const { svc } = await buildService({ sessionRepo });
    await expect(svc.finish('user-1', 'sess-1')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('returns 409 when session is already finished', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      ...sampleSession,
      finishedAt: new Date(),
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(svc.finish('user-1', 'sess-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('totalScore is 0 when there are no attempts', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue(sampleSession);
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.finish('user-1', 'sess-1');
    expect(result.totalScore).toBe(0);
    expect(result.rounds).toBe(0);
    expect(result.perWord).toEqual([]);
  });
});

describe('VerbalMappingService.getSummary', () => {
  it('returns the summary of a previously-finished session', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      finishedAt: new Date(),
      sentences: [],
    });
    const attemptRepo = makeAttemptRepo();
    attemptRepo.find.mockResolvedValue([
      { score: 100, verdict: 'correct', targetWords: ['a'] },
    ]);
    const { svc } = await buildService({ sessionRepo, attemptRepo });
    const result = await svc.getSummary('user-1', 'sess-1');
    expect(result.totalScore).toBe(100);
    expect(result.rounds).toBe(1);
  });

  it('returns 404 when the session is owned by another user', async () => {
    const sessionRepo = makeSessionRepo();
    sessionRepo.findOne.mockResolvedValue({
      id: 'sess-1',
      userId: 'other-user',
      finishedAt: new Date(),
      sentences: [],
    });
    const { svc } = await buildService({ sessionRepo });
    await expect(
      svc.getSummary('user-1', 'sess-1'),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });
});
```

- [ ] **Step 2: Run tests; verify failures**

```bash
npm test -- verbal-mapping.service.spec
```

- [ ] **Step 3: Implement `finish` + `getSummary` + shared helper**

Replace the `finish` and `getSummary` stubs with:

```ts
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
    attempts.reduce((acc, a: any) => acc + (a.score ?? 0), 0) / attempts.length,
  );
  const perWordMap = new Map<string, { sum: number; count: number }>();
  for (const a of attempts as any[]) {
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
```

- [ ] **Step 4: Run tests; verify all pass**

```bash
npm test -- verbal-mapping.service.spec
npm test
```

Expected: 15 verbal-mapping tests; 42 total.

- [ ] **Step 5: Commit**

```bash
git add src/verbal-mapping/verbal-mapping.service.ts src/verbal-mapping/verbal-mapping.service.spec.ts
git commit -m "verbal-mapping: implement finish + getSummary with per-word aggregation"
```

---

# Phase B — Frontend

## Task B1: Set up Jest + React Testing Library for Next.js

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Modify: `package.json`
- Create: `jest.config.ts`
- Create: `jest.setup.ts`

- [ ] **Step 1: Install dev dependencies**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-games
npm install -D jest @types/jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event ts-node
```

- [ ] **Step 2: Add the `test` script to `package.json`**

In `package.json`, modify the `scripts` block to add `"test": "jest"` between `"lint"` and the closing brace. Final scripts block:

```json
"scripts": {
  "dev": "next dev -p 3209",
  "build": "next build",
  "start": "next start -p 3209",
  "lint": "eslint",
  "test": "jest"
},
```

- [ ] **Step 3: Create `jest.config.ts`**

`jest.config.ts`:

```ts
import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  setupFilesAfterEach: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts(x)?'],
};

export default createJestConfig(config);
```

- [ ] **Step 4: Create `jest.setup.ts`**

`jest.setup.ts`:

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Create a sanity test**

`__tests__/sanity.test.ts`:

```ts
describe('jest infra', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the sanity test**

```bash
npm test
```

Expected: `Tests: 1 passed, 1 total`.

- [ ] **Step 7: Delete the sanity test**

```bash
rm -rf __tests__
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json jest.config.ts jest.setup.ts
git commit -m "chore(games): set up Jest + React Testing Library"
```

(If `yarn.lock` also changed, stage that too.)

---

## Task B2: Add Verbal Mapping card to `/games` page + extend GameMode type

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Modify: `types/index.ts`
- Modify: `app/games/page.tsx`

- [ ] **Step 1: Extend the `GameMode` union and add a config interface**

In `types/index.ts`, replace the existing `GameMode` line with:

```ts
export type GameMode = 'typing-waterfall' | 'tone-master' | 'custom-audio' | 'sentence-learning' | 'dictionary' | 'verbal-mapping';
```

Then append at the end of the file:

```ts
// Verbal Mapping types
export type VerbalMappingDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface VerbalMappingSentence {
  index: number;
  vi: string;
  words: string[];
}

export interface VerbalMappingGrade {
  verdict: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
  suggestedAnswer: string;
}

export interface VerbalMappingAttemptLog {
  sentenceIndex: number;
  transcript: string;
  grade: VerbalMappingGrade;
}

export interface VerbalMappingSetupConfig {
  source: 'list' | 'typed';
  wordListId?: string;
  typedWords: string[];
  numSentences: 5 | 10 | 15 | 20;
  difficulty: VerbalMappingDifficulty;
}

export interface VerbalMappingSessionSummary {
  totalScore: number;
  rounds: number;
  perWord: Array<{ word: string; attempts: number; avgScore: number }>;
}
```

- [ ] **Step 2: Add the card to `app/games/page.tsx`**

Read the file. Find the closing `</div>` of the last existing game card (after Typing Waterfall and any others). Insert a new card before the parent grid's closing `</div>`:

```tsx
{/* Verbal Mapping */}
<div
  onClick={() => handleSelectMode('verbal-mapping')}
  className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 border-transparent hover:border-pink-400"
>
  <div className="text-center mb-6">
    <div className="text-6xl mb-4"><AudioOutlined /></div>
    <h2 className="text-3xl font-bold text-gray-900 mb-3">Verbal Mapping</h2>
    <p className="text-gray-600 mb-4">Speak Vietnamese-to-English, get instant AI grading.</p>
  </div>
  <p className="text-gray-700 mb-6 text-center">
    See a Vietnamese sentence built around words you're learning, then speak the English translation. AI grades your speech and gives you feedback.
  </p>
  <div className="space-y-2">
    <div className="flex items-center text-sm text-gray-700">
      <span className="mr-2">✓</span>
      <span>Practice speaking, not just typing</span>
    </div>
    <div className="flex items-center text-sm text-gray-700">
      <span className="mr-2">✓</span>
      <span>AI feedback after every sentence</span>
    </div>
    <div className="flex items-center text-sm text-gray-700">
      <span className="mr-2">✓</span>
      <span>Tracks per-word progress</span>
    </div>
  </div>
</div>
```

`AudioOutlined` is already imported at the top of the file.

Also update the `handleSelectMode` route — it currently does `router.push(\`/modes/${mode}\`)`. That works correctly for `'verbal-mapping'` → `/modes/verbal-mapping`. No change to the handler needed.

- [ ] **Step 3: Verify build**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-games
npm run build
```

Build must succeed (the new route doesn't exist yet, but the card just navigates to a route — Next.js doesn't fail the build over that).

- [ ] **Step 4: Commit**

```bash
git add types/index.ts app/games/page.tsx
git commit -m "games: add Verbal Mapping card + types"
```

---

## Task B3: Create `verbalMappingApi` service

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `services/verbalMappingApi.ts`

- [ ] **Step 1: Create the file**

`services/verbalMappingApi.ts`:

```ts
import type {
  VerbalMappingDifficulty,
  VerbalMappingSentence,
  VerbalMappingGrade,
  VerbalMappingSessionSummary,
} from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7474';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readError(response: Response, fallback: string): Promise<never> {
  const err = await response.json().catch(() => ({ message: fallback }));
  throw new Error(err.message || fallback);
}

export interface StartSessionRequest {
  words: string[];
  wordListId?: string;
  numSentences: 5 | 10 | 15 | 20;
  difficulty: VerbalMappingDifficulty;
}

export interface StartSessionResponse {
  sessionId: string;
  sentences: VerbalMappingSentence[];
}

class VerbalMappingApiService {
  async startSession(req: StartSessionRequest): Promise<StartSessionResponse> {
    const response = await fetch(`${API_BASE_URL}/verbal-mapping/sessions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(req),
    });
    if (!response.ok) return readError(response, 'Failed to start session');
    return response.json();
  }

  async submitAttempt(
    sessionId: string,
    sentenceIndex: number,
    transcript: string,
  ): Promise<VerbalMappingGrade> {
    const response = await fetch(
      `${API_BASE_URL}/verbal-mapping/sessions/${sessionId}/attempts`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sentenceIndex, transcript }),
      },
    );
    if (!response.ok) return readError(response, 'Failed to submit attempt');
    return response.json();
  }

  async finish(sessionId: string): Promise<VerbalMappingSessionSummary> {
    const response = await fetch(
      `${API_BASE_URL}/verbal-mapping/sessions/${sessionId}/finish`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
    );
    if (!response.ok) return readError(response, 'Failed to finish session');
    return response.json();
  }

  async getSummary(sessionId: string): Promise<VerbalMappingSessionSummary> {
    const response = await fetch(
      `${API_BASE_URL}/verbal-mapping/sessions/${sessionId}/summary`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      },
    );
    if (!response.ok) return readError(response, 'Failed to load summary');
    return response.json();
  }
}

export const verbalMappingApi = new VerbalMappingApiService();
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-games
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add services/verbalMappingApi.ts
git commit -m "games: add verbalMappingApi service"
```

---

## Task B4: TDD `useSpeechRecognition` hook

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/hooks/__tests__/useSpeechRecognition.test.ts`
- Create: `app/modes/verbal-mapping/hooks/useSpeechRecognition.ts`

- [ ] **Step 1: Create the failing test**

`app/modes/verbal-mapping/hooks/__tests__/useSpeechRecognition.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition } from '../useSpeechRecognition';

describe('useSpeechRecognition', () => {
  const originalWindow = { ...window } as any;

  afterEach(() => {
    // restore globals
    (window as any).SpeechRecognition = originalWindow.SpeechRecognition;
    (window as any).webkitSpeechRecognition = originalWindow.webkitSpeechRecognition;
  });

  it('reports supported=false when neither SpeechRecognition global exists', () => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.supported).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.transcript).toBe('');
  });

  it('reports supported=true and starts/stops recording when available', () => {
    const start = jest.fn();
    const stop = jest.fn();
    let handlers: Record<string, ((e: any) => void) | undefined> = {};
    class FakeSR {
      lang = '';
      interimResults = false;
      continuous = false;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: any) => void;
      onresult?: (e: any) => void;
      start = start;
      stop = stop;
      constructor() {
        handlers = this as any;
      }
    }
    (window as any).SpeechRecognition = FakeSR;

    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.supported).toBe(true);

    act(() => result.current.start());
    expect(start).toHaveBeenCalled();
    act(() => (handlers.onstart as any)?.());
    expect(result.current.status).toBe('recording');

    act(() =>
      (handlers.onresult as any)?.({
        results: [[{ transcript: 'I am walking' }]],
        resultIndex: 0,
      }),
    );
    expect(result.current.transcript).toBe('I am walking');

    act(() => result.current.stop());
    expect(stop).toHaveBeenCalled();
    act(() => (handlers.onend as any)?.());
    expect(result.current.status).toBe('done');
  });

  it('falls back to webkitSpeechRecognition when SpeechRecognition is missing', () => {
    delete (window as any).SpeechRecognition;
    class FakeSR {
      start = jest.fn();
      stop = jest.fn();
    }
    (window as any).webkitSpeechRecognition = FakeSR;
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.supported).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test; expect failure**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-games
npm test -- useSpeechRecognition
```

Expected: file not found.

- [ ] **Step 3: Implement the hook**

`app/modes/verbal-mapping/hooks/useSpeechRecognition.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'recording' | 'done' | 'error';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (e: { error: string }) => void;
  onresult?: (e: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
    resultIndex: number;
  }) => void;
}

function getCtor(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition ??
    null
  );
}

export function useSpeechRecognition(lang = 'en-US') {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const Ctor = getCtor();
    setSupported(Ctor !== null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError('not-supported');
      setStatus('error');
      return;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onstart = () => setStatus('recording');
    rec.onend = () => setStatus((s) => (s === 'error' ? s : 'done'));
    rec.onerror = (e) => {
      setError(e.error);
      setStatus('error');
    };
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? '';
      }
      setTranscript(text);
    };
    recRef.current = rec;
    setTranscript('');
    setError(undefined);
    rec.start();
  }, [lang]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setStatus('idle');
    setError(undefined);
  }, []);

  return { supported, status, transcript, error, start, stop, reset };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
npm test -- useSpeechRecognition
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/modes/verbal-mapping/hooks/useSpeechRecognition.ts app/modes/verbal-mapping/hooks/__tests__/useSpeechRecognition.test.ts
git commit -m "verbal-mapping: add useSpeechRecognition hook"
```

---

## Task B5: Add `useSpeechSynthesis` hook

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/hooks/useSpeechSynthesis.ts`

(No test; thin wrapper. Manual verification covers it.)

- [ ] **Step 1: Create the file**

`app/modes/verbal-mapping/hooks/useSpeechSynthesis.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const speak = useCallback(
    (text: string, lang = 'vi-VN') => {
      if (!supported) return;
      window.speechSynthesis.cancel(); // stop anything in flight
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      const langPrefix = lang.split('-')[0];
      const match =
        voices.find((v) => v.lang === lang) ??
        voices.find((v) => v.lang.startsWith(langPrefix));
      if (match) utter.voice = match;
      window.speechSynthesis.speak(utter);
    },
    [supported, voices],
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
  }, [supported]);

  return { supported, speak, cancel };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/modes/verbal-mapping/hooks/useSpeechSynthesis.ts
git commit -m "verbal-mapping: add useSpeechSynthesis hook"
```

---

## Task B6: TDD `useVerbalMappingSession` state machine

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/hooks/__tests__/useVerbalMappingSession.test.ts`
- Create: `app/modes/verbal-mapping/hooks/useVerbalMappingSession.ts`

- [ ] **Step 1: Create the failing test**

`app/modes/verbal-mapping/hooks/__tests__/useVerbalMappingSession.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVerbalMappingSession } from '../useVerbalMappingSession';
import { verbalMappingApi } from '@/services/verbalMappingApi';

jest.mock('@/services/verbalMappingApi', () => ({
  verbalMappingApi: {
    startSession: jest.fn(),
    submitAttempt: jest.fn(),
    finish: jest.fn(),
  },
}));

const mockApi = verbalMappingApi as unknown as {
  startSession: jest.Mock;
  submitAttempt: jest.Mock;
  finish: jest.Mock;
};

describe('useVerbalMappingSession', () => {
  beforeEach(() => {
    mockApi.startSession.mockReset();
    mockApi.submitAttempt.mockReset();
    mockApi.finish.mockReset();
  });

  it('transitions idle → generating → playing(0)', async () => {
    mockApi.startSession.mockResolvedValue({
      sessionId: 'sess-1',
      sentences: [
        { index: 0, vi: 'A', words: ['x'] },
        { index: 1, vi: 'B', words: ['y'] },
      ],
    });
    const { result } = renderHook(() => useVerbalMappingSession());
    expect(result.current.phase).toBe('idle');

    act(() => {
      result.current.startSession({
        source: 'typed',
        typedWords: ['x', 'y'],
        numSentences: 2,
        difficulty: 'intermediate',
      });
    });
    expect(result.current.phase).toBe('generating');

    await waitFor(() => expect(result.current.phase).toBe('playing'));
    expect(result.current.roundIndex).toBe(0);
    expect(result.current.currentSentence?.vi).toBe('A');
  });

  it('advances to the next round after submitAttempt grades successfully', async () => {
    mockApi.startSession.mockResolvedValue({
      sessionId: 'sess-1',
      sentences: [
        { index: 0, vi: 'A', words: ['x'] },
        { index: 1, vi: 'B', words: ['y'] },
      ],
    });
    mockApi.submitAttempt.mockResolvedValue({
      verdict: 'correct',
      score: 90,
      feedback: 'Nice.',
      suggestedAnswer: 'X.',
    });
    const { result } = renderHook(() => useVerbalMappingSession());
    await act(async () => {
      await result.current.startSession({
        source: 'typed',
        typedWords: ['x'],
        numSentences: 2,
        difficulty: 'intermediate',
      });
    });
    await act(async () => {
      await result.current.submitAttempt('I X');
    });
    expect(result.current.lastGrade?.score).toBe(90);
    act(() => result.current.nextRound());
    expect(result.current.roundIndex).toBe(1);
    expect(result.current.currentSentence?.vi).toBe('B');
  });

  it('transitions to finished and exposes summary when last round is submitted', async () => {
    mockApi.startSession.mockResolvedValue({
      sessionId: 'sess-1',
      sentences: [{ index: 0, vi: 'A', words: ['x'] }],
    });
    mockApi.submitAttempt.mockResolvedValue({
      verdict: 'correct',
      score: 100,
      feedback: 'Perfect.',
      suggestedAnswer: 'A.',
    });
    mockApi.finish.mockResolvedValue({
      totalScore: 100,
      rounds: 1,
      perWord: [{ word: 'x', attempts: 1, avgScore: 100 }],
    });
    const { result } = renderHook(() => useVerbalMappingSession());
    await act(async () => {
      await result.current.startSession({
        source: 'typed',
        typedWords: ['x'],
        numSentences: 1,
        difficulty: 'intermediate',
      });
    });
    await act(async () => {
      await result.current.submitAttempt('I X');
    });
    await act(async () => {
      await result.current.nextRound();
    });
    expect(result.current.phase).toBe('finished');
    expect(result.current.summary?.totalScore).toBe(100);
    expect(mockApi.finish).toHaveBeenCalledWith('sess-1');
  });

  it('transitions to error phase when startSession rejects', async () => {
    mockApi.startSession.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useVerbalMappingSession());
    await act(async () => {
      await result.current.startSession({
        source: 'typed',
        typedWords: ['x'],
        numSentences: 1,
        difficulty: 'intermediate',
      });
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test; expect failure (module not found)**

```bash
npm test -- useVerbalMappingSession
```

- [ ] **Step 3: Implement the hook**

`app/modes/verbal-mapping/hooks/useVerbalMappingSession.ts`:

```ts
'use client';

import { useCallback, useReducer, useState } from 'react';
import { verbalMappingApi } from '@/services/verbalMappingApi';
import type {
  VerbalMappingSentence,
  VerbalMappingGrade,
  VerbalMappingSetupConfig,
  VerbalMappingSessionSummary,
} from '@/types';

type Phase = 'idle' | 'generating' | 'playing' | 'finished' | 'error';

interface State {
  phase: Phase;
  sessionId: string | null;
  sentences: VerbalMappingSentence[];
  roundIndex: number;
  lastGrade: VerbalMappingGrade | null;
  summary: VerbalMappingSessionSummary | null;
  error: string | null;
}

type Action =
  | { type: 'START' }
  | { type: 'GENERATED'; sessionId: string; sentences: VerbalMappingSentence[] }
  | { type: 'GRADED'; grade: VerbalMappingGrade }
  | { type: 'NEXT' }
  | { type: 'FINISHED'; summary: VerbalMappingSessionSummary }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

const initialState: State = {
  phase: 'idle',
  sessionId: null,
  sentences: [],
  roundIndex: 0,
  lastGrade: null,
  summary: null,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return { ...initialState, phase: 'generating' };
    case 'GENERATED':
      return {
        ...state,
        phase: 'playing',
        sessionId: action.sessionId,
        sentences: action.sentences,
        roundIndex: 0,
      };
    case 'GRADED':
      return { ...state, lastGrade: action.grade };
    case 'NEXT':
      return { ...state, roundIndex: state.roundIndex + 1, lastGrade: null };
    case 'FINISHED':
      return { ...state, phase: 'finished', summary: action.summary };
    case 'ERROR':
      return { ...state, phase: 'error', error: action.error };
    case 'RESET':
      return initialState;
  }
}

export function useVerbalMappingSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [busy, setBusy] = useState(false);

  const startSession = useCallback(async (config: VerbalMappingSetupConfig) => {
    dispatch({ type: 'START' });
    setBusy(true);
    try {
      const res = await verbalMappingApi.startSession({
        words: config.source === 'typed' ? config.typedWords : [],
        wordListId: config.source === 'list' ? config.wordListId : undefined,
        numSentences: config.numSentences,
        difficulty: config.difficulty,
      });
      dispatch({ type: 'GENERATED', sessionId: res.sessionId, sentences: res.sentences });
    } catch (err) {
      dispatch({ type: 'ERROR', error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  const submitAttempt = useCallback(
    async (transcript: string) => {
      if (!state.sessionId) return;
      const sentence = state.sentences[state.roundIndex];
      if (!sentence) return;
      setBusy(true);
      try {
        const grade = await verbalMappingApi.submitAttempt(
          state.sessionId,
          sentence.index,
          transcript,
        );
        dispatch({ type: 'GRADED', grade });
      } catch (err) {
        dispatch({ type: 'ERROR', error: (err as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [state.sessionId, state.sentences, state.roundIndex],
  );

  const nextRound = useCallback(async () => {
    const isLast = state.roundIndex >= state.sentences.length - 1;
    if (!isLast) {
      dispatch({ type: 'NEXT' });
      return;
    }
    // last round done → finish
    if (!state.sessionId) return;
    setBusy(true);
    try {
      const summary = await verbalMappingApi.finish(state.sessionId);
      dispatch({ type: 'FINISHED', summary });
    } catch (err) {
      dispatch({ type: 'ERROR', error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [state.roundIndex, state.sentences.length, state.sessionId]);

  const endEarly = useCallback(async () => {
    if (!state.sessionId) return;
    setBusy(true);
    try {
      const summary = await verbalMappingApi.finish(state.sessionId);
      dispatch({ type: 'FINISHED', summary });
    } catch (err) {
      dispatch({ type: 'ERROR', error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [state.sessionId]);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    phase: state.phase,
    roundIndex: state.roundIndex,
    sentences: state.sentences,
    currentSentence: state.sentences[state.roundIndex] ?? null,
    lastGrade: state.lastGrade,
    summary: state.summary,
    error: state.error,
    busy,
    startSession,
    submitAttempt,
    nextRound,
    endEarly,
    reset,
  };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
npm test -- useVerbalMappingSession
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/modes/verbal-mapping/hooks/useVerbalMappingSession.ts app/modes/verbal-mapping/hooks/__tests__/useVerbalMappingSession.test.ts
git commit -m "verbal-mapping: add useVerbalMappingSession state-machine hook"
```

---

## Task B7: `MicButton` component

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/components/MicButton.tsx`

- [ ] **Step 1: Create the component**

`app/modes/verbal-mapping/components/MicButton.tsx`:

```tsx
'use client';

import { AudioFilled, AudioMutedOutlined } from '@ant-design/icons';

interface MicButtonProps {
  status: 'idle' | 'recording' | 'done' | 'error';
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function MicButton({ status, supported, onStart, onStop }: MicButtonProps) {
  if (!supported) return null;
  const recording = status === 'recording';
  const label = recording ? 'Tap to stop' : 'Tap to speak';
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl shadow-lg transition-transform ${
          recording
            ? 'bg-red-500 animate-pulse scale-110'
            : 'bg-indigo-500 hover:bg-indigo-600'
        }`}
        aria-label={label}
      >
        {recording ? <AudioFilled /> : <AudioMutedOutlined />}
      </button>
      <span className="text-sm text-gray-600">{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/modes/verbal-mapping/components/MicButton.tsx
git commit -m "verbal-mapping: add MicButton component"
```

---

## Task B8: `WordSourcePicker` + `SetupPanel` components

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/components/WordSourcePicker.tsx`
- Create: `app/modes/verbal-mapping/components/SetupPanel.tsx`

- [ ] **Step 1: Create `WordSourcePicker`**

`app/modes/verbal-mapping/components/WordSourcePicker.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { wordListApi, WordListItem } from '@/services/wordListApi';

interface WordSourcePickerProps {
  source: 'list' | 'typed';
  wordListId?: string;
  typedWords: string[];
  onSourceChange: (source: 'list' | 'typed') => void;
  onWordListChange: (id: string | undefined) => void;
  onTypedWordsChange: (words: string[]) => void;
}

export function WordSourcePicker({
  source,
  wordListId,
  typedWords,
  onSourceChange,
  onWordListChange,
  onTypedWordsChange,
}: WordSourcePickerProps) {
  const [lists, setLists] = useState<WordListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'list') return;
    wordListApi
      .getAll()
      .then((items) => setLists(items))
      .catch((err: Error) => setListError(err.message));
  }, [source]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSourceChange('list')}
          className={`px-4 py-2 rounded-lg ${
            source === 'list' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Saved list
        </button>
        <button
          type="button"
          onClick={() => onSourceChange('typed')}
          className={`px-4 py-2 rounded-lg ${
            source === 'typed' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Type words
        </button>
      </div>

      {source === 'list' ? (
        <div>
          {listError ? (
            <p className="text-red-600 text-sm">{listError}</p>
          ) : (
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={wordListId ?? ''}
              onChange={(e) => onWordListChange(e.target.value || undefined)}
            >
              <option value="">Select a saved list...</option>
              {lists.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.word}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <textarea
          className="w-full border rounded-lg px-3 py-2 h-32"
          placeholder="Enter English words separated by commas or new lines (max 30)"
          value={typedWords.join('\n')}
          onChange={(e) => {
            const words = e.target.value
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 30);
            onTypedWordsChange(words);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `SetupPanel`**

`app/modes/verbal-mapping/components/SetupPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { VerbalMappingSetupConfig, VerbalMappingDifficulty } from '@/types';
import { WordSourcePicker } from './WordSourcePicker';

interface SetupPanelProps {
  busy: boolean;
  onStart: (config: VerbalMappingSetupConfig) => void;
}

export function SetupPanel({ busy, onStart }: SetupPanelProps) {
  const [source, setSource] = useState<'list' | 'typed'>('typed');
  const [wordListId, setWordListId] = useState<string | undefined>(undefined);
  const [typedWords, setTypedWords] = useState<string[]>([]);
  const [numSentences, setNumSentences] = useState<5 | 10 | 15 | 20>(10);
  const [difficulty, setDifficulty] =
    useState<VerbalMappingDifficulty>('intermediate');

  const valid =
    (source === 'typed' && typedWords.length > 0) ||
    (source === 'list' && !!wordListId);

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl p-6 shadow-lg space-y-6">
      <h2 className="text-2xl font-bold">Start a Verbal Mapping session</h2>

      <section>
        <h3 className="font-semibold mb-2">Word source</h3>
        <WordSourcePicker
          source={source}
          wordListId={wordListId}
          typedWords={typedWords}
          onSourceChange={setSource}
          onWordListChange={setWordListId}
          onTypedWordsChange={setTypedWords}
        />
      </section>

      <section>
        <h3 className="font-semibold mb-2">Session length</h3>
        <div className="flex gap-2">
          {([5, 10, 15, 20] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNumSentences(n)}
              className={`px-4 py-2 rounded-lg ${
                numSentences === n
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Difficulty</h3>
        <div className="flex gap-2">
          {(['beginner', 'intermediate', 'advanced'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty(d)}
              className={`px-4 py-2 rounded-lg capitalize ${
                difficulty === d
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        disabled={!valid || busy}
        onClick={() =>
          onStart({ source, wordListId, typedWords, numSentences, difficulty })
        }
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-semibold disabled:bg-gray-300"
      >
        {busy ? 'Generating sentences...' : 'Start session'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/modes/verbal-mapping/components/SetupPanel.tsx app/modes/verbal-mapping/components/WordSourcePicker.tsx
git commit -m "verbal-mapping: add SetupPanel and WordSourcePicker"
```

---

## Task B9: `PlayPanel` + `ResultPanel` components

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/components/PlayPanel.tsx`
- Create: `app/modes/verbal-mapping/components/ResultPanel.tsx`

- [ ] **Step 1: Create `ResultPanel`**

`app/modes/verbal-mapping/components/ResultPanel.tsx`:

```tsx
'use client';

import type { VerbalMappingGrade } from '@/types';

interface ResultPanelProps {
  grade: VerbalMappingGrade;
  onNext: () => void;
  isLast: boolean;
  busy?: boolean;
}

const VERDICT_STYLES: Record<VerbalMappingGrade['verdict'], { label: string; cls: string }> = {
  correct: { label: '✅ Correct', cls: 'bg-green-100 text-green-800' },
  partial: { label: '🟡 Close', cls: 'bg-yellow-100 text-yellow-800' },
  incorrect: { label: '❌ Try again', cls: 'bg-red-100 text-red-800' },
};

export function ResultPanel({ grade, onNext, isLast, busy }: ResultPanelProps) {
  const v = VERDICT_STYLES[grade.verdict];
  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg space-y-4">
      <div className="flex items-center gap-3">
        <span className={`px-3 py-1 rounded-full font-semibold ${v.cls}`}>
          {v.label}
        </span>
        <span className="text-2xl font-bold text-gray-900">{grade.score}/100</span>
      </div>
      <p className="text-gray-800">{grade.feedback}</p>
      <div>
        <p className="text-sm text-gray-500">Suggested answer:</p>
        <p className="text-gray-900">{grade.suggestedAnswer}</p>
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={busy}
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-semibold disabled:bg-gray-300"
      >
        {busy ? '...' : isLast ? 'Finish session' : 'Next ▶'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `PlayPanel`**

`app/modes/verbal-mapping/components/PlayPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { SoundOutlined } from '@ant-design/icons';
import type { VerbalMappingSentence, VerbalMappingGrade } from '@/types';
import { MicButton } from './MicButton';
import { ResultPanel } from './ResultPanel';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface PlayPanelProps {
  roundIndex: number;
  totalRounds: number;
  sentence: VerbalMappingSentence;
  grade: VerbalMappingGrade | null;
  busy: boolean;
  onSubmit: (transcript: string) => void;
  onNext: () => void;
  onEndEarly: () => void;
}

export function PlayPanel({
  roundIndex,
  totalRounds,
  sentence,
  grade,
  busy,
  onSubmit,
  onNext,
  onEndEarly,
}: PlayPanelProps) {
  const stt = useSpeechRecognition();
  const tts = useSpeechSynthesis();
  const [typedTranscript, setTypedTranscript] = useState('');
  const [editableTranscript, setEditableTranscript] = useState('');

  // Auto-play Vietnamese on each new round
  useEffect(() => {
    tts.speak(sentence.vi, 'vi-VN');
    setTypedTranscript('');
    setEditableTranscript('');
    stt.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.index]);

  // Mirror live STT transcript into the editable field
  useEffect(() => {
    if (stt.transcript) setEditableTranscript(stt.transcript);
  }, [stt.transcript]);

  const permissionDenied =
    stt.error === 'not-allowed' || stt.error === 'service-not-allowed';
  const useTypedFallback = !stt.supported || permissionDenied;
  const submitTranscript = useTypedFallback ? typedTranscript : editableTranscript;
  const canSubmit = submitTranscript.trim().length > 0 && !busy;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">
          Round {roundIndex + 1} / {totalRounds}
        </span>
        <button
          type="button"
          onClick={onEndEarly}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          End session
        </button>
      </div>

      {!stt.supported && (
        <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-3 text-sm">
          Speech input isn't available in this browser — try Chrome or Edge for
          the full experience. You can still type your answer below.
        </div>
      )}
      {permissionDenied && (
        <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg p-3 text-sm">
          We need mic access to grade your speech. Re-enable it in your browser's
          site settings, then refresh. You can also type your answer below.
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 shadow-lg space-y-4">
        <div className="flex items-start gap-3">
          <p className="text-2xl text-gray-900 flex-1">{sentence.vi}</p>
          <button
            type="button"
            onClick={() => tts.speak(sentence.vi, 'vi-VN')}
            className="text-indigo-500 hover:text-indigo-700 text-2xl"
            aria-label="Replay Vietnamese"
          >
            <SoundOutlined />
          </button>
        </div>
      </div>

      {grade ? (
        <ResultPanel
          grade={grade}
          onNext={onNext}
          isLast={roundIndex === totalRounds - 1}
          busy={busy}
        />
      ) : (
        <div className="bg-white rounded-2xl p-6 shadow-lg space-y-4">
          {useTypedFallback ? (
            <textarea
              className="w-full border rounded-lg px-3 py-2 h-24"
              placeholder="Type your English answer..."
              value={typedTranscript}
              onChange={(e) => setTypedTranscript(e.target.value)}
            />
          ) : (
            <>
              <MicButton
                status={stt.status}
                supported={stt.supported}
                onStart={stt.start}
                onStop={stt.stop}
              />
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Transcript (edit if needed)"
                value={editableTranscript}
                onChange={(e) => setEditableTranscript(e.target.value)}
              />
            </>
          )}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(submitTranscript.trim())}
            className="w-full py-3 rounded-lg bg-indigo-600 text-white font-semibold disabled:bg-gray-300"
          >
            {busy ? 'Grading...' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/modes/verbal-mapping/components/PlayPanel.tsx app/modes/verbal-mapping/components/ResultPanel.tsx
git commit -m "verbal-mapping: add PlayPanel and ResultPanel"
```

---

## Task B10: `SummaryPanel` component

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/components/SummaryPanel.tsx`

- [ ] **Step 1: Create the component**

`app/modes/verbal-mapping/components/SummaryPanel.tsx`:

```tsx
'use client';

import type { VerbalMappingSessionSummary } from '@/types';

interface SummaryPanelProps {
  summary: VerbalMappingSessionSummary;
  onPlayAgain: () => void;
  onBack: () => void;
}

export function SummaryPanel({ summary, onPlayAgain, onBack }: SummaryPanelProps) {
  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl p-6 shadow-lg space-y-6">
      <div className="text-center">
        <p className="text-sm text-gray-500">Final score</p>
        <p className="text-5xl font-bold text-indigo-600">{summary.totalScore}</p>
        <p className="text-sm text-gray-600">{summary.rounds} rounds</p>
      </div>

      <section>
        <h3 className="font-semibold mb-2">By word</h3>
        <table className="w-full text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="text-left">Word</th>
              <th className="text-right">Attempts</th>
              <th className="text-right">Avg score</th>
            </tr>
          </thead>
          <tbody>
            {summary.perWord.map((row) => (
              <tr key={row.word} className="border-t">
                <td className="py-1">{row.word}</td>
                <td className="text-right">{row.attempts}</td>
                <td className="text-right">{row.avgScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="flex-1 py-3 rounded-lg bg-indigo-600 text-white font-semibold"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-800 font-semibold"
        >
          Back to /games
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/modes/verbal-mapping/components/SummaryPanel.tsx
git commit -m "verbal-mapping: add SummaryPanel"
```

---

## Task B11: Route entry `app/modes/verbal-mapping/page.tsx`

**Frontend root:** `/Users/ducleminh/games-and-tools/english-learning-games`

**Files:**
- Create: `app/modes/verbal-mapping/page.tsx`

- [ ] **Step 1: Create the page**

`app/modes/verbal-mapping/page.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SetupPanel } from './components/SetupPanel';
import { PlayPanel } from './components/PlayPanel';
import { SummaryPanel } from './components/SummaryPanel';
import { useVerbalMappingSession } from './hooks/useVerbalMappingSession';

export default function VerbalMappingPage() {
  const router = useRouter();
  const session = useVerbalMappingSession();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.replace('/auth?return=/modes/verbal-mapping');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 px-4 py-12">
      {session.phase === 'idle' && (
        <SetupPanel busy={session.busy} onStart={session.startSession} />
      )}
      {session.phase === 'generating' && (
        <div className="text-center text-gray-600 mt-12">
          Generating sentences...
        </div>
      )}
      {session.phase === 'playing' && session.currentSentence && (
        <PlayPanel
          roundIndex={session.roundIndex}
          totalRounds={session.sentences.length}
          sentence={session.currentSentence}
          grade={session.lastGrade}
          busy={session.busy}
          onSubmit={session.submitAttempt}
          onNext={session.nextRound}
          onEndEarly={session.endEarly}
        />
      )}
      {session.phase === 'finished' && session.summary && (
        <SummaryPanel
          summary={session.summary}
          onPlayAgain={() => session.reset()}
          onBack={() => router.push('/games')}
        />
      )}
      {session.phase === 'error' && (
        <div className="max-w-xl mx-auto bg-red-50 border border-red-300 text-red-800 rounded-lg p-4">
          <p className="font-semibold">Something went wrong</p>
          <p className="text-sm">{session.error}</p>
          <button
            type="button"
            onClick={() => session.reset()}
            className="mt-3 px-4 py-2 rounded-lg bg-red-600 text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/ducleminh/games-and-tools/english-learning-games
npm run build
```

Build must succeed.

- [ ] **Step 3: Run all frontend tests**

```bash
npm test
```

Expected: 7 tests passing (`useSpeechRecognition` 3 + `useVerbalMappingSession` 4).

- [ ] **Step 4: Commit**

```bash
git add app/modes/verbal-mapping/page.tsx
git commit -m "verbal-mapping: wire up the route entry page"
```

---

## Task B12: Manual verification (no commit)

This is the end-to-end smoke test. Requires Postgres + the api running with a valid `LLM_API_KEY` set in the api's `.env`.

- [ ] **Step 1: Boot both sides**

In one shell:
```bash
cd /Users/ducleminh/games-and-tools
./dev.sh
```

Both `[api]` and `[web]` should come up. Api should log `LLM Service initialized (...)`.

- [ ] **Step 2: Sign in (or sign up) at `localhost:3209/auth`**

You need an `auth_token` in localStorage for the rest of the test.

- [ ] **Step 3: Visit `localhost:3209/games`**

Expected: three cards, including "Verbal Mapping" with a mic icon. Click it.

- [ ] **Step 4: Start a session with typed words**

- Select "Type words"
- Enter `walk, intelligent, serendipity`
- Pick `5` sentences, `intermediate`
- Click "Start session"

Expected: ~2-5s loading, then the first Vietnamese sentence appears + auto-plays.

- [ ] **Step 5: Complete one round via mic (Chrome)**

- Tap the mic button → grant mic permission if prompted.
- Speak a translation in English.
- Tap the mic again to stop.
- Edit the transcript if STT got something wrong.
- Tap Submit.

Expected: result panel shows verdict + score + feedback + suggested answer. Click Next.

- [ ] **Step 6: Complete the rest of the session and reach Summary**

Expected: SummaryPanel shows total score, rounds = 5, per-word breakdown.

- [ ] **Step 7: Try the typed-fallback path in Firefox**

Same flow, but the mic button is replaced by a textarea. Submit a typed answer. Confirm grading works identically.

- [ ] **Step 8: Try the auth-redirect path**

Open `localhost:3209/modes/verbal-mapping` in an incognito window. Expected: redirected to `/auth?return=/modes/verbal-mapping`.

- [ ] **Step 9: Try re-submission**

Within an active session, manually issue a second submit for the same round (e.g., by going back via browser back). The verdict should update; no duplicate row in the database. Verify in psql:

```bash
docker exec -it dictionary-postgres psql -U dictionary_user -d english_learning_db -c \
  "SELECT session_id, sentence_index, COUNT(*) FROM verbal_mapping_attempts GROUP BY 1,2 HAVING COUNT(*) > 1;"
```

Expected: empty result.

- [ ] **Step 10: Confirm `/games` card text and styling looks right**

Visual check.

If any step fails, file the issue and resolve before declaring the plan complete.
