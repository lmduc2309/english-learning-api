const DEFAULT_API_URL = 'http://113.160.225.76:8558/serious/llm/chat';

interface LocalLlmResponse {
  response: string;
}

export class LocalLlmClient {
  private apiUrl: string;
  private requestCount = 0;

  constructor(apiUrl: string = DEFAULT_API_URL) {
    this.apiUrl = apiUrl;
  }

  async translate(prompt: string, maxTokens = 2000): Promise<string> {
    const body = {
      message: prompt,
      temperature: 0.3,
      maxTokens,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        const data: LocalLlmResponse = await response.json();
        this.requestCount++;
        return data.response;
      } catch (error: any) {
        lastError = error;
        if (attempt < 3) {
          const waitMs = attempt * 3000;
          console.log(`  ⚠️ Attempt ${attempt} failed: ${error.message}. Retrying in ${waitMs / 1000}s...`);
          await sleep(waitMs);
        }
      }
    }

    throw lastError || new Error('Translation failed after all retries');
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
