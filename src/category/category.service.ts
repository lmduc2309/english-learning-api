import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CategoryWord } from './entities/category-word.entity';
import { Word } from '../dictionary/entities/word.entity';
import { SearchIndexService } from '../common/search/search-index.service';
import { RedisCacheService } from '../common/cache/redis-cache.service';

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(CategoryWord)
    private categoryWordRepository: Repository<CategoryWord>,
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    private searchIndexService: SearchIndexService,
    private cacheService: RedisCacheService,
  ) {}

  /**
   * Get all distinct topics
   */
  async getTopics(): Promise<{ topic: string; categoryCount: number }[]> {
    const cacheKey = 'all';
    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const results = await this.categoryRepository
          .createQueryBuilder('c')
          .select('c.topic', 'topic')
          .addSelect('COUNT(c.id)', 'categoryCount')
          .groupBy('c.topic')
          .orderBy('c.topic', 'ASC')
          .getRawMany();

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
  async getCategories(topic?: string, parentOnly?: boolean): Promise<any[]> {
    const cacheKey = `${topic || 'all'}:${parentOnly ? 'parent' : 'all'}`;
    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const qb = this.categoryRepository
          .createQueryBuilder('c')
          .leftJoin('c.categoryWords', 'cw')
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
  async getSubCategories(parentIdOrName: string): Promise<any[]> {
    const parent = await this.getCategory(parentIdOrName);

    const qb = this.categoryRepository
      .createQueryBuilder('c')
      .leftJoin('c.categoryWords', 'cw')
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
  ): Promise<any> {
    const category = await this.getCategory(idOrName);
    const searchTerm = search?.trim();
    const cacheKey = `${category.id}:p${page}:l${limit}${searchTerm ? `:s${searchTerm}` : ''}`;

    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const offset = (page - 1) * limit;

        // Get total count (with search filter if provided)
        const countQb = this.categoryWordRepository
          .createQueryBuilder('cw')
          .where('cw.categoryId = :categoryId', { categoryId: category.id });
        if (searchTerm) {
          countQb.leftJoin('cw.word', 'w');
          countQb.andWhere('w.word ILIKE :search', { search: `%${searchTerm}%` });
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
        const words = await wordsQb
          .orderBy('cw.displayOrder', 'ASC')
          .addOrderBy('w.word', 'ASC')
          .skip(offset)
          .take(limit)
          .getMany();

        // Get subcategories info
        const subCategories = await this.getSubCategories(String(category.id));

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
          words: words.map((cw) => this.formatWord(cw.word)),
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
    return this.categoryRepository.save(category);
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

    // Invalidate cache for this category
    await this.cacheService.invalidateCategoryCaches(category.id);

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

    // Invalidate cache for this category
    await this.cacheService.invalidateCategoryCaches(category.id);
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

    return { created, updated };
  }

  /**
   * Search categories with autocomplete
   */
  async searchCategories(query: string, limit: number = 15): Promise<any> {
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

  private formatWord(word: Word): any {
    if (!word) return null;

    return {
      word: word.word,
      frequency_rank: word.frequencyRank,
      pronunciations: word.pronunciations?.map((p) => ({
        accent: p.accent,
        ipa: p.ipa,
        audio_url: p.audioUrl,
      })) || [],
      definitions: word.definitions?.map((d) => ({
        pos: d.partOfSpeech,
        definition_en: d.definitionEn,
        definition_vi: d.definitionVi,
        level: d.level,
        examples: d.examples?.map((e) => ({
          en: e.exampleEn,
          vi: e.exampleVi,
        })) || [],
      })) || [],
      word_forms: word.wordForms?.reduce((acc, wf) => {
        acc[wf.formType] = wf.formWord;
        return acc;
      }, {} as Record<string, string>) || {},
    };
  }
}
