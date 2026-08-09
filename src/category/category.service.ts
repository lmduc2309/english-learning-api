import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CategoryWord } from './entities/category-word.entity';
import { Word } from '../dictionary/entities/word.entity';
import { SearchIndexService } from '../common/search/search-index.service';
import { RedisCacheService } from '../common/cache/redis-cache.service';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import {
  presentLearnerDefinitions,
  presentLearnerPronunciations,
  presentRawDefinitions,
} from '../dictionary/dictionary-presenter';
import { DSD_CORPUS_CONFIG } from '../dsd-corpus/dsd-corpus.module';
import { DsdCorpusConfig } from '../dsd-corpus/dsd-corpus.config';

// Category packs are a learning surface. Active clients opt into this filter
// so raw/reference-only dictionary rows cannot silently become lesson content.
// Keep the default endpoint behavior for older clients until they migrate.
const PUBLISHED_LEARNER_WORD_EXISTS = `EXISTS (
  SELECT 1
  FROM learner_entries learner_entry
  INNER JOIN learner_senses learner_sense
    ON learner_sense.learner_entry_id = learner_entry.id
   AND learner_sense.status = 'published'
  INNER JOIN learner_sense_translations learner_translation
    ON learner_translation.learner_sense_id = learner_sense.id
   AND (
     lower(learner_translation.locale) = 'vi'
     OR lower(learner_translation.locale) LIKE 'vi-%'
   )
   AND learner_translation.review_status = 'approved'
  WHERE learner_entry.word_id = w.id
    AND learner_entry.status = 'published'
)`;

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);
  private readonly commercialSafeMode: boolean;

  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(CategoryWord)
    private categoryWordRepository: Repository<CategoryWord>,
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(LearnerEntry)
    private learnerEntryRepository: Repository<LearnerEntry>,
    private searchIndexService: SearchIndexService,
    private cacheService: RedisCacheService,
    private configService: ConfigService,
    @Optional() @Inject(DSD_CORPUS_CONFIG) private readonly dsdConfig?: DsdCorpusConfig,
  ) {
    this.commercialSafeMode =
      this.configService.get<boolean>('content.commercialSafeMode') === true;
  }

  /**
   * Whether category endpoints must return nothing.
   *
   * DSD has no native categories yet — relations arrive in a later task and
   * categories after that. So on the public DSD channel there is no DSD category
   * data to serve, and the alternative is legacy or learner_* rows, which
   * commercial mode forbids. Empty is the only honest answer: an empty topic
   * list is a visibly missing feature, whereas silently serving reference packs
   * as lesson content is a licensing problem nobody notices.
   */
  private get categoriesUnavailableInCommercialMode(): boolean {
    return this.commercialSafeMode;
  }

  /**
   * Get all distinct topics
   */
  async getTopics(learnerOnly = false): Promise<{ topic: string; categoryCount: number }[]> {
    if (this.categoriesUnavailableInCommercialMode) return [];
    learnerOnly = learnerOnly || this.commercialSafeMode;
    const cacheKey = `all:${learnerOnly ? 'learner' : 'reference'}`;
    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const qb = this.categoryRepository
          .createQueryBuilder('c')
          .select('c.topic', 'topic')
          .addSelect('COUNT(DISTINCT c.id)', 'categoryCount')
          .groupBy('c.topic')
          .orderBy('c.topic', 'ASC');

        if (learnerOnly) {
          qb.innerJoin('c.categoryWords', 'cw')
            .innerJoin('cw.word', 'w')
            .where(PUBLISHED_LEARNER_WORD_EXISTS);
        }

        const results = await qb.getRawMany();

        return results.map((r) => ({
          topic: r.topic,
          categoryCount: parseInt(r.categoryCount, 10),
        }));
      },
      { prefix: 'topic', ttl: this.cacheService.getTopicTTL() },
    );
  }

  /**
   * Get all categories, optionally filtered by topic.
   * Includes subcategory count and word count.
   * parentOnly=true returns only root categories (no parent).
   */
  async getCategories(topic?: string, parentOnly?: boolean, learnerOnly = false): Promise<any[]> {
    if (this.categoriesUnavailableInCommercialMode) return [];
    learnerOnly = learnerOnly || this.commercialSafeMode;
    const cacheKey = `${topic || 'all'}:${parentOnly ? 'parent' : 'all'}:${learnerOnly ? 'learner' : 'reference'}`;
    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const qb = this.categoryRepository
          .createQueryBuilder('c')
          .leftJoin('c.categoryWords', 'cw')
          .leftJoin('cw.word', 'w')
          .leftJoin('c.children', 'sub')
          .select([
            'c.id AS id',
            'c.name AS name',
            'c.displayName AS "displayName"',
            'c.description AS description',
            'c.icon AS icon',
            'c.topic AS topic',
            'c.displayOrder AS "displayOrder"',
            'c.parentId AS "parentId"',
            'COUNT(DISTINCT cw.id) AS "wordCount"',
            'COUNT(DISTINCT sub.id) AS "subCategoryCount"',
          ])
          .groupBy('c.id')
          .orderBy('c.displayOrder', 'ASC')
          .addOrderBy('c.displayName', 'ASC');

        if (topic) {
          qb.andWhere('c.topic = :topic', { topic });
        }

        if (parentOnly) {
          qb.andWhere('c.parentId IS NULL');
        }

        if (learnerOnly) {
          qb.andWhere(PUBLISHED_LEARNER_WORD_EXISTS);
        }

        const results = await qb.getRawMany();
        return results.map((r) => ({
          ...r,
          wordCount: parseInt(r.wordCount, 10),
          subCategoryCount: parseInt(r.subCategoryCount, 10),
        }));
      },
      { prefix: 'category', ttl: this.cacheService.getCategoryTTL() },
    );
  }

  /**
   * Get subcategories of a parent category
   */
  async getSubCategories(parentIdOrName: string, learnerOnly = false): Promise<any[]> {
    if (this.categoriesUnavailableInCommercialMode) return [];
    learnerOnly = learnerOnly || this.commercialSafeMode;
    const parent = await this.getCategory(parentIdOrName);

    const qb = this.categoryRepository
      .createQueryBuilder('c')
      .leftJoin('c.categoryWords', 'cw')
      .leftJoin('cw.word', 'w')
      .select([
        'c.id AS id',
        'c.name AS name',
        'c.displayName AS "displayName"',
        'c.description AS description',
        'c.icon AS icon',
        'c.topic AS topic',
        'c.displayOrder AS "displayOrder"',
        'c.parentId AS "parentId"',
        'COUNT(cw.id) AS "wordCount"',
      ])
      .where('c.parentId = :parentId', { parentId: parent.id })
      .groupBy('c.id')
      .orderBy('c.displayOrder', 'ASC')
      .addOrderBy('c.displayName', 'ASC');

    if (learnerOnly) {
      qb.andWhere(PUBLISHED_LEARNER_WORD_EXISTS);
    }

    const results = await qb.getRawMany();
    return results.map((r) => ({
      ...r,
      wordCount: parseInt(r.wordCount, 10),
    }));
  }

  /**
   * Get a single category by id or name
   */
  async getCategory(idOrName: string): Promise<Category> {
    if (this.categoriesUnavailableInCommercialMode) {
      throw new NotFoundException(`Category "${idOrName}" not found`);
    }
    const isNumeric = /^\d+$/.test(idOrName);
    const category = isNumeric
      ? await this.categoryRepository.findOne({ where: { id: parseInt(idOrName, 10) } })
      : await this.categoryRepository.findOne({ where: { name: idOrName } });

    if (!category) {
      throw new NotFoundException(`Category "${idOrName}" not found`);
    }
    return category;
  }

  /**
   * Get words in a category with full dictionary data (paginated)
   */
  async getCategoryWords(
    idOrName: string,
    page: number = 1,
    limit: number = 100,
    search?: string,
    learnerOnly = false,
  ): Promise<any> {
    if (this.categoriesUnavailableInCommercialMode) {
      // Shaped like a real empty page so clients need no special case.
      return { category: null, words: [], total: 0, page, limit };
    }
    learnerOnly = learnerOnly || this.commercialSafeMode;
    const category = await this.getCategory(idOrName);
    const searchTerm = search?.trim();
    const cacheKey = `${category.id}:p${page}:l${limit}${searchTerm ? `:s${searchTerm}` : ''}:${learnerOnly ? 'learner' : 'reference'}`;

    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const offset = (page - 1) * limit;

        // Get total count (with search filter if provided)
        const countQb = this.categoryWordRepository
          .createQueryBuilder('cw')
          .leftJoin('cw.word', 'w')
          .where('cw.categoryId = :categoryId', { categoryId: category.id });
        if (searchTerm) {
          countQb.andWhere('w.word ILIKE :search', { search: `%${searchTerm}%` });
        }
        if (learnerOnly) {
          countQb.andWhere(PUBLISHED_LEARNER_WORD_EXISTS);
        }
        const totalWords = await countQb.getCount();

        const wordsQb = this.categoryWordRepository
          .createQueryBuilder('cw')
          .leftJoinAndSelect('cw.word', 'w')
          .leftJoinAndSelect('w.definitions', 'd')
          .leftJoinAndSelect('d.examples', 'e')
          .leftJoinAndSelect('w.pronunciations', 'p')
          .leftJoinAndSelect('w.wordForms', 'wf')
          .where('cw.categoryId = :categoryId', { categoryId: category.id });
        if (searchTerm) {
          wordsQb.andWhere('w.word ILIKE :search', { search: `%${searchTerm}%` });
        }
        if (learnerOnly) {
          wordsQb.andWhere(PUBLISHED_LEARNER_WORD_EXISTS);
        }
        const words = await wordsQb
          .orderBy('cw.displayOrder', 'ASC')
          .addOrderBy('w.word', 'ASC')
          .skip(offset)
          .take(limit)
          .getMany();

        const wordIds = words.map((categoryWord) => categoryWord.word.id);
        const learnerEntries = wordIds.length > 0
          ? await this.learnerEntryRepository.find({
              where: { wordId: In(wordIds), status: 'published' },
              relations: [
                'senses',
                'senses.translations',
                'senses.examples',
                'pronunciations',
              ],
            })
          : [];
        const learnerEntriesByWordId = new Map(
          learnerEntries.map((entry) => [String(entry.wordId), entry]),
        );

        // Get subcategories info
        const subCategories = await this.getSubCategories(String(category.id), learnerOnly);

        return {
          category: {
            id: category.id,
            name: category.name,
            displayName: category.displayName,
            description: category.description,
            icon: category.icon,
            topic: category.topic,
            parentId: category.parentId,
          },
          subCategories,
          words: words
            .map((cw) => this.formatWord(
              cw.word,
              learnerEntriesByWordId.get(String(cw.word.id)),
            ))
            .filter((word) => word !== null),
          totalWords,
          page,
          limit,
          totalPages: Math.ceil(totalWords / limit),
          hasMore: offset + limit < totalWords,
        };
      },
      { prefix: 'category', ttl: this.cacheService.getCategoryTTL() },
    );
  }

  /**
   * Create a new category
   */
  async createCategory(data: {
    name: string;
    displayName: string;
    description?: string;
    icon?: string;
    topic: string;
    displayOrder?: number;
  }): Promise<Category> {
    const category = this.categoryRepository.create(data);
    const saved = await this.categoryRepository.save(category);
    await Promise.all([
      this.cacheService.invalidateCategoryCaches(),
      this.cacheService.invalidateTopicCaches(),
    ]);
    return saved;
  }

  /**
   * Add words to a category
   */
  async addWordsToCategory(
    idOrName: string,
    wordNames: string[],
  ): Promise<{ added: number; skipped: number; notFound: string[] }> {
    const category = await this.getCategory(idOrName);
    let added = 0;
    let skipped = 0;
    const notFound: string[] = [];

    for (const wordName of wordNames) {
      const word = await this.wordRepository.findOne({
        where: { word: wordName.toLowerCase().trim() },
      });

      if (!word) {
        notFound.push(wordName);
        continue;
      }

      const exists = await this.categoryWordRepository.findOne({
        where: { categoryId: category.id, wordId: word.id },
      });

      if (exists) {
        skipped++;
        continue;
      }

      const categoryWord = this.categoryWordRepository.create({
        categoryId: category.id,
        wordId: word.id,
      });
      await this.categoryWordRepository.save(categoryWord);
      added++;
    }

    // Membership changes can make a learner-only category/topic appear or
    // disappear, so list caches must be invalidated with the word-page cache.
    await Promise.all([
      this.cacheService.invalidateCategoryCaches(),
      this.cacheService.invalidateTopicCaches(),
    ]);

    return { added, skipped, notFound };
  }

  /**
   * Remove a word from a category
   */
  async removeWordFromCategory(idOrName: string, wordName: string): Promise<void> {
    const category = await this.getCategory(idOrName);
    const word = await this.wordRepository.findOne({
      where: { word: wordName.toLowerCase().trim() },
    });

    if (!word) {
      throw new NotFoundException(`Word "${wordName}" not found`);
    }

    await this.categoryWordRepository.delete({
      categoryId: category.id,
      wordId: word.id,
    });

    await Promise.all([
      this.cacheService.invalidateCategoryCaches(),
      this.cacheService.invalidateTopicCaches(),
    ]);
  }

  /**
   * Seed default categories with words
   */
  async seedCategories(
    categories: Array<{
      name: string;
      displayName: string;
      description?: string;
      icon?: string;
      topic: string;
      displayOrder?: number;
      words?: string[];
    }>,
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const catData of categories) {
      let category = await this.categoryRepository.findOne({
        where: { name: catData.name },
      });

      if (!category) {
        category = this.categoryRepository.create({
          name: catData.name,
          displayName: catData.displayName,
          description: catData.description,
          icon: catData.icon,
          topic: catData.topic,
          displayOrder: catData.displayOrder || 0,
        });
        category = await this.categoryRepository.save(category);
        created++;
      } else {
        updated++;
      }

      if (catData.words?.length) {
        await this.addWordsToCategory(String(category.id), catData.words);
      }
    }

    // A newly seeded category may intentionally contain no words, but still
    // changes the compatibility catalog and topic counts.
    await Promise.all([
      this.cacheService.invalidateCategoryCaches(),
      this.cacheService.invalidateTopicCaches(),
    ]);

    return { created, updated };
  }

  /**
   * Search categories with autocomplete
   */
  async searchCategories(query: string, limit: number = 15): Promise<any> {
    if (this.categoriesUnavailableInCommercialMode) {
      return { suggestions: [], count: 0 };
    }
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `search:categories:${normalizedQuery}:${limit}`;

    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const results = await this.searchIndexService.searchCategories(normalizedQuery, limit);
        return {
          suggestions: results.map((r) => ({
            id: r.id,
            name: r.name,
            displayName: r.displayName,
            topic: r.topic,
            wordCount: r.wordCount,
          })),
          count: results.length,
        };
      },
      { prefix: 'category', ttl: this.cacheService.getSearchTTL() },
    );
  }

  /**
   * Search topics with autocomplete
   */
  async searchTopics(query: string, limit: number = 15): Promise<any> {
    if (this.categoriesUnavailableInCommercialMode) {
      return { suggestions: [], count: 0 };
    }
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `search:topics:${normalizedQuery}:${limit}`;

    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const results = await this.searchIndexService.searchTopics(normalizedQuery, limit);
        return {
          suggestions: results.map((r) => ({
            topic: r.displayName,
            categoryCount: r.wordCount,
          })),
          count: results.length,
        };
      },
      { prefix: 'topic', ttl: this.cacheService.getSearchTTL() },
    );
  }

  private formatWord(word: Word, learnerEntry?: LearnerEntry): any {
    if (!word) return null;

    const rawPronunciations = word.pronunciations?.map((pronunciation) => ({
      accent: pronunciation.accent,
      ipa: pronunciation.ipa,
      audio_url: pronunciation.audioUrl,
    })) || [];
    const curatedDefinitions = presentLearnerDefinitions(learnerEntry);
    const hasCuratedDefinitions = curatedDefinitions.length > 0;

    // The query above already limits commercial pages to published overlay
    // rows. Keep presentation fail-closed too, so a concurrent unpublish or a
    // missing relation can never turn into a legacy response.
    if (this.commercialSafeMode && !hasCuratedDefinitions) return null;

    return {
      word: word.word,
      frequency_rank: hasCuratedDefinitions
        ? this.commercialSafeMode
          ? learnerEntry?.learnerRank
          : learnerEntry?.learnerRank ?? word.frequencyRank
        : word.frequencyRank,
      learner_band: hasCuratedDefinitions ? learnerEntry?.learnerBand : undefined,
      rank_source: hasCuratedDefinitions ? learnerEntry?.rankSource : undefined,
      rank_source_version: hasCuratedDefinitions
        ? learnerEntry?.rankSourceVersion
        : undefined,
      rank_source_license: hasCuratedDefinitions
        ? learnerEntry?.rankSourceLicense
        : undefined,
      pronunciations: hasCuratedDefinitions
        ? presentLearnerPronunciations(learnerEntry)
        : rawPronunciations,
      definitions: hasCuratedDefinitions
        ? curatedDefinitions
        : presentRawDefinitions(word.definitions),
      data_source: hasCuratedDefinitions ? 'curated' : 'raw_fallback',
      word_forms: hasCuratedDefinitions
        ? {}
        : word.wordForms?.reduce((acc, wf) => {
            acc[wf.formType] = wf.formWord;
            return acc;
          }, {} as Record<string, string>) || {},
    };
  }
}
