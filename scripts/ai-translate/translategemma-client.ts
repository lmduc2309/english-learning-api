/**
 * Talks to a local TranslateGemma server (llama.cpp or MLX) over its raw
 * completion endpoint.
 *
 * Deliberately NOT /v1/chat/completions: that path strips TranslateGemma's
 * source_lang_code / target_lang_code fields and the model silently translates
 * English to English (ggml-org/llama.cpp#19295). The prompt is rendered here
 * from an extracted descriptor instead — see render-prompt.ts.
 */

import { PromptDescriptor, renderPrompt } from './render-prompt';

export interface CompletionResult {
  text: string;
  confidence: number | null;
}

export interface TranslateGemmaClientOptions {
  serverUrl: string;
  descriptor: PromptDescriptor;
  /**
   * llama.cpp serves '/completion'; mlx_lm.server serves the OpenAI-compatible
   * '/v1/completions'. Phase 0 benchmarks both, so the path is configurable.
   */
  completionPath?: string;
  /** Total attempts per item, including the first. */
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_COMPLETION_PATH = '/completion';
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 512;

/** Rough char-per-token ratio for English; only used to cap generation length. */
const CHARS_PER_TOKEN = 4;

export class TranslateGemmaClient {
  private readonly serverUrl: string;
  private readonly descriptor: PromptDescriptor;
  private readonly completionPath: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private requestCount = 0;

  constructor(options: TranslateGemmaClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.descriptor = options.descriptor;
    this.completionPath = options.completionPath ?? DEFAULT_COMPLETION_PATH;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async translate(text: string): Promise<CompletionResult> {
    const prompt = renderPrompt(this.descriptor, text);
    const limit = maxOutputTokens(text);
    const body = {
      prompt,
      temperature: 0,
      stop: ['<end_of_turn>'],
      // llama.cpp reads n_predict/n_probs; the OpenAI-shaped API reads
      // max_tokens. Sending both keeps one body valid for either runtime.
      n_predict: limit,
      max_tokens: limit,
      n_probs: 1,
      cache_prompt: true,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(`${this.serverUrl}${this.completionPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`HTTP ${response.status}: ${detail.slice(0, 200)}`);
        }

        const data = (await response.json()) as CompletionResponse;
        const text = extractText(data);

        if (text === null) {
          throw new Error(
            `response carried no translation text: ${JSON.stringify(data).slice(0, 200)}`,
          );
        }

        this.requestCount++;

        return {
          text: text.trim(),
          confidence: meanLogprobToConfidence(data.completion_probabilities),
        };
      } catch (error: any) {
        lastError = error;
        if (attempt < this.retries) {
          await sleep(this.retryDelayMs * attempt);
        }
      }
    }

    throw lastError || new Error('translation failed after all retries');
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

interface CompletionResponse {
  /** llama.cpp /completion */
  content?: string;
  /** OpenAI-compatible /v1/completions, as served by mlx_lm */
  choices?: { text?: string }[];
  completion_probabilities?: { logprob?: number }[];
}

function extractText(data: CompletionResponse): string | null {
  if (typeof data.content === 'string') return data.content;
  const choice = data.choices?.[0]?.text;
  if (typeof choice === 'string') return choice;
  return null;
}

function maxOutputTokens(text: string): number {
  const estimatedInputTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
  return Math.min(MAX_OUTPUT_TOKENS, estimatedInputTokens * 2 + 32);
}

function meanLogprobToConfidence(
  probabilities?: { logprob?: number }[],
): number | null {
  if (!probabilities || probabilities.length === 0) return null;

  const logprobs = probabilities
    .map((p) => p.logprob)
    .filter((l): l is number => typeof l === 'number');

  if (logprobs.length === 0) return null;

  const mean = logprobs.reduce((sum, l) => sum + l, 0) / logprobs.length;
  return Math.min(1, Math.max(0, Math.exp(mean)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
