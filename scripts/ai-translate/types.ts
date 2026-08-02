export interface TranslationItem {
  id: number;
  word: string;
  pos: string;
  en: string;
}

export interface TranslationResult {
  id: number;
  vi: string;
}

export interface ExampleItem {
  id: number;
  word: string;
  en: string;
}

export interface ExampleResult {
  id: number;
  vi: string;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
  stop?: string[];
}

export interface OpenRouterChoice {
  message: {
    role: string;
    content: string;
    reasoning_details?: any;
  };
  finish_reason: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    code: number;
  };
}

export interface BatchResult {
  batchId: number;
  total: number;
  success: number;
  failed: number;
  translations: TranslationResult[];
}

export interface RunStats {
  totalToTranslate: number;
  alreadyDone: number;
  translated: number;
  failed: number;
  startedAt: Date;
  requestsMade: number;
  /** Rejected model outputs, keyed by validate-output.ts RejectionReason. */
  rejectedByReason: Record<string, number>;
}

export type TranslationType = 'definitions' | 'examples';

export type TranslationTarget = 'null' | 'cjk';

export interface CLIOptions {
  type: TranslationType;
  /** 'null' fills untranslated rows; 'cjk' repairs contaminated ones. */
  target: TranslationTarget;
  limit: number;
  batchSize: number;
  dryRun: boolean;
  word: string | null;
  showStats: boolean;
  reset: boolean;
}
