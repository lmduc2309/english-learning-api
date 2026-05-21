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
