# OpenRouter LLM Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the backend's AI provider from local vLLM + Phi-3 to OpenRouter (OpenAI-compatible), and consolidate all AI calls into `LlmService` so it is the only place in the codebase that knows the provider.

**Architecture:** Use the official `openai` Node SDK pointed at OpenRouter's base URL. `LlmService` exposes a small typed surface (`generateSentences`, `chatWithUser`, `lookupDictionaryWord`, `translate`, `healthCheck`) backed by a private `chat()` helper that does central error mapping. `DictionaryService` keeps its public API but its body becomes thin — it delegates to `LlmService` and retains the MyMemory fallback only for `translate()`.

**Tech Stack:** NestJS 10, TypeScript 5, `openai` SDK 4.x (or latest), Jest + ts-jest for unit tests, OpenRouter as the provider.

**Spec:** [`docs/superpowers/specs/2026-05-21-openrouter-llm-swap-design.md`](../specs/2026-05-21-openrouter-llm-swap-design.md)

---

## File Structure

### Create

- `src/llm/llm.service.spec.ts` — unit tests for `LlmService`
- `src/llm/llm.smoke.spec.ts` — opt-in smoke test against real OpenRouter (skipped unless `LLM_SMOKE=1`)
- `src/dictionary/dictionary.service.spec.ts` — unit tests for refactored `DictionaryService` methods

### Modify

- `package.json` — add `openai` dep; add Jest devDeps, Jest config, `test` script
- `src/config/configuration.ts` — replace `llm` config block with new shape
- `.env.example` — replace `# vLLM Configuration` block with `# LLM Configuration` block
- `src/llm/llm.module.ts` — drop `HttpModule` import
- `src/llm/llm.service.ts` — full rewrite (becomes the only AI caller)
- `src/llm/llm.controller.ts` — one-line rename: `chat()` call → `chatWithUser()`
- `src/dictionary/dictionary.module.ts` — add `LlmModule` to imports
- `src/dictionary/dictionary.service.ts` — remove vLLM types/fields/HTTP calls; delegate to `LlmService`; keep MyMemory fallback
- `README.md` — sweep vLLM references
- `DICTIONARY_SETUP.md`, `IMPLEMENTATION_GUIDE.md` — sweep `VLLM_URL` / `VLLM_MODEL` references

### Design notes

