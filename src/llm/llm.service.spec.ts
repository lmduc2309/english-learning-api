import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError,
  AuthenticationError,
} from 'openai';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

function makeConfig(values: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

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
