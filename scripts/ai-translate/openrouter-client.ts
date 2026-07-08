import { config } from './config';
import type { OpenRouterRequest, OpenRouterResponse } from './types';

export class OpenRouterClient {
  private requestTimestamps: number[] = [];
  private dailyCount = 0;

  async translate(messages: OpenRouterRequest['messages']): Promise<string> {
    await this.enforceRateLimit();

    const body: OpenRouterRequest = {
      model: config.openRouter.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.openRouter.maxRetries; attempt++) {
      try {
        const response = await fetch(config.openRouter.baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.openRouter.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/english-learning-api',
            'X-Title': 'English Learning API - Vietnamese Translation',
          },
          signal: AbortSignal.timeout(config.openRouter.timeout),
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
          console.log(`  ⏳ Rate limited, waiting ${retryAfter}s (attempt ${attempt})...`);
          await sleep(retryAfter * 1000);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data: OpenRouterResponse = await response.json();

        if (data.error) {
          throw new Error(`API Error: ${data.error.message}`);
        }

        if (!data.choices?.[0]?.message?.content) {
          throw new Error('Empty response from API');
        }

        this.dailyCount++;
        return data.choices[0].message.content;
      } catch (error: any) {
        lastError = error;
        if (attempt < config.openRouter.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          console.log(`  ⚠️ Attempt ${attempt} failed: ${error.message}. Retrying in ${backoff / 1000}s...`);
          await sleep(backoff);
        }
      }
    }

    throw lastError || new Error('Translation failed after all retries');
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60_000;

    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < windowMs);

    // Wait if at RPM limit
    if (this.requestTimestamps.length >= config.openRouter.maxRPM) {
      const oldestInWindow = this.requestTimestamps[0];
      const waitMs = windowMs - (now - oldestInWindow) + 100;
      if (waitMs > 0) {
        console.log(`  ⏳ Rate limit: waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await sleep(waitMs);
      }
    }

    // Check daily limit
    if (this.dailyCount >= config.openRouter.maxDaily) {
      throw new Error(
        `Daily request limit reached (${config.openRouter.maxDaily}). ` +
          'Resume tomorrow or increase AI_TRANSLATE_MAX_DAILY.',
      );
    }

    this.requestTimestamps.push(Date.now());
  }

  getDailyCount(): number {
    return this.dailyCount;
  }

  resetDailyCount(): void {
    this.dailyCount = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
