import { Injectable, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
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
    @Optional() openaiOverride?: OpenAI,
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

  async chatWithUser(dto: ChatDto): Promise<ChatResponseDto> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a helpful English teacher assistant. Answer questions about English grammar, vocabulary, and usage.',
      },
      { role: 'user', content: dto.message },
    ];
    const text = await this.chat(messages, {
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
    });
    return { response: text };
  }

  async lookupDictionaryWord(word: string): Promise<LookupWordResponseDto> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are an English-Vietnamese dictionary. Provide comprehensive dictionary information in JSON format.',
      },
      {
        role: 'user',
        content: `Provide a complete dictionary entry for the English word "${word}" with Vietnamese translations.

Return ONLY valid JSON in this exact format:
{
  "word": "${word}",
  "pronunciations": [
    {"accent": "US", "ipa": "/pronunciation/"},
    {"accent": "UK", "ipa": "/pronunciation/"}
  ],
  "definitions": [
    {
      "pos": "part of speech",
      "definition_en": "English definition",
      "definition_vi": "Vietnamese translation",
      "level": "beginner/intermediate/advanced",
      "examples": [
        {"en": "English example", "vi": "Vietnamese example"}
      ]
    }
  ],
  "word_forms": {"plural": "...", "past": "...", "present": "..."},
  "synonyms": ["synonym1", "synonym2"]
}`,
      },
    ];
    const text = await this.chat(messages, {
      temperature: 0.3,
      maxTokens: 1500,
      responseFormat: { type: 'json_object' },
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException(
        'Failed to parse dictionary data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return JSON.parse(jsonMatch[0]) as LookupWordResponseDto;
  }

  async translate(dto: TranslateDto): Promise<TranslateResponseDto> {
    const languageNames: Record<string, string> = {
      en: 'English',
      vi: 'Vietnamese',
      'zh-cn': 'Chinese',
      es: 'Spanish',
      hi: 'Hindi',
      bn: 'Bengali',
      pt: 'Portuguese',
      ru: 'Russian',
      ja: 'Japanese',
      ko: 'Korean',
      fr: 'French',
    };
    const sourceLangName = languageNames[dto.source_lang] ?? dto.source_lang;
    const targetLangName = languageNames[dto.target_lang] ?? dto.target_lang;
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a professional translator. Translate accurately and naturally.',
      },
      {
        role: 'user',
        content: `Translate the following text from ${sourceLangName} to ${targetLangName}.
Output ONLY the translation, nothing else.

Text: ${dto.text}`,
      },
    ];
    const translatedText = await this.chat(messages, {
      temperature: 0.3,
      maxTokens: 500,
      timeoutMs: 5000,
    });
    return {
      original_text: dto.text,
      translated_text: translatedText,
      source_lang: dto.source_lang,
      target_lang: dto.target_lang,
    };
  }

  async generateVietnameseSentences(
    words: string[],
    numSentences: number,
    difficulty: 'beginner' | 'intermediate' | 'advanced',
  ): Promise<Array<{ vi: string; words: string[] }>> {
    const wordsStr = words.join(', ');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a Vietnamese teacher creating natural Vietnamese sentences for English learners. You write ONLY in Vietnamese — never mix English words into the Vietnamese sentence.',
      },
      {
        role: 'user',
        content: `Generate ${numSentences} natural, fully Vietnamese sentences that a learner will translate back to English.

CRITICAL RULES:
- Each sentence MUST be 100% Vietnamese. Do NOT include any English words in the "vi" field.
- The Vietnamese sentence should express the MEANING (translation) of the target English words, so the learner is prompted to recall and speak those English words when translating.
- Naturally combine MULTIPLE target words into the same sentence whenever it reads well.
- Vary which words appear in each sentence so the full session covers all the target words.
- Match difficulty: ${difficulty} (beginner=simple grammar, intermediate=natural everyday, advanced=sophisticated).

Target English words (use their Vietnamese meanings in the sentences, NOT the English words themselves):
${wordsStr}

Return ONLY valid JSON in this exact format. The "words" array lists which English target words this sentence is testing:
{
  "sentences": [
    { "vi": "<sentence written only in Vietnamese>", "words": ["<english target word(s) this sentence tests>"] }
  ]
}`,
      },
    ];
    const text = await this.chat(messages, {
      temperature: 0.7,
      maxTokens: 80 * numSentences,
      responseFormat: { type: 'json_object' },
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException(
        'Failed to generate Vietnamese sentences',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    let parsed: { sentences?: Array<{ vi: string; words: string[] }> };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new HttpException(
        'Failed to generate Vietnamese sentences',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!parsed.sentences || !Array.isArray(parsed.sentences) || parsed.sentences.length === 0) {
      throw new HttpException(
        'Failed to generate Vietnamese sentences',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return parsed.sentences;
  }

  async gradeSpokenAnswer(input: {
    vietnamese: string;
    userTranscript: string;
    words: string[];
  }): Promise<{
    verdict: 'correct' | 'partial' | 'incorrect';
    score: number;
    feedback: string;
    suggestedAnswer: string;
  }> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are an English teacher grading a learner\'s spoken English translation of a Vietnamese sentence. Be encouraging but honest.',
      },
      {
        role: 'user',
        content: `Vietnamese sentence: "${input.vietnamese}"
Target English words to demonstrate: ${input.words.join(', ')}
Learner's spoken English: "${input.userTranscript}"

Grade the learner. Return ONLY valid JSON in this exact format:
{
  "verdict": "correct" | "partial" | "incorrect",
  "score": <integer 0-100>,
  "feedback": "<one short sentence of feedback>",
  "suggestedAnswer": "<one good English sentence that translates the Vietnamese>"
}`,
      },
    ];
    const text = await this.chat(messages, {
      temperature: 0.2,
      maxTokens: 300,
      responseFormat: { type: 'json_object' },
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new HttpException(
        'Failed to grade answer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    let parsed: {
      verdict?: 'correct' | 'partial' | 'incorrect';
      score?: number;
      feedback?: string;
      suggestedAnswer?: string;
    };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new HttpException(
        'Failed to grade answer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (
      !parsed.verdict ||
      !['correct', 'partial', 'incorrect'].includes(parsed.verdict) ||
      typeof parsed.score !== 'number' ||
      typeof parsed.feedback !== 'string' ||
      typeof parsed.suggestedAnswer !== 'string'
    ) {
      throw new HttpException(
        'Failed to grade answer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return {
      verdict: parsed.verdict,
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      feedback: parsed.feedback,
      suggestedAnswer: parsed.suggestedAnswer,
    };
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
