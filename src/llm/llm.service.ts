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
}
