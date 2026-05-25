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
