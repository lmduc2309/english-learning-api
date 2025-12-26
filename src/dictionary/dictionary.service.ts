import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import {
  SearchWordDto,
  SearchWordResponseDto,
} from './dto/search-word.dto';
import { LookupWordResponseDto } from './dto/lookup-word.dto';
import { TranslateDto, TranslateResponseDto } from './dto/translate.dto';
import { Word } from './entities/word.entity';
import { Pronunciation } from './entities/pronunciation.entity';
import { Definition } from './entities/definition.entity';
import { Example } from './entities/example.entity';
import { WordForm } from './entities/word-form.entity';
import { Synonym } from './entities/synonym.entity';
import { AudioService } from './audio.service';

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
    private audioService: AudioService,
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(Pronunciation)
    private pronunciationRepository: Repository<Pronunciation>,
    @InjectRepository(Definition)
    private definitionRepository: Repository<Definition>,
    @InjectRepository(Example)
    private exampleRepository: Repository<Example>,
    @InjectRepository(WordForm)
    private wordFormRepository: Repository<WordForm>,
    @InjectRepository(Synonym)
    private synonymRepository: Repository<Synonym>,
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

      // First try to search from database
      const dbWords = await this.wordRepository
        .createQueryBuilder('word')
        .where('word.word_normalized LIKE :query', { query: `${query}%` })
        .orWhere('word.word LIKE :query', { query: `${query}%` })
        .orderBy('word.frequency_rank', 'ASC', 'NULLS LAST')
        .limit(limit)
        .getMany();

      if (dbWords.length > 0) {
        return { suggestions: dbWords.map((w) => w.word) };
      }

      // Fallback to common words if no database results
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
      const normalizedWord = word.toLowerCase().trim();

      // Try to find word in database first
      const dbWord = await this.findWordInDatabase(normalizedWord);
      if (dbWord) {
        this.logger.log(`Found word "${word}" in database`);
        return dbWord;
      }

      // Fallback to LLM generation if not in database
      this.logger.log(`Word "${word}" not in database, generating with LLM`);
      return await this.generateWordWithLLM(normalizedWord);
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

  /**
   * Find word in database with all related data
   */
  private async findWordInDatabase(
    word: string,
  ): Promise<LookupWordResponseDto | null> {
    const wordEntity = await this.wordRepository.findOne({
      where: [
        { word: word },
        { wordNormalized: word },
      ],
      relations: ['pronunciations', 'definitions', 'definitions.examples', 'wordForms'],
    });

    if (!wordEntity) {
      return null;
    }

    // Fetch audio URLs if not already stored
    const pronunciationsWithAudio = await Promise.all(
      wordEntity.pronunciations.map(async (p) => {
        if (!p.audioUrl) {
          // Try to fetch audio URL
          const audioUrl = await this.audioService.getAudioUrl(
            word,
            p.accent as 'US' | 'UK',
          );
          
          // Update database if audio found
          if (audioUrl) {
            await this.pronunciationRepository.update(p.id, { audioUrl });
            p.audioUrl = audioUrl;
          }
        }
        
        return {
          accent: p.accent,
          ipa: p.ipa,
          audio_url: p.audioUrl,
        };
      }),
    );

    // Fetch synonyms
    const synonyms = await this.synonymRepository.find({
      where: { wordId: wordEntity.id },
    });

    // Build word forms object
    const wordFormsObj: Record<string, string> = {};
    for (const form of wordEntity.wordForms || []) {
      wordFormsObj[form.formType] = form.formWord;
    }

    return {
      word: wordEntity.word,
      pronunciations: pronunciationsWithAudio,
      definitions: wordEntity.definitions
        .sort((a, b) => a.definitionOrder - b.definitionOrder)
        .map((def) => ({
          pos: def.partOfSpeech,
          definition_en: def.definitionEn,
          definition_vi: def.definitionVi,
          level: def.level,
          examples: def.examples.map((ex) => ({
            en: ex.exampleEn,
            vi: ex.exampleVi,
          })),
        })),
      word_forms: Object.keys(wordFormsObj).length > 0 ? wordFormsObj : undefined,
      synonyms: synonyms.length > 0 ? synonyms.map((s) => s.synonymWord) : undefined,
      frequency_rank: wordEntity.frequencyRank,
    };
  }

  /**
   * Generate word data using LLM
   */
  private async generateWordWithLLM(
    word: string,
  ): Promise<LookupWordResponseDto> {
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
        `Error generating word "${word}" with LLM: ${error.message}`,
        error.stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to generate word data: ${error.message}`,
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

  /**
   * Import word data into database
   * Used by admin import script
   */
  async importWordData(data: any): Promise<{ success: boolean; word: string }> {
    try {
      const {
        word,
        word_normalized,
        language,
        frequency_rank,
        pronunciations,
        definitions,
        synonyms,
        word_forms,
      } = data;

      // Check if word already exists
      let wordEntity = await this.wordRepository.findOne({
        where: { word },
      });

      if (!wordEntity) {
        // Create new word
        wordEntity = this.wordRepository.create({
          word,
          wordNormalized: word_normalized || word.toLowerCase(),
          language: language || 'en',
          frequencyRank: frequency_rank,
          partOfSpeech: definitions?.map((d: any) => d.pos) || [],
        });
        await this.wordRepository.save(wordEntity);
        this.logger.log(`Created word: ${word}`);
      } else {
        this.logger.log(`Word already exists: ${word}, updating...`);
      }

      // Import pronunciations
      if (pronunciations && pronunciations.length > 0) {
        for (const pron of pronunciations) {
          const existing = await this.pronunciationRepository.findOne({
            where: { wordId: wordEntity.id, accent: pron.accent },
          });

          if (!existing) {
            await this.pronunciationRepository.save({
              wordId: wordEntity.id,
              accent: pron.accent,
              ipa: pron.ipa,
              audioUrl: pron.audio_url,
            });
          }
        }
      }

      // Import definitions
      if (definitions && definitions.length > 0) {
        for (let i = 0; i < definitions.length; i++) {
          const def = definitions[i];
          
          const defEntity = this.definitionRepository.create({
            wordId: wordEntity.id,
            partOfSpeech: def.pos,
            definitionEn: def.definition_en,
            definitionVi: def.definition_vi,
            level: def.level || 'intermediate',
            definitionOrder: i + 1,
          });
          await this.definitionRepository.save(defEntity);

          // Import examples for this definition
          if (def.examples && def.examples.length > 0) {
            for (const ex of def.examples) {
              await this.exampleRepository.save({
                definitionId: defEntity.id,
                exampleEn: ex.en,
                exampleVi: ex.vi,
              });
            }
          }
        }
      }

      // Import word forms
      if (word_forms) {
        for (const [formType, formWord] of Object.entries(word_forms)) {
          const existing = await this.wordFormRepository.findOne({
            where: { wordId: wordEntity.id, formType },
          });

          if (!existing) {
            await this.wordFormRepository.save({
              wordId: wordEntity.id,
              formType,
              formWord: formWord as string,
            });
          }
        }
      }

      // Import synonyms
      if (synonyms && synonyms.length > 0) {
        for (const syn of synonyms) {
          const existing = await this.synonymRepository.findOne({
            where: { wordId: wordEntity.id, synonymWord: syn },
          });

          if (!existing) {
            await this.synonymRepository.save({
              wordId: wordEntity.id,
              synonymWord: syn,
            });
          }
        }
      }

      this.logger.log(`Successfully imported word: ${word}`);
      return { success: true, word };
    } catch (error) {
      this.logger.error(`Failed to import word: ${error.message}`, error.stack);
      throw new HttpException(
        `Failed to import word: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get audio URL for a specific word and accent
   */
  async getWordAudio(
    word: string,
    accent: 'US' | 'UK',
  ): Promise<{ audio_url: string | null }> {
    try {
      // First check database
      const wordEntity = await this.wordRepository.findOne({
        where: [{ word }, { wordNormalized: word.toLowerCase() }],
        relations: ['pronunciations'],
      });

      if (wordEntity) {
        const pronunciation = wordEntity.pronunciations.find(
          (p) => p.accent === accent,
        );

        if (pronunciation?.audioUrl) {
          return { audio_url: pronunciation.audioUrl };
        }
      }

      // Fallback to fetching from external API
      const audioUrl = await this.audioService.getAudioUrl(word, accent);
      return { audio_url: audioUrl };
    } catch (error) {
      this.logger.error(
        `Failed to get audio for "${word}" (${accent}): ${error.message}`,
      );
      return { audio_url: null };
    }
  }
}

