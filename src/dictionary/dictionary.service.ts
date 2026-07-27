import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
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
import { SearchIndexService } from '../common/search/search-index.service';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import { LlmService } from '../llm/llm.service';
import { LearnerEntry } from './entities/learner-entry.entity';
import { LearnerSenseTranslation } from './entities/learner-sense-translation.entity';
import {
  rankVietnameseGlosses,
  normalizeVietnameseSearch,
  VietnameseGlossMatch,
} from './vietnamese-gloss-search';
import {
  presentLearnerDefinitions,
  presentLearnerPronunciations,
  presentRawDefinitions,
} from './dictionary-presenter';

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);
  private readonly llmFallbackEnabled: boolean;

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
    private searchIndexService: SearchIndexService,
    private cacheService: RedisCacheService,
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
    @InjectRepository(LearnerEntry)
    private learnerEntryRepository: Repository<LearnerEntry>,
    @InjectRepository(LearnerSenseTranslation)
    private learnerTranslationRepository: Repository<LearnerSenseTranslation>,
    private llmService: LlmService,
  ) {
    this.llmFallbackEnabled = this.configService.get<boolean>('llm.enableFallback');
    this.logger.log(
      `LLM fallback ${this.llmFallbackEnabled ? 'enabled' : 'disabled'}`,
    );
  }

  async searchWords(dto: SearchWordDto): Promise<SearchWordResponseDto> {
    try {
      const query = dto.q.toLowerCase();
      const limit = dto.limit || 15;
      const cacheKey = `search:${query}:${limit}`;

      // Try Redis cache first
      return await this.cacheService.getOrSet(
        cacheKey,
        async () => {
          // Use B+ tree search index for optimized prefix search
          const results = await this.searchIndexService.searchWords(query, limit);

          if (results.length > 0) {
            // Fetch detailed information for each word
            const suggestions = await Promise.all(
              results.map(async (r) => {
                const wordDetails = await this.wordRepository.findOne({
                  where: { word: r.word },
                  relations: ['pronunciations', 'definitions'],
                });

                if (wordDetails) {
                  // Get first US pronunciation
                  const pronunciation = wordDetails.pronunciations?.find(
                    (p) => p.accent === 'US',
                  ) || wordDetails.pronunciations?.[0];

                  // Get first definition's POS
                  const pos = wordDetails.definitions?.[0]?.partOfSpeech;

                  return {
                    word: wordDetails.word,
                    ipa: pronunciation?.ipa,
                    pos: pos,
                  };
                }

                return { word: r.word! };
              }),
            );

            return {
              suggestions,
              count: suggestions.length,
            };
          }

          // Fallback to common words if no results
          const suggestions = this.commonWords
            .filter((word) => word.startsWith(query))
            .slice(0, limit)
            .map((word) => ({ word }));

          return { suggestions, count: suggestions.length };
        },
        {
          prefix: 'dict',
          ttl: this.cacheService.getSearchTTL(),
        },
      );
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
      const cacheKey = `word:${normalizedWord}`;

      // Try Redis cache first
      return await this.cacheService.getOrSet(
        cacheKey,
        async () => {
          // Try to find word in database first
          const dbWord = await this.findWordInDatabase(normalizedWord);
          if (dbWord) {
            this.logger.log(`Found word "${word}" in database`);
            return dbWord;
          }

          // Check if LLM fallback is enabled
          if (!this.llmFallbackEnabled) {
            this.logger.warn(`Word "${word}" not found in database and LLM fallback is disabled`);
            throw new HttpException(
              `Word "${word}" not found in dictionary`,
              HttpStatus.NOT_FOUND,
            );
          }

          // Fallback to LLM generation if not in database and fallback is enabled
          this.logger.log(`Word "${word}" not in database, generating with LLM`);
          return await this.generateWordWithLLM(normalizedWord);
        },
        {
          prefix: 'dict',
          ttl: this.cacheService.getWordDetailTTL(),
        },
      );
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

  async resolve(query: string, direction: 'auto' | 'en-vi' | 'vi-en') {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
    }

    const hasVietnameseMarks = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(normalizedQuery);
    let detectedDirection: 'en-vi' | 'vi-en';
    let matches: VietnameseGlossMatch[] = [];
    if (direction === 'auto') {
      if (hasVietnameseMarks) {
        detectedDirection = 'vi-en';
      } else {
        const englishHeadword = await this.wordRepository.findOne({
          where: [
            { word: normalizedQuery.toLowerCase() },
            { wordNormalized: normalizedQuery.toLowerCase() },
          ],
        });
        if (englishHeadword) {
          detectedDirection = 'en-vi';
        } else {
          matches = await this.searchVietnameseGlosses(normalizedQuery);
          detectedDirection = matches.length ? 'vi-en' : 'en-vi';
        }
      }
    } else {
      detectedDirection = direction;
    }

    if (detectedDirection === 'en-vi') {
      return {
        kind: 'dictionary' as const,
        direction: detectedDirection,
        query: normalizedQuery,
        entry: await this.lookupWord(normalizedQuery),
      };
    }

    if (!matches.length) matches = await this.searchVietnameseGlosses(normalizedQuery);
    const translation = matches.length
      ? {
          original_text: normalizedQuery,
          translated_text: [...new Set(matches.map((match) => match.word))].join(', '),
          source_lang: 'vi',
          target_lang: 'en',
        }
      : await this.translate({
          text: normalizedQuery,
          source_lang: 'vi',
          target_lang: 'en',
        });
    return {
      kind: 'translation' as const,
      direction: detectedDirection,
      query: normalizedQuery,
      translation,
      matches,
    };
  }

  private async searchVietnameseGlosses(query: string): Promise<VietnameseGlossMatch[]> {
    const normalizedQuery = normalizeVietnameseSearch(query);
    if (!normalizedQuery) return [];
    const translations = await this.learnerTranslationRepository.find({
      where: {
        locale: 'vi',
        reviewStatus: 'approved',
        textNormalized: Like(`%${normalizedQuery}%`),
        sense: {
          status: 'published',
          entry: { status: 'published' },
        },
      },
      relations: {
        sense: {
          entry: { word: true },
          examples: true,
        },
      },
    });

    return rankVietnameseGlosses(query, translations.map((translation) => ({
      word: translation.sense.entry.word.word,
      definitionVi: translation.text,
      definitionEn: translation.sense.definitionEn,
      partOfSpeech: translation.sense.partOfSpeech,
      senseId: translation.sense.id,
      senseOrder: translation.sense.senseOrder,
      learnerRank: translation.sense.entry.learnerRank,
      examples: (translation.sense.examples || [])
        .filter((example) => example.reviewStatus === 'approved')
        .sort((a, b) => a.exampleOrder - b.exampleOrder)
        .map((example) => ({ en: example.exampleEn, vi: example.exampleVi })),
    })));
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

    const learnerEntry = await this.learnerEntryRepository.findOne({
      where: { wordId: wordEntity.id, status: 'published' },
      relations: [
        'senses',
        'senses.translations',
        'senses.examples',
        'pronunciations',
      ],
    });

    // Filter to get only one US and one UK pronunciation
    const uniquePronunciations = [];
    const usPronounciation = (wordEntity.pronunciations || []).find(p => p.accent === 'US');
    const ukPronounciation = (wordEntity.pronunciations || []).find(p => p.accent === 'UK');
    
    if (usPronounciation) uniquePronunciations.push(usPronounciation);
    if (ukPronounciation) uniquePronunciations.push(ukPronounciation);

    // Fetch audio URLs if not already stored
    const pronunciationsWithAudio = await Promise.all(
      uniquePronunciations.map(async (p) => {
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

    const curatedDefinitions = presentLearnerDefinitions(learnerEntry);

    if (learnerEntry && curatedDefinitions.length > 0) {
      return {
        word: wordEntity.word,
        pronunciations: presentLearnerPronunciations(learnerEntry),
        definitions: curatedDefinitions,
        // Forms and synonyms currently exist only in the legacy corpus. Do not
        // mix them into an otherwise curated response until they gain their own
        // provenance/review model.
        word_forms: undefined,
        synonyms: undefined,
        frequency_rank: learnerEntry.learnerRank ?? wordEntity.frequencyRank,
        learner_band: learnerEntry.learnerBand || undefined,
        rank_source: learnerEntry.rankSource || undefined,
        rank_source_version: learnerEntry.rankSourceVersion || undefined,
        rank_source_license: learnerEntry.rankSourceLicense || undefined,
        data_source: 'curated',
      };
    }

    return {
      word: wordEntity.word,
      pronunciations: pronunciationsWithAudio,
      definitions: presentRawDefinitions(wordEntity.definitions),
      word_forms: Object.keys(wordFormsObj).length > 0 ? wordFormsObj : undefined,
      synonyms: synonyms.length > 0 ? synonyms.map((s) => s.synonymWord) : undefined,
      frequency_rank: wordEntity.frequencyRank,
      data_source: 'raw_fallback',
    };
  }

  /**
   * Generate word data using LLM
   */
  private async generateWordWithLLM(
    word: string,
  ): Promise<LookupWordResponseDto> {
    const generated = await this.llmService.lookupDictionaryWord(word);
    return {
      ...generated,
      definitions: (generated.definitions || []).map((definition) => ({
        ...definition,
        data_status: 'generated',
        quality_flags: Array.from(new Set([
          ...(definition.quality_flags || []),
          'generated_fallback',
        ])),
        is_learner_visible: false,
        source: definition.source || 'LLM fallback',
      })),
      data_source: 'generated_fallback',
    };
  }

  async translate(dto: TranslateDto): Promise<TranslateResponseDto> {
    try {
      return await this.llmService.translate(dto);
    } catch (llmError) {
      this.logger.warn(
        `LLM translation failed, using MyMemory fallback: ${(llmError as Error).message}`,
      );
      const langPair = `${dto.source_lang}|${dto.target_lang}`;
      const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(dto.text)}&langpair=${langPair}`;
      const fallbackResponse = await firstValueFrom(
        this.httpService.get(myMemoryUrl, { timeout: 10000 }),
      );
      if (fallbackResponse.data && fallbackResponse.data.responseData) {
        return {
          original_text: dto.text,
          translated_text: fallbackResponse.data.responseData.translatedText,
          source_lang: dto.source_lang,
          target_lang: dto.target_lang,
        };
      }
      throw new HttpException(
        'Translation failed',
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
            reviewStatus: 'raw',
            isLearnerVisible: false,
          });
          await this.definitionRepository.save(defEntity);

          // Import examples for this definition
          if (def.examples && def.examples.length > 0) {
            for (const ex of def.examples) {
              await this.exampleRepository.save({
                definitionId: defEntity.id,
                exampleEn: ex.en,
                exampleVi: ex.vi,
                reviewStatus: 'raw',
                isLearnerVisible: false,
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
