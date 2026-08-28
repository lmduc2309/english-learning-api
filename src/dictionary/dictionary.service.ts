import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
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

interface RawVietnameseDefinitionRow {
  id: string;
  definition_vi: string;
  definition_en: string;
  part_of_speech: string;
  definition_order: number;
  word: string;
  frequency_rank: number | null;
}

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);
  private readonly llmFallbackEnabled: boolean;
  private readonly commercialSafeMode: boolean;
  private readonly allowExternalFallback: boolean;
  private readonly vietnameseSearchEnabled: boolean;

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
    const dataSource =
      this.configService.get<string>('dictionary.dataSource') || 'primary';
    if (dataSource !== 'primary') {
      throw new Error(
        `Unsupported DICTIONARY_DATA_SOURCE "${dataSource}"; expected "primary"`,
      );
    }
    this.llmFallbackEnabled =
      this.configService.get<boolean>('llm.enableFallback') === true
      && this.configService.get<boolean>(
        'dictionary.allowGeneratedFallback',
      ) === true;
    this.allowExternalFallback =
      this.configService.get<boolean>('dictionary.allowExternalFallback') === true;
    this.vietnameseSearchEnabled =
      this.configService.get<boolean>('dictionary.vietnameseSearchEnabled') !== false;
    this.commercialSafeMode =
      this.configService.get<boolean>('content.commercialSafeMode') === true;
    this.logger.log(
      `LLM fallback ${this.llmFallbackEnabled ? 'enabled' : 'disabled'}`,
    );
    this.logger.log(
      `Primary production dictionary enabled; Vietnamese search ${this.vietnameseSearchEnabled ? 'enabled' : 'disabled'}`,
    );
  }

  /** Version the primary-data response shape so old Redis bodies cannot cross
   * a serving-policy or search-schema change. */
  private get corpusTag(): string {
    return 'primary:v1';
  }

  async searchWords(dto: SearchWordDto): Promise<SearchWordResponseDto> {
    try {
      const query = dto.q.toLowerCase().trim();
      const limit = dto.limit || 15;
      const direction = dto.direction || 'auto';
      const cacheKey = `search:${this.corpusTag}:${direction}:${query}:${limit}`;

      // Try Redis cache first
      return await this.cacheService.getOrSet(
        cacheKey,
        async () => {
          const hasVietnameseMarks = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(query);
          const searchEnglish = direction !== 'vi-en' && !hasVietnameseMarks;
          const searchVietnamese =
            this.vietnameseSearchEnabled && direction !== 'en-vi';

          const [englishResults, vietnameseMatches] = await Promise.all([
            searchEnglish
              ? this.searchIndexService.searchWords(query, limit)
              : Promise.resolve([]),
            searchVietnamese
              ? this.searchVietnameseGlosses(query, limit)
              : Promise.resolve([]),
          ]);

          const englishSuggestions: SearchWordResponseDto['suggestions'] = await Promise.all(
            englishResults.map(async (result) => {
              const wordDetails = await this.wordRepository.findOne({
                where: { word: result.word },
                relations: ['pronunciations', 'definitions'],
              });
              const pronunciation = wordDetails?.pronunciations?.find(
                (candidate) => candidate.accent === 'US',
              ) || wordDetails?.pronunciations?.[0];
              return {
                word: wordDetails?.word || result.word!,
                ipa: pronunciation?.ipa,
                pos: wordDetails?.definitions?.[0]?.partOfSpeech,
                direction: 'en-vi' as const,
              };
            }),
          );

          if (searchEnglish && englishSuggestions.length === 0) {
            englishSuggestions.push(
              ...this.commonWords
                .filter((word) => word.startsWith(query))
                .slice(0, limit)
                .map((word) => ({ word, direction: 'en-vi' as const })),
            );
          }

          const vietnameseSuggestions = vietnameseMatches.map((match) => ({
            word: match.word,
            pos: match.part_of_speech,
            direction: 'vi-en' as const,
            matched_text: match.definition_vi,
            definition_vi: match.definition_vi,
            definition_en: match.definition_en,
            data_source: match.data_source,
          }));

          const suggestions = [] as SearchWordResponseDto['suggestions'];
          const seen = new Set<string>();
          for (const suggestion of [...englishSuggestions, ...vietnameseSuggestions]) {
            const key = suggestion.word.toLocaleLowerCase('en');
            if (seen.has(key)) continue;
            seen.add(key);
            suggestions.push(suggestion);
            if (suggestions.length >= limit) break;
          }
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
      const cacheKey = `word:${this.corpusTag}:${normalizedWord}`;

      // Try Redis cache first
      return await this.cacheService.getOrSet(
        cacheKey,
        async () => {
          // The existing application database is the only dictionary source.
          const dbWord = await this.findWordInDatabase(normalizedWord);
          if (dbWord) {
            this.logger.log(`Found word "${word}" in database`);
            return dbWord;
          }

          // Compatibility for clients that still submit free text directly to
          // /word/:word: a Vietnamese meaning resolves to its best English
          // headword using only the primary database.
          if (this.vietnameseSearchEnabled) {
            const matches = await this.searchVietnameseGlosses(normalizedWord, 1);
            const match = matches[0];
            if (match && match.word.toLowerCase() !== normalizedWord) {
              return this.lookupWord(match.word);
            }
          }

          // Check if LLM fallback is enabled
          if (
            !this.llmFallbackEnabled
          ) {
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

    if (direction === 'vi-en' && !this.vietnameseSearchEnabled) {
      throw new HttpException(
        'Vietnamese dictionary search is disabled',
        HttpStatus.NOT_FOUND,
      );
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

    if (!matches.length && this.vietnameseSearchEnabled) {
      matches = await this.searchVietnameseGlosses(normalizedQuery);
    }
    if (!matches.length && !this.allowExternalFallback) {
      throw new HttpException(
        `No Vietnamese dictionary match for "${normalizedQuery}"`,
        HttpStatus.NOT_FOUND,
      );
    }
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

  private async searchVietnameseGlosses(
    query: string,
    limit = 12,
  ): Promise<VietnameseGlossMatch[]> {
    const normalizedQuery = normalizeVietnameseSearch(query);
    if (!normalizedQuery || limit < 1 || !this.vietnameseSearchEnabled) return [];
    const candidateLimit = Math.min(Math.max(limit * 20, 100), 1000);
    const prefixUpperBound = `${normalizedQuery}!`;
    const [translations, prefixDefinitions] = await Promise.all([
      this.learnerTranslationRepository.find({
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
        take: candidateLimit,
      }),
      this.definitionRepository.query(
        `
          SELECT d."id", d."definition_vi", d."definition_en",
                 d."part_of_speech", d."definition_order",
                 w."word", w."frequency_rank"
            FROM "definitions" d
            CROSS JOIN LATERAL (
              SELECT source_word."word", source_word."frequency_rank"
                FROM "words" source_word
               WHERE source_word."id" = d."word_id"
               OFFSET 0
            ) w
           WHERE d."definition_vi" IS NOT NULL
             AND btrim(d."definition_vi") <> ''
             AND NOT (d."quality_flags" && ARRAY[
               'missing_vi', 'vi_contains_cjk', 'vi_equals_en',
               'raw_markup', 'empty_definition'
             ]::text[])
             AND (d."definition_vi_normalized" COLLATE "C") >= $1
             AND (d."definition_vi_normalized" COLLATE "C") < $2
           ORDER BY CASE
                      WHEN d."definition_vi_normalized" = $1 THEN 100
                      ELSE 90
                    END DESC,
                    w."frequency_rank" ASC NULLS LAST,
                    d."definition_order" ASC, w."word" ASC
           LIMIT $3
        `,
        [normalizedQuery, prefixUpperBound, candidateLimit],
      ) as Promise<RawVietnameseDefinitionRow[]>,
    ]);

    const translationCandidates = translations.map((translation) => ({
      word: translation.sense.entry.word.word,
      definitionVi: translation.text,
      definitionEn: translation.sense.definitionEn,
      partOfSpeech: translation.sense.partOfSpeech,
      senseId: translation.sense.id,
      senseOrder: translation.sense.senseOrder,
      learnerRank: translation.sense.entry.learnerRank,
      sourcePriority: 0,
      dataSource: 'curated' as const,
      examples: (translation.sense.examples || [])
        .filter((example) => example.reviewStatus === 'approved')
        .sort((a, b) => a.exampleOrder - b.exampleOrder)
        .map((example) => ({ en: example.exampleEn, vi: example.exampleVi })),
    }));
    const prefixCandidates = this.rawVietnameseCandidates(prefixDefinitions);
    const prefixMatches = rankVietnameseGlosses(
      query,
      [...translationCandidates, ...prefixCandidates],
      limit,
    );

    // Exact and prefix matches always outrank token/substring matches. Avoid
    // the broader trigram scan when the fast indexed lane already fills the page.
    if (
      prefixMatches.length >= limit
      && prefixMatches[prefixMatches.length - 1].score >= 90
    ) {
      return prefixMatches;
    }

    const broadDefinitions = await this.definitionRepository.query(
      `
        WITH candidates AS MATERIALIZED (
          SELECT d."id", d."word_id", d."definition_vi", d."definition_en",
                 d."part_of_speech", d."definition_order",
                 d."definition_vi_normalized"
            FROM "definitions" d
           WHERE d."definition_vi" IS NOT NULL
             AND btrim(d."definition_vi") <> ''
             AND NOT (d."quality_flags" && ARRAY[
               'missing_vi', 'vi_contains_cjk', 'vi_equals_en',
               'raw_markup', 'empty_definition'
             ]::text[])
             AND d."definition_vi_normalized" LIKE $1
             AND NOT (
               (d."definition_vi_normalized" COLLATE "C") >= $2
               AND (d."definition_vi_normalized" COLLATE "C") < $3
             )
           ORDER BY CASE
                      WHEN (' ' || d."definition_vi_normalized" || ' ') LIKE $4
                        THEN 80
                      ELSE 65
                    END DESC,
                    d."definition_order" ASC
           LIMIT $5
        )
        SELECT d."id", d."definition_vi", d."definition_en",
               d."part_of_speech", d."definition_order",
               w."word", w."frequency_rank"
          FROM candidates d
          CROSS JOIN LATERAL (
            SELECT source_word."word", source_word."frequency_rank"
              FROM "words" source_word
             WHERE source_word."id" = d."word_id"
             OFFSET 0
          ) w
      `,
      [
        `%${normalizedQuery}%`,
        normalizedQuery,
        prefixUpperBound,
        `% ${normalizedQuery} %`,
        candidateLimit,
      ],
    ) as RawVietnameseDefinitionRow[];

    return rankVietnameseGlosses(
      query,
      [
        ...translationCandidates,
        ...prefixCandidates,
        ...this.rawVietnameseCandidates(broadDefinitions),
      ],
      limit,
    );
  }

  private rawVietnameseCandidates(definitions: RawVietnameseDefinitionRow[]) {
    return definitions.map((definition) => ({
      word: definition.word,
      definitionVi: definition.definition_vi,
      definitionEn: definition.definition_en,
      partOfSpeech: definition.part_of_speech,
      senseId: `definition:${definition.id}`,
      senseOrder: definition.definition_order,
      learnerRank: definition.frequency_rank,
      sourcePriority: 1,
      dataSource: 'raw_fallback' as const,
      examples: [],
    }));
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
    if (this.commercialSafeMode) {
      throw new HttpException(
        'Generated translation is disabled in commercial-safe mode',
        HttpStatus.FORBIDDEN,
      );
    }
    try {
      return await this.llmService.translate(dto);
    } catch (llmError) {
      if (!this.allowExternalFallback) {
        this.logger.warn(
          `LLM translation failed and external fallback is disabled: ${(llmError as Error).message}`,
        );
        throw new HttpException(
          'Translation failed',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
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

  getAttribution() {
    return {
      commercial_safe_mode: this.commercialSafeMode,
      software_license: 'MIT',
      dictionary_data_source: 'primary',
      vietnamese_search_enabled: this.vietnameseSearchEnabled,
      generated_fallback_enabled: this.llmFallbackEnabled,
      external_fallback_enabled: this.allowExternalFallback,
      data_policy:
        'Dictionary responses use the existing primary production database. Reviewed learner content is preferred; existing production definitions provide fallback coverage.',
      sources: [
        {
          name: 'Open English WordNet',
          version: '2025',
          license: 'CC BY 4.0',
          url: 'https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition',
          attribution:
            'Open English WordNet 2025, © 2019-present The Open English WordNet Team.',
        },
        {
          name: 'New General Service List',
          version: '1.2',
          license: 'CC BY-SA 4.0',
          url: 'https://www.newgeneralservicelist.com/new-general-service-list',
          attribution:
            'New General Service List by Browne, C., Culligan, B., and Phillips, J.',
        },
      ],
      excluded_data: 'DSD release data and generated dictionary entries are not served.',
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
      if (!this.allowExternalFallback) return { audio_url: null };
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
