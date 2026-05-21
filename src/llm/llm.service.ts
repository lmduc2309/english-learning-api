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
