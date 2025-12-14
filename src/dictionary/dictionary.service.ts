import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  SearchWordDto,
  SearchWordResponseDto,
} from './dto/search-word.dto';
import { LookupWordResponseDto } from './dto/lookup-word.dto';
import { TranslateDto, TranslateResponseDto } from './dto/translate.dto';

interface VLLMCompletionRequest {
  model: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
  stop?: string[];
}

interface VLLMCompletionResponse {
  choices: Array<{
    text: string;
    finish_reason: string;
  }>;
}

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);
  private readonly vllmUrl: string;
  private readonly vllmModel: string;

  // Common English words for autocomplete (can be expanded)
  private readonly commonWords = [
    'hello', 'world', 'dictionary', 'learn', 'example', 'language',
    'practice', 'study', 'vocabulary', 'grammar', 'pronunciation',
    'definition', 'translation', 'english', 'vietnamese', 'word',
    'sentence', 'phrase', 'meaning', 'synonym', 'antonym',
    'help', 'helicopter', 'history', 'house', 'home', 'hand',
    'happy', 'hard', 'have', 'heart', 'heavy', 'high', 'hold',
  ];

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.vllmUrl = this.configService.get<string>('llm.url');
    this.vllmModel = this.configService.get<string>('llm.model');
    this.logger.log(
      `Dictionary Service initialized with vLLM URL: ${this.vllmUrl}`,
    );
  }

  async searchWords(dto: SearchWordDto): Promise<SearchWordResponseDto> {
    try {
      const query = dto.q.toLowerCase();
      const limit = dto.limit || 10;

      // Simple autocomplete from common words
      const suggestions = this.commonWords
        .filter((word) => word.startsWith(query))
        .slice(0, limit);

      return { suggestions };
    } catch (error) {
      this.logger.error(
        `Error searching words: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        'Failed to search words',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async lookupWord(word: string): Promise<LookupWordResponseDto> {
    try {
      const prompt = `<|system|>
You are an English-Vietnamese dictionary. Provide comprehensive dictionary information in JSON format.
<|end|>
<|user|>
Provide a complete dictionary entry for the English word "${word}" with Vietnamese translations.

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
}
<|end|>
<|assistant|>
`;

      const vllmRequest: VLLMCompletionRequest = {
        model: this.vllmModel,
        prompt,
        temperature: 0.3,
        max_tokens: 1500,
        stop: ['<|end|>', '<|user|>'],
      };

      this.logger.debug(`Looking up word: ${word}`);

      const response = await firstValueFrom(
        this.httpService.post<VLLMCompletionResponse>(
          this.vllmUrl,
          vllmRequest,
          {
            timeout: 30000,
          },
        ),
      );

      const generatedText = response.data.choices[0].text.trim();
      this.logger.debug(`LLM Response: ${generatedText}`);

      // Parse JSON from response
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new HttpException(
          'Failed to parse dictionary data',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const dictionaryData: LookupWordResponseDto = JSON.parse(jsonMatch[0]);

      return dictionaryData;
    } catch (error) {
      this.logger.error(
        `Error looking up word "${word}": ${error.message}`,
        error.stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to lookup word: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async translate(dto: TranslateDto): Promise<TranslateResponseDto> {
    try {
      const languageNames = {
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

      const sourceLangName =
        languageNames[dto.source_lang] || dto.source_lang;
      const targetLangName =
        languageNames[dto.target_lang] || dto.target_lang;

      const prompt = `<|system|>
You are a professional translator. Translate accurately and naturally.
<|end|>
<|user|>
Translate the following text from ${sourceLangName} to ${targetLangName}.
Output ONLY the translation, nothing else.

Text: ${dto.text}
<|end|>
<|assistant|>
`;

      const vllmRequest: VLLMCompletionRequest = {
        model: this.vllmModel,
        prompt,
        temperature: 0.3,
        max_tokens: 500,
        stop: ['<|end|>', '<|user|>'],
      };

      this.logger.debug(
        `Translating from ${dto.source_lang} to ${dto.target_lang}`,
      );

      const response = await firstValueFrom(
        this.httpService.post<VLLMCompletionResponse>(
          this.vllmUrl,
          vllmRequest,
          {
            timeout: 30000,
          },
        ),
      );

      const translatedText = response.data.choices[0].text.trim();

      return {
        original_text: dto.text,
        translated_text: translatedText,
        source_lang: dto.source_lang,
        target_lang: dto.target_lang,
      };
    } catch (error) {
      this.logger.error(
        `Error translating text: ${error.message}`,
        error.stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to translate text: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async healthCheck(): Promise<{ status: string; service: string }> {
    return {
      status: 'healthy',
      service: 'dictionary',
    };
  }
}
