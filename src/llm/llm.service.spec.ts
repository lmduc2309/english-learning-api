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