- `LookupWordResponseDto`, `TranslateDto`, `TranslateResponseDto` live in `src/dictionary/dto/`. `LlmService` imports them from there (minor cross-module dep; acceptable; can be moved later if needed).
- `LlmService` constructor accepts an optional `openaiOverride: OpenAI` parameter. In production this is `undefined` (Nest DI doesn't fill it), so the real `OpenAI` client is constructed. In tests, a fake client is passed directly. This avoids module-level `jest.mock('openai')` complications.
- Error classes are imported as named imports from `openai` (`APIConnectionTimeoutError`, `APIConnectionError`, `RateLimitError`, `AuthenticationError`) so `instanceof` checks work cleanly.

---

## Task 1: Set up Jest test infrastructure

**Files:**
- Modify: `package.json`

The project currently has no test infrastructure. The spec assumes unit tests, so we add Jest first.

- [ ] **Step 1: Install Jest dev dependencies**

Run from `english-learning-api/`:
```bash
npm install -D jest @types/jest ts-jest @nestjs/testing
```

- [ ] **Step 2: Add Jest config and `test` script to `package.json`**

Add `"test": "jest"` to the `scripts` block (place it just before `"format"`).

Add this `jest` key at the top level (after `devDependencies`):

```json
"jest": {
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "testEnvironment": "node",
  "moduleNameMapper": {
    "^src/(.*)$": "<rootDir>/$1"
  }
}
```

- [ ] **Step 3: Create a sanity test**

Create `src/__sanity__/sanity.spec.ts`:
```ts
describe('jest infra', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests and verify sanity test passes**

Run: `npm test`
Expected: `Tests: 1 passed, 1 total`.

- [ ] **Step 5: Delete the sanity test**

Remove `src/__sanity__/sanity.spec.ts` and its empty parent dir:
```bash
rm -rf src/__sanity__
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: set up Jest test infrastructure"
```

---

## Task 2: Add `openai` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run from `english-learning-api/`:
```bash
npm install openai
```

- [ ] **Step 2: Verify it's in `dependencies`**

Run: `grep '"openai"' package.json`
Expected: a line like `"openai": "^4.x.x"` (or latest major) under `"dependencies"`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add openai SDK dependency"
```

---

## Task 3: Update configuration and .env.example for new LLM env vars

**Files:**
- Modify: `src/config/configuration.ts`
- Modify: `.env.example`

- [ ] **Step 1: Rewrite the `llm` block in `configuration.ts`**

Replace the existing `llm: { ... }` block (currently keys `url`, `model`, `enableFallback`) with:

```ts
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    model: process.env.LLM_MODEL || 'openai/gpt-4o-mini',
    enableFallback: process.env.LLM_FALLBACK_ENABLED !== 'false',
    appTitle: process.env.LLM_APP_TITLE || 'english-learning-api',
    httpReferer: process.env.LLM_HTTP_REFERER,
  },
```

- [ ] **Step 2: Replace the `# vLLM Configuration` block in `.env.example`**

Replace the existing vLLM block (containing `VLLM_URL` and `VLLM_MODEL`) with:

```
# LLM Configuration (OpenRouter / OpenAI-compatible)
# Works with any OpenAI-compatible /v1/chat/completions endpoint
LLM_API_KEY=
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
# Optional analytics headers for OpenRouter
LLM_APP_TITLE=english-learning-api
# LLM_HTTP_REFERER=https://your-app.example.com

# Dictionary LLM Fallback
# Set to 'false' to disable LLM fallback for dictionary lookups
LLM_FALLBACK_ENABLED=true
```

(Leave the existing `LLM_FALLBACK_ENABLED` comment block, but ensure it appears only once — delete the duplicate from below if present.)

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npm run build`
Expected: build succeeds. `LlmService` and `DictionaryService` still reference `llm.url` and `llm.model` at runtime, but those calls are loose-typed via `configService.get<string>(...)`, so TS compiles.

- [ ] **Step 4: Commit**

```bash
git add src/config/configuration.ts .env.example
git commit -m "config: replace vLLM env vars with provider-neutral LLM_* vars"
```

---

## Task 4: TDD `LlmService` constructor + skeleton

**Files:**
- Create: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts` (full rewrite to skeleton)
- Modify: `src/llm/llm.module.ts` (drop `HttpModule`)
- Modify: `src/llm/llm.controller.ts` (one line: `chat()` → `chatWithUser()`)

This task replaces the entire `LlmService` class body with a new skeleton: real constructor + method stubs that `throw new Error('not yet implemented')`. Subsequent tasks fill in each method test-first.

- [ ] **Step 1: Write the failing constructor test**

Create `src/llm/llm.service.spec.ts`:
```ts
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

function makeConfig(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('LlmService — constructor', () => {
  it('throws if LLM_API_KEY is missing', () => {
    expect(() => new LlmService(makeConfig({}))).toThrow(
      /LLM_API_KEY is required/,
    );
  });

  it('initializes when API key is set', () => {
    const svc = new LlmService(
      makeConfig({
        'llm.apiKey': 'test-key',
        'llm.baseUrl': 'https://openrouter.ai/api/v1',
        'llm.model': 'openai/gpt-4o-mini',
        'llm.appTitle': 'test',
      }),
    );
    expect(svc).toBeDefined();
  });

  it('uses the injected OpenAI override when provided', () => {
    const fake = { chat: { completions: { create: jest.fn() } } } as unknown as OpenAI;
    const svc = new LlmService(
      makeConfig({
        'llm.apiKey': 'k',
        'llm.baseUrl': 'u',
        'llm.model': 'm',
      }),
      fake,
    );
    // @ts-expect-error — testing private field
    expect(svc.openai).toBe(fake);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- llm.service.spec`
Expected: tests fail because the existing `LlmService` constructor takes `(ConfigService, HttpService)` and the old config keys no longer exist.

- [ ] **Step 3: Rewrite `src/llm/llm.service.ts` to the new skeleton**

Replace the entire file contents with:

```ts
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError,
  AuthenticationError,
} from 'openai';
import {
  GenerateSentencesDto,
  GenerateSentencesResponseDto,
} from './dto/generate-setences.dto';
import { ChatDto, ChatResponseDto } from './dto/chat.dto';
import { LookupWordResponseDto } from '../dictionary/dto/lookup-word.dto';
import {
  TranslateDto,
  TranslateResponseDto,
} from '../dictionary/dto/translate.dto';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  timeoutMs?: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    private configService: ConfigService,
    openaiOverride?: OpenAI,
  ) {
    const apiKey = configService.get<string>('llm.apiKey');
    if (!apiKey) {
      throw new Error('LLM_API_KEY is required but not set');
    }
    this.baseUrl = configService.get<string>('llm.baseUrl') ?? '';
    this.model = configService.get<string>('llm.model') ?? '';
    const appTitle = configService.get<string>('llm.appTitle') ?? 'english-learning-api';
    const httpReferer = configService.get<string>('llm.httpReferer');
    this.openai =
      openaiOverride ??
      new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
        defaultHeaders: {
          'X-Title': appTitle,
          ...(httpReferer ? { 'HTTP-Referer': httpReferer } : {}),
        },
      });
    this.logger.log(
      `LLM Service initialized (baseURL=${this.baseUrl}, model=${this.model})`,
    );
  }

  async generateSentences(
    _dto: GenerateSentencesDto,
  ): Promise<GenerateSentencesResponseDto> {
    throw new Error('not yet implemented');
  }

  async chatWithUser(_dto: ChatDto): Promise<ChatResponseDto> {
    throw new Error('not yet implemented');
  }

  async lookupDictionaryWord(_word: string): Promise<LookupWordResponseDto> {
    throw new Error('not yet implemented');
  }

  async translate(_dto: TranslateDto): Promise<TranslateResponseDto> {
    throw new Error('not yet implemented');
  }

  async healthCheck() {
    return { status: 'healthy', model: this.model, url: this.baseUrl };
  }

  private async chat(_messages: ChatMessage[], _opts: ChatOpts = {}): Promise<string> {
    throw new Error('not yet implemented');
  }
}
```

- [ ] **Step 4: Drop `HttpModule` from `src/llm/llm.module.ts`**

Replace the file with:
```ts
import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';

@Module({
  controllers: [LlmController],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
```

- [ ] **Step 5: Update `src/llm/llm.controller.ts` to call `chatWithUser`**

Find the line `return this.llmService.chat(chatDto);` and change it to:
```ts
return this.llmService.chatWithUser(chatDto);
```

- [ ] **Step 6: Run the test to verify constructor tests pass**

Run: `npm test -- llm.service.spec`
Expected: 3 tests pass (`throws if LLM_API_KEY is missing`, `initializes when API key is set`, `uses the injected OpenAI override when provided`).

- [ ] **Step 7: Run the build to verify TS compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts src/llm/llm.module.ts src/llm/llm.controller.ts
git commit -m "llm: skeleton LlmService with new OpenRouter-backed constructor"
```

---

## Task 5: TDD private `chat()` helper

**Files:**
- Modify: `src/llm/llm.service.spec.ts` (add `describe('LlmService.chat() helper', ...)`)
- Modify: `src/llm/llm.service.ts` (implement the `chat()` method body)

- [ ] **Step 1: Add a shared test helper at the top of `llm.service.spec.ts`**

Above the existing `describe(...)`, add:
```ts
import { HttpStatus } from '@nestjs/common';

const baseConfig = {
  'llm.apiKey': 'test-key',
  'llm.baseUrl': 'https://openrouter.ai/api/v1',
  'llm.model': 'openai/gpt-4o-mini',
  'llm.appTitle': 'test',
};

function makeServiceWithMock(
  mockCreate: jest.Mock,
  overrides: Partial<typeof baseConfig> = {},
): LlmService {
  const fakeOpenAI = {
    chat: { completions: { create: mockCreate } },
  } as unknown as OpenAI;
  return new LlmService(makeConfig({ ...baseConfig, ...overrides }), fakeOpenAI);
}

function makeSdkError(
  Cls: new (...args: never[]) => Error,
  message: string,
): Error {
  const err = Object.create(Cls.prototype) as Error;
  Object.assign(err, { message });
  return err;
}
```

- [ ] **Step 2: Write failing tests for `chat()`**

Append to `llm.service.spec.ts`:
```ts
import {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError,
  AuthenticationError,
} from 'openai';

describe('LlmService.chat() helper', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('returns trimmed assistant content on success', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '  hello world  ' } }],
    });
    // @ts-expect-error — invoking private method for unit test
    const result = await svc.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hello world');
  });

  it('passes temperature, max_tokens, response_format, and timeout to SDK', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    // @ts-expect-error — invoking private method for unit test
    await svc.chat(
      [{ role: 'user', content: 'x' }],
      {
        temperature: 0.3,
        maxTokens: 1500,
        responseFormat: { type: 'json_object' },
        timeoutMs: 5000,
      },
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'x' }],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
      { timeout: 5000 },
    );
  });

  it('maps APIConnectionTimeoutError to 503', async () => {
    mockCreate.mockRejectedValue(makeSdkError(APIConnectionTimeoutError, 'timeout'));
    // @ts-expect-error — invoking private method for unit test
    await expect(svc.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'LLM provider unreachable',
    });
  });

  it('maps APIConnectionError to 503', async () => {
    mockCreate.mockRejectedValue(makeSdkError(APIConnectionError, 'net'));
    // @ts-expect-error — invoking private method for unit test
    await expect(svc.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('maps RateLimitError to 429', async () => {
    mockCreate.mockRejectedValue(makeSdkError(RateLimitError, 'rate'));
    // @ts-expect-error — invoking private method for unit test
    await expect(svc.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: 'LLM rate limit exceeded',
    });
  });

  it('maps AuthenticationError to 500 with sanitized message', async () => {
    mockCreate.mockRejectedValue(makeSdkError(AuthenticationError, 'bad key abc123'));
    // @ts-expect-error — invoking private method for unit test
    await expect(svc.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'LLM provider misconfigured',
    });
  });

  it('maps any other error to 500 with generic message', async () => {
    mockCreate.mockRejectedValue(new Error('unknown'));
    // @ts-expect-error — invoking private method for unit test
    await expect(svc.chat([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'LLM request failed',
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- llm.service.spec`
Expected: 7 `chat()` tests fail with "not yet implemented".

- [ ] **Step 4: Implement `chat()` in `llm.service.ts`**

Replace the stub `private async chat(...)` body with:

```ts
private async chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const preview =
    typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 200) : '';
  try {
    const response = await this.openai.chat.completions.create(
      {
        model: this.model,
        messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
      },
      opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : undefined,
    );
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `LLM call failed (model=${this.model}, messages=${messages.length}, preview=${preview}): ${message}`,
    );
    if (err instanceof APIConnectionTimeoutError || err instanceof APIConnectionError) {
      throw new HttpException(
        'LLM provider unreachable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (err instanceof RateLimitError) {
      throw new HttpException(
        'LLM rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (err instanceof AuthenticationError) {
      throw new HttpException(
        'LLM provider misconfigured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    throw new HttpException(
      'LLM request failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm test -- llm.service.spec`
Expected: 10 tests pass (3 constructor + 7 chat).

- [ ] **Step 6: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: implement chat() helper with central error mapping"
```

---

## Task 6: TDD `generateSentences()`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Write the failing tests**

Append to `llm.service.spec.ts`:
```ts
describe('LlmService.generateSentences', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('builds system + user messages and parses N non-short sentences', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'Sentence one is here.\nShort.\nSentence two is here too.\nA third good sentence.\n',
          },
        },
      ],
    });
    const result = await svc.generateSentences({
      words: ['ephemeral', 'ubiquitous'],
      numSentences: 3,
      difficulty: 'intermediate',
      temperature: 0.7,
    });
    expect(result.sentences).toEqual([
      'Sentence one is here.',
      'Sentence two is here too.',
      'A third good sentence.',
    ]);
    expect(result.wordsUsed).toEqual(['ephemeral', 'ubiquitous']);
    const [call] = mockCreate.mock.calls;
    expect(call[0].messages[0]).toMatchObject({ role: 'system' });
    expect(call[0].messages[0].content).toMatch(/English teacher/i);
    expect(call[0].messages[1]).toMatchObject({ role: 'user' });
    expect(call[0].messages[1].content).toContain('ephemeral, ubiquitous');
    expect(call[0].temperature).toBe(0.7);
    expect(call[0].max_tokens).toBe(500);
  });

  it('throws 500 when no sentences could be parsed', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '   \n  \n' } }],
    });
    await expect(
      svc.generateSentences({
        words: ['a'],
        numSentences: 1,
        difficulty: 'intermediate',
        temperature: 0.7,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to generate sentences',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- llm.service.spec`
Expected: 2 new tests fail with "not yet implemented".

- [ ] **Step 3: Implement `generateSentences()`**

Replace the stub body with:
```ts
async generateSentences(
  dto: GenerateSentencesDto,
): Promise<GenerateSentencesResponseDto> {
  const wordsStr = dto.words.join(', ');
  const difficultyInstructions: Record<string, string> = {
    beginner: 'Use simple grammar and common words.',
    intermediate: 'Use natural everyday English.',
    advanced: 'Use sophisticated vocabulary and complex grammar.',
  };
  const difficultyText =
    difficultyInstructions[dto.difficulty] ?? difficultyInstructions.intermediate;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are an English teacher helping students learn new vocabulary.',
    },
    {
      role: 'user',
      content: `Create ${dto.numSentences} clear example sentences that use these words: ${wordsStr}

Requirements:
- Each sentence must use at least one of the words
- Make sentences natural and practical
- ${difficultyText}
- Show the word in context
- Keep sentences concise and clear

Format: Return only the sentences, one per line, without numbering.`,
    },
  ];
  const text = await this.chat(messages, {
    temperature: dto.temperature,
    maxTokens: 500,
  });
  const sentences = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .slice(0, dto.numSentences);
  if (sentences.length === 0) {
    throw new HttpException(
      'Failed to generate sentences',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return { sentences, wordsUsed: dto.words };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- llm.service.spec`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: implement generateSentences using OpenAI messages format"
```

---

## Task 7: TDD `chatWithUser()`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Write the failing test**

Append to `llm.service.spec.ts`:
```ts
describe('LlmService.chatWithUser', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('sends system + user messages and returns the response text', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A coherent reply.' } }],
    });
    const result = await svc.chatWithUser({
      message: 'What is a gerund?',
      temperature: 0.7,
      maxTokens: 300,
    });
    expect(result).toEqual({ response: 'A coherent reply.' });
    const [call] = mockCreate.mock.calls;
    expect(call[0].messages[0]).toMatchObject({ role: 'system' });
    expect(call[0].messages[0].content).toMatch(/English teacher assistant/i);
    expect(call[0].messages[1]).toEqual({
      role: 'user',
      content: 'What is a gerund?',
    });
    expect(call[0].temperature).toBe(0.7);
    expect(call[0].max_tokens).toBe(300);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- llm.service.spec`
Expected: new test fails with "not yet implemented".

- [ ] **Step 3: Implement `chatWithUser()`**

Replace the stub body with:
```ts
async chatWithUser(dto: ChatDto): Promise<ChatResponseDto> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a helpful English teacher assistant. Answer questions about English grammar, vocabulary, and usage.',
    },
    { role: 'user', content: dto.message },
  ];
  const text = await this.chat(messages, {
    temperature: dto.temperature,
    maxTokens: dto.maxTokens,
  });
  return { response: text };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- llm.service.spec`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: implement chatWithUser using OpenAI messages format"
```

---

## Task 8: TDD `lookupDictionaryWord()`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Write the failing tests**

Append to `llm.service.spec.ts`:
```ts
describe('LlmService.lookupDictionaryWord', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('requests JSON response_format and parses the returned JSON', async () => {
    const fakeEntry = {
      word: 'cat',
      pronunciations: [{ accent: 'US', ipa: '/kæt/' }],
      definitions: [
        {
          pos: 'noun',
          definition_en: 'A small domesticated carnivorous mammal.',
          definition_vi: 'Mèo',
          level: 'beginner',
          examples: [{ en: 'The cat sleeps.', vi: 'Con mèo ngủ.' }],
        },
      ],
      word_forms: { plural: 'cats', past: '', present: '' },
      synonyms: ['feline'],
    };
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(fakeEntry) } }],
    });
    const result = await svc.lookupDictionaryWord('cat');
    expect(result).toEqual(fakeEntry);
    const [call] = mockCreate.mock.calls;
    expect(call[0].response_format).toEqual({ type: 'json_object' });
    expect(call[0].temperature).toBe(0.3);
    expect(call[0].max_tokens).toBe(1500);
    expect(call[0].messages[0].content).toMatch(/English-Vietnamese dictionary/i);
    expect(call[0].messages[1].content).toContain('"cat"');
  });

  it('tolerates JSON wrapped in prose by extracting the first {...} block', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Here is the entry: {"word":"x","pronunciations":[],"definitions":[],"word_forms":{},"synonyms":[]}',
          },
        },
      ],
    });
    const result = await svc.lookupDictionaryWord('x');
    expect(result.word).toBe('x');
  });

  it('throws 500 when response contains no JSON object', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'no json here' } }],
    });
    await expect(svc.lookupDictionaryWord('x')).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to parse dictionary data',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- llm.service.spec`
Expected: 3 new tests fail.

- [ ] **Step 3: Implement `lookupDictionaryWord()`**

Replace the stub body with:
```ts
async lookupDictionaryWord(word: string): Promise<LookupWordResponseDto> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an English-Vietnamese dictionary. Provide comprehensive dictionary information in JSON format.',
    },
    {
      role: 'user',
      content: `Provide a complete dictionary entry for the English word "${word}" with Vietnamese translations.

Return ONLY valid JSON in this exact format:
{
  "word": "${word}",
  "pronunciations": [
    {"accent": "US", "ipa": "/pronunciation/"},
    {"accent": "UK", "ipa": "/pronunciation/"}
  ],
  "definitions": [
    {
      "pos": "part of speech",
      "definition_en": "English definition",
      "definition_vi": "Vietnamese translation",
      "level": "beginner/intermediate/advanced",
      "examples": [
        {"en": "English example", "vi": "Vietnamese example"}
      ]
    }
  ],
  "word_forms": {"plural": "...", "past": "...", "present": "..."},
  "synonyms": ["synonym1", "synonym2"]
}`,
    },
  ];
  const text = await this.chat(messages, {
    temperature: 0.3,
    maxTokens: 1500,
    responseFormat: { type: 'json_object' },
  });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new HttpException(
      'Failed to parse dictionary data',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return JSON.parse(jsonMatch[0]) as LookupWordResponseDto;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- llm.service.spec`
Expected: 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: implement lookupDictionaryWord (moved from DictionaryService)"
```

---

## Task 9: TDD `translate()`

**Files:**
- Modify: `src/llm/llm.service.spec.ts`
- Modify: `src/llm/llm.service.ts`

- [ ] **Step 1: Write the failing tests**

Append to `llm.service.spec.ts`:
```ts
describe('LlmService.translate', () => {
  let mockCreate: jest.Mock;
  let svc: LlmService;

  beforeEach(() => {
    mockCreate = jest.fn();
    svc = makeServiceWithMock(mockCreate);
  });

  it('sends translator system prompt with 5s timeout, returns translated text', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Xin chào' } }],
    });
    const result = await svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    });
    expect(result).toEqual({
      original_text: 'Hello',
      translated_text: 'Xin chào',
      source_lang: 'en',
      target_lang: 'vi',
    });
    const [args, opts] = mockCreate.mock.calls[0];
    expect(args.messages[0].content).toMatch(/professional translator/i);
    expect(args.messages[1].content).toContain('English');
    expect(args.messages[1].content).toContain('Vietnamese');
    expect(args.messages[1].content).toContain('Hello');
    expect(args.temperature).toBe(0.3);
    expect(args.max_tokens).toBe(500);
    expect(opts).toEqual({ timeout: 5000 });
  });

  it('propagates errors so DictionaryService can fall back', async () => {
    mockCreate.mockRejectedValue(makeSdkError(APIConnectionTimeoutError, 'timeout'));
    await expect(
      svc.translate({ text: 'x', source_lang: 'en', target_lang: 'vi' }),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- llm.service.spec`
Expected: 2 new tests fail.

- [ ] **Step 3: Implement `translate()`**

Replace the stub body with:
```ts
async translate(dto: TranslateDto): Promise<TranslateResponseDto> {
  const languageNames: Record<string, string> = {
    en: 'English',
    vi: 'Vietnamese',
    'zh-cn': 'Chinese',
    es: 'Spanish',
    hi: 'Hindi',
    bn: 'Bengali',
    pt: 'Portuguese',
    ru: 'Russian',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
  };
  const sourceLangName = languageNames[dto.source_lang] ?? dto.source_lang;
  const targetLangName = languageNames[dto.target_lang] ?? dto.target_lang;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a professional translator. Translate accurately and naturally.',
    },
    {
      role: 'user',
      content: `Translate the following text from ${sourceLangName} to ${targetLangName}.
Output ONLY the translation, nothing else.

Text: ${dto.text}`,
    },
  ];
  const translatedText = await this.chat(messages, {
    temperature: 0.3,
    maxTokens: 500,
    timeoutMs: 5000,
  });
  return {
    original_text: dto.text,
    translated_text: translatedText,
    source_lang: dto.source_lang,
    target_lang: dto.target_lang,
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- llm.service.spec`
Expected: 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/llm.service.ts src/llm/llm.service.spec.ts
git commit -m "llm: implement translate (moved from DictionaryService)"
```

---

## Task 10: TDD `DictionaryService.lookupWord` delegates to `LlmService`

**Files:**
- Create: `src/dictionary/dictionary.service.spec.ts`
- Modify: `src/dictionary/dictionary.module.ts` (add `LlmModule` to imports)
- Modify: `src/dictionary/dictionary.service.ts`

This task only changes the LLM-path of `lookupWord` (the path inside `generateWordWithLlm` / wherever the LLM HTTP call lives). DB lookup, search index, cache, and the `LLM_FALLBACK_ENABLED` gate remain unchanged.

- [ ] **Step 1: Add `LlmModule` to `DictionaryModule` imports**

Edit `src/dictionary/dictionary.module.ts` — add `LlmModule` to the `imports` array and `import { LlmModule } from '../llm/llm.module';` at the top.

- [ ] **Step 2: Inject `LlmService` into `DictionaryService`**

In `src/dictionary/dictionary.service.ts`:
- Add `import { LlmService } from '../llm/llm.service';`
- Add `private llmService: LlmService,` as the **last** parameter in the existing constructor (after `synonymRepository`). Appending minimizes diff churn against the existing parameter list.

- [ ] **Step 3: Write the failing test**

Create `src/dictionary/dictionary.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { DictionaryService } from './dictionary.service';
import { LlmService } from '../llm/llm.service';
import { Word } from './entities/word.entity';
import { Pronunciation } from './entities/pronunciation.entity';
import { Definition } from './entities/definition.entity';
import { Example } from './entities/example.entity';
import { WordForm } from './entities/word-form.entity';
import { Synonym } from './entities/synonym.entity';
import { AudioService } from './audio.service';
import { SearchIndexService } from '../common/search/search-index.service';
import { RedisCacheService } from '../common/cache/redis-cache.service';

function emptyRepo() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
  };
}

async function buildModule(overrides: {
  llmService?: Partial<LlmService>;
  config?: Record<string, unknown>;
  httpService?: Partial<HttpService>;
} = {}) {
  const module = await Test.createTestingModule({
    providers: [
      DictionaryService,
      { provide: getRepositoryToken(Word), useValue: emptyRepo() },
      { provide: getRepositoryToken(Pronunciation), useValue: emptyRepo() },
      { provide: getRepositoryToken(Definition), useValue: emptyRepo() },
      { provide: getRepositoryToken(Example), useValue: emptyRepo() },
      { provide: getRepositoryToken(WordForm), useValue: emptyRepo() },
      { provide: getRepositoryToken(Synonym), useValue: emptyRepo() },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({ 'llm.enableFallback': true, ...overrides.config } as Record<string, unknown>)[key],
        },
      },
      {
        provide: HttpService,
        useValue: { get: jest.fn(), post: jest.fn(), ...overrides.httpService },
      },
      {
        provide: LlmService,
        useValue: {
          lookupDictionaryWord: jest.fn(),
          translate: jest.fn(),
          ...overrides.llmService,
        },
      },
      { provide: AudioService, useValue: { getAudioUrl: jest.fn().mockResolvedValue(null) } },
      { provide: SearchIndexService, useValue: { searchWords: jest.fn().mockResolvedValue([]) } },
      {
        provide: RedisCacheService,
        useValue: {
          // Pass-through cache: just execute the factory each time
          getOrSet: jest.fn(async (_key: string, factory: () => Promise<unknown>) => factory()),
          getWordDetailTTL: jest.fn().mockReturnValue(60),
        },
      },
    ],
  }).compile();
  return module.get(DictionaryService);
}

describe('DictionaryService.lookupWord — LLM path', () => {
  it('delegates to LlmService.lookupDictionaryWord and returns its result', async () => {
    const fakeEntry = {
      word: 'serendipity',
      pronunciations: [],
      definitions: [],
      word_forms: {},
      synonyms: [],
    };
    const llmService = { lookupDictionaryWord: jest.fn().mockResolvedValue(fakeEntry) };
    const svc = await buildModule({ llmService });
    const result = await svc.lookupWord('serendipity');
    expect(llmService.lookupDictionaryWord).toHaveBeenCalledWith('serendipity');
    expect(result).toEqual(fakeEntry);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- dictionary.service.spec`
Expected: test fails because `lookupWord` → `generateWordWithLLM` still uses the inline vLLM call.

- [ ] **Step 5: Refactor `generateWordWithLLM` in `DictionaryService`**

Find the private method `generateWordWithLLM` (around lines 295–380, the one with the Phi-3 prompt and `httpService.post`). Replace its body with a single delegating call:

```ts
private async generateWordWithLLM(
  word: string,
): Promise<LookupWordResponseDto> {
  return this.llmService.lookupDictionaryWord(word);
}
```

Keep the method name `generateWordWithLLM` so the existing caller in `lookupWord` continues to work.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- dictionary.service.spec`
Expected: test passes.

- [ ] **Step 7: Run the build**

Run: `npm run build`
Expected: build succeeds. (Stale `vllmUrl`/`vllmModel` fields and `VLLMCompletionRequest` interface still exist in the file — that's fine; Task 12 removes them.)

- [ ] **Step 8: Commit**

```bash
git add src/dictionary/dictionary.module.ts src/dictionary/dictionary.service.ts src/dictionary/dictionary.service.spec.ts
git commit -m "dictionary: delegate lookupWord LLM call to LlmService"
```

---

## Task 11: TDD `DictionaryService.translate` delegates + MyMemory fallback

**Files:**
- Modify: `src/dictionary/dictionary.service.spec.ts`
- Modify: `src/dictionary/dictionary.service.ts`

- [ ] **Step 1: Write the failing tests**

Append to `dictionary.service.spec.ts`:
```ts
describe('DictionaryService.translate', () => {
  it('returns LlmService.translate result on success', async () => {
    const llmService = {
      translate: jest.fn().mockResolvedValue({
        original_text: 'Hello',
        translated_text: 'Xin chào',
        source_lang: 'en',
        target_lang: 'vi',
      }),
    };
    const svc = await buildModule({ llmService });
    const result = await svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    });
    expect(result.translated_text).toBe('Xin chào');
    expect(llmService.translate).toHaveBeenCalled();
  });

  it('falls back to MyMemory when LlmService.translate throws', async () => {
    const llmService = {
      translate: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const httpService = {
      get: jest.fn().mockReturnValue(
        of({
          data: { responseData: { translatedText: 'Xin chào (mm)' } },
        }),
      ),
    };
    const svc = await buildModule({ llmService, httpService });
    const result = await svc.translate({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'vi',
    });
    expect(result.translated_text).toBe('Xin chào (mm)');
    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining('api.mymemory.translated.net'),
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- dictionary.service.spec`
Expected: 2 new tests fail.

- [ ] **Step 3: Refactor `DictionaryService.translate`**

In `dictionary.service.ts`, replace the `async translate(dto: TranslateDto)` method body with:

```ts
async translate(dto: TranslateDto): Promise<TranslateResponseDto> {
  try {
    return await this.llmService.translate(dto);
  } catch (llmError) {
    this.logger.warn(
      `LLM translation failed, using MyMemory fallback: ${(llmError as Error).message}`,
    );
    const langPair = `${dto.source_lang}|${dto.target_lang}`;
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(dto.text)}&langpair=${langPair}`;
    const fallbackResponse = await firstValueFrom(
      this.httpService.get(myMemoryUrl, { timeout: 10000 }),
    );
    if (fallbackResponse.data && fallbackResponse.data.responseData) {
      return {
        original_text: dto.text,
        translated_text: fallbackResponse.data.responseData.translatedText,
        source_lang: dto.source_lang,
        target_lang: dto.target_lang,
      };
    }
    throw new HttpException(
      'Translation failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

(Keep `import { firstValueFrom } from 'rxjs';` and `HttpService` injection — both are still used by the MyMemory fallback.)

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test -- dictionary.service.spec`
Expected: 3 tests pass total in this file.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all 21 tests pass (18 LLM + 3 Dictionary).

- [ ] **Step 6: Commit**

```bash
git add src/dictionary/dictionary.service.ts src/dictionary/dictionary.service.spec.ts
git commit -m "dictionary: delegate translate to LlmService, keep MyMemory fallback"
```

---

## Task 12: Clean up `DictionaryService` (remove vLLM types/fields)

**Files:**
- Modify: `src/dictionary/dictionary.service.ts`

Now that nothing in `DictionaryService` calls vLLM directly, remove the leftover dead code.

- [ ] **Step 1: Delete dead interfaces**

In `dictionary.service.ts`, delete the `VLLMCompletionRequest` and `VLLMCompletionResponse` interface declarations near the top of the file.

- [ ] **Step 2: Delete dead fields**

Delete the `private readonly vllmUrl: string;` and `private readonly vllmModel: string;` fields.

- [ ] **Step 3: Delete their assignments in the constructor**

Remove the two lines:
```ts
this.vllmUrl = this.configService.get<string>('llm.url');
this.vllmModel = this.configService.get<string>('llm.model');
```

And remove the `Dictionary Service initialized with vLLM URL: ...` log line (or update it to reference `LlmService`).

- [ ] **Step 4: Verify no remaining vLLM references**

Run: `grep -n "vllm\|VLLM" src/dictionary/dictionary.service.ts`
Expected: no output (or only references inside comments you choose to keep — preferably none).

- [ ] **Step 5: Run the build and tests**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/dictionary/dictionary.service.ts
git commit -m "dictionary: remove dead vLLM interfaces and fields"
```

---

## Task 13: Add opt-in smoke test

**Files:**
- Create: `src/llm/llm.smoke.spec.ts`

- [ ] **Step 1: Create the smoke test**

Create `src/llm/llm.smoke.spec.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

const skip = !process.env.LLM_SMOKE;

(skip ? describe.skip : describe)('LlmService smoke (real OpenRouter)', () => {
  it('returns non-empty text from a real chat call', async () => {
    const config = {
      get: (key: string) =>
        ({
          'llm.apiKey': process.env.LLM_API_KEY,
          'llm.baseUrl': process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
          'llm.model': process.env.LLM_MODEL ?? 'openai/gpt-4o-mini',
          'llm.appTitle': 'english-learning-api-smoke',
        } as Record<string, unknown>)[key],
    } as unknown as ConfigService;
    const svc = new LlmService(config);
    const result = await svc.chatWithUser({
      message: 'Say the word "ok" and nothing else.',
      temperature: 0,
      maxTokens: 10,
    });
    expect(result.response.length).toBeGreaterThan(0);
  }, 30000);
});
```

- [ ] **Step 2: Verify the smoke test is skipped by default**

Run: `npm test -- llm.smoke.spec`
Expected: 1 skipped, 0 failures.

- [ ] **Step 3: (Optional) Run the smoke test manually**

Only if you have an OpenRouter key handy:
```bash
LLM_SMOKE=1 LLM_API_KEY=sk-or-... npm test -- llm.smoke.spec
```
Expected: 1 passed (real network call).

- [ ] **Step 4: Commit**

```bash
git add src/llm/llm.smoke.spec.ts
git commit -m "llm: add opt-in smoke test against real OpenRouter"
```

---

## Task 14: Docs touch-ups

**Files:**
- Modify: `README.md`
- Modify: `DICTIONARY_SETUP.md` (if it mentions VLLM_URL / VLLM_MODEL)
- Modify: `IMPLEMENTATION_GUIDE.md` (if it mentions VLLM_URL / VLLM_MODEL)

- [ ] **Step 1: Find vLLM references in docs**

Run:
```bash
grep -rln 'VLLM\|vLLM\|vllm' --include='*.md' .
```

- [ ] **Step 2: Update each match**

For each matched file:
- Replace "vLLM" with "OpenRouter / any OpenAI-compatible provider" where it describes the LLM backend.
- Replace `VLLM_URL` with `LLM_BASE_URL`.
- Replace `VLLM_MODEL` with `LLM_MODEL`.
- Add a note pointing to `.env.example` for the new env-var set.

If a file has no operationally relevant vLLM content (e.g., a historical summary), leave it.

- [ ] **Step 3: Run the build to ensure nothing else broke**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md DICTIONARY_SETUP.md IMPLEMENTATION_GUIDE.md
git commit -m "docs: update vLLM references to OpenRouter / LLM_* env vars"
```

(If only some of those files changed, stage only the ones that did.)

---

## Task 15: Manual verification (no commit)

Boots a local server with a real `LLM_API_KEY` and exercises each affected endpoint to confirm end-to-end behavior.

- [ ] **Step 1: Set up local env**

Add to your local `.env`:
```
LLM_API_KEY=sk-or-...                            # your OpenRouter key
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
LLM_APP_TITLE=english-learning-api
LLM_FALLBACK_ENABLED=true
```
Remove the old `VLLM_URL` and `VLLM_MODEL` lines if present.

- [ ] **Step 2: Start the server**

Run: `npm run start:dev`
Expected: server starts; log line "LLM Service initialized (baseURL=https://openrouter.ai/api/v1, model=openai/gpt-4o-mini)".

If `LLM_API_KEY` is empty, the server should fail to start with `LLM_API_KEY is required but not set`. Verify this once by temporarily unsetting the key, then restore it.

- [ ] **Step 3: Health check**

Run: `curl -s localhost:7474/llm/health`
Expected: `{"status":"healthy","model":"openai/gpt-4o-mini","url":"https://openrouter.ai/api/v1"}` (or your configured values).

- [ ] **Step 4: Generate sentences**

Run:
```bash
curl -s -X POST localhost:7474/llm/generate-sentences \
  -H 'Content-Type: application/json' \
  -d '{"words":["ephemeral","ubiquitous","serendipity"],"numSentences":3,"difficulty":"intermediate","temperature":0.7}'
```
Expected: JSON `{ "sentences": [3 plausible English sentences], "wordsUsed": [...] }`.

- [ ] **Step 5: Chat**

Run:
```bash
curl -s -X POST localhost:7474/llm/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is a gerund?","temperature":0.7,"maxTokens":200}'
```
Expected: JSON `{ "response": "<coherent reply>" }`.

- [ ] **Step 6: Dictionary lookup (LLM fallback path)**

Pick a word unlikely to be in the DB (or one you know triggers the LLM fallback). Run:
```bash
curl -s localhost:7474/dictionary/lookup/serendipity
```
Expected: a populated dictionary entry with pronunciations, definitions, examples, Vietnamese translations.

- [ ] **Step 7: Translate (happy path)**

Run:
```bash
curl -s -X POST localhost:7474/dictionary/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, how are you?","source_lang":"en","target_lang":"vi"}'
```
Expected: JSON with `translated_text` containing a Vietnamese translation.

- [ ] **Step 8: Translate (MyMemory fallback path)**

Temporarily corrupt the API key in `.env` (e.g., add a `x` to the end), restart the server, and re-run the translate curl from Step 7.
Expected: still returns a Vietnamese translation (sourced from MyMemory); server logs include `LLM translation failed, using MyMemory fallback: ...`.

Restore the correct key afterward.

- [ ] **Step 9: Stop the server**

`Ctrl-C` the dev server.

If any step fails, file the issue and resolve before declaring this plan complete.
