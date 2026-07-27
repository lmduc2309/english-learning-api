import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BPlusTree } from './bplus-tree';
import { Word } from '../../dictionary/entities/word.entity';
import { Category } from '../../category/entities/category.entity';

export interface SearchResult {
  id: number;
  word?: string;
  name?: string;
  displayName?: string;
  type: 'word' | 'category';
  frequencyRank?: number;
  learnerRank?: number;
  isLearnerEntry?: boolean;
  topic?: string;
  wordCount?: number;
}

@Injectable()
export class SearchIndexService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexService.name);

  // Separate indexes for different search types
  private wordIndex: BPlusTree<SearchResult>;
  private learnerWordIndex: BPlusTree<SearchResult>;
  private categoryIndex: BPlusTree<SearchResult>;
  private topicIndex: BPlusTree<SearchResult>;

  private indexInitialized = false;

  constructor(
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
  ) {
    this.wordIndex = new BPlusTree<SearchResult>(100);
    this.learnerWordIndex = new BPlusTree<SearchResult>(100);
    this.categoryIndex = new BPlusTree<SearchResult>(50);
    this.topicIndex = new BPlusTree<SearchResult>(50);
  }

  async onModuleInit() {
    // Initialize indexes on startup
    await this.rebuildIndexes();
  }

  /**
   * Rebuild all search indexes from database
   */
  async rebuildIndexes(): Promise<void> {
    this.logger.log('Rebuilding search indexes...');
    const startTime = Date.now();

    try {
      await Promise.all([
        this.rebuildWordIndex(),
        this.rebuildCategoryIndex(),
      ]);

      this.indexInitialized = true;

      const duration = Date.now() - startTime;
      const stats = this.getIndexStats();

      this.logger.log(
        `Search indexes rebuilt in ${duration}ms: ${stats.words} words, ${stats.categories} categories`
      );
    } catch (error) {
      this.logger.error('Failed to rebuild search indexes', error.stack);
      throw error;
    }
  }

  private async rebuildWordIndex(): Promise<void> {
    this.wordIndex.clear();
    this.learnerWordIndex.clear();

    // Keep the comprehensive corpus searchable, but maintain a small, separate
    // published learner index so reviewed words always rank ahead of raw rows.
    const words = await this.wordRepository
      .createQueryBuilder('word')
      .leftJoinAndSelect(
        'word.learnerEntry',
        'learnerEntry',
        'learnerEntry.status = :learnerStatus',
        { learnerStatus: 'published' },
      )
      .select([
        'word.id',
        'word.word',
        'word.frequencyRank',
        'learnerEntry.id',
        'learnerEntry.learnerRank',
      ])
      .orderBy('learnerEntry.learner_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('word.frequency_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('word.word', 'ASC')
      .getMany();

    const items = words.map(word => ({
      key: word.word,
      value: {
        id: word.id,
        word: word.word,
        type: 'word' as const,
        frequencyRank: word.learnerEntry?.learnerRank ?? word.frequencyRank,
        learnerRank: word.learnerEntry?.learnerRank,
        isLearnerEntry: Boolean(word.learnerEntry),
      },
    }));

    this.wordIndex.bulkInsert(items);
    this.learnerWordIndex.bulkInsert(
      items.filter((item) => item.value.isLearnerEntry),
    );

    this.logger.log(
      `Indexed ${words.length} words (${this.learnerWordIndex.getStats().totalKeys} published learner entries)`,
    );
  }

  private async rebuildCategoryIndex(): Promise<void> {
    this.categoryIndex.clear();
    this.topicIndex.clear();

    // Fetch all categories with word counts
    const categories = await this.categoryRepository
      .createQueryBuilder('c')
      .leftJoin('c.categoryWords', 'cw')
      .select([
        'c.id',
        'c.name',
        'c.displayName',
        'c.topic',
        'c.description',
        'COUNT(cw.id) as wordCount',
      ])
      .groupBy('c.id')
      .orderBy('c.displayName', 'ASC')
      .getRawMany();

    // Index by category name and display name
    const categoryItems = categories.flatMap(cat => [
      {
        key: cat.c_name,
        value: {
          id: cat.c_id,
          name: cat.c_name,
          displayName: cat.c_displayName,
          type: 'category' as const,
          topic: cat.c_topic,
          wordCount: parseInt(cat.wordCount, 10),
        },
      },
      {
        key: cat.c_displayName,
        value: {
          id: cat.c_id,
          name: cat.c_name,
          displayName: cat.c_displayName,
          type: 'category' as const,
          topic: cat.c_topic,
          wordCount: parseInt(cat.wordCount, 10),
        },
      },
    ]);

    this.categoryIndex.bulkInsert(categoryItems);

    // Index by topic
    const topicItems = categories.map(cat => ({
      key: cat.c_topic,
      value: {
        id: cat.c_id,
        name: cat.c_name,
        displayName: cat.c_displayName,
        type: 'category' as const,
        topic: cat.c_topic,
        wordCount: parseInt(cat.wordCount, 10),
      },
    }));

    this.topicIndex.bulkInsert(topicItems);

    this.logger.log(`Indexed ${categories.length} categories`);
  }

  /**
   * Search words with prefix matching
   */
  async searchWords(query: string, limit: number = 15): Promise<SearchResult[]> {
    if (!this.indexInitialized) {
      this.logger.warn('Search index not initialized, using fallback');
      return this.fallbackSearchWords(query, limit);
    }

    const learnerIndexSize = this.learnerWordIndex.getStats().totalKeys;
    const reviewed = this.sortWordResults(
      this.learnerWordIndex.searchPrefix(query, Math.max(limit, learnerIndexSize)),
      query,
    );
    const rawCandidates = this.sortWordResults(
      this.wordIndex.searchPrefix(query, Math.max(limit * 20, 250)),
      query,
    );
    const unique = new Map<number, SearchResult>();
    for (const result of this.sortWordResults([...reviewed, ...rawCandidates], query)) {
      if (!unique.has(result.id)) unique.set(result.id, result);
      if (unique.size >= limit) break;
    }
    return Array.from(unique.values());
  }

  private sortWordResults(results: SearchResult[], query: string): SearchResult[] {
    const normalizedQuery = query.toLowerCase().trim();
    return [...results].sort((a, b) => {
      const exactA = a.word?.toLowerCase() === normalizedQuery ? 0 : 1;
      const exactB = b.word?.toLowerCase() === normalizedQuery ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;

      const learnerA = a.isLearnerEntry ? 0 : 1;
      const learnerB = b.isLearnerEntry ? 0 : 1;
      if (learnerA !== learnerB) return learnerA - learnerB;

      const rankA = a.learnerRank ?? a.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.learnerRank ?? b.frequencyRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return (a.word || '').localeCompare(b.word || '');
    });
  }

  /**
   * Search categories by name or display name
   */
  async searchCategories(query: string, limit: number = 15): Promise<SearchResult[]> {
    if (!this.indexInitialized) {
      this.logger.warn('Search index not initialized, using fallback');
      return this.fallbackSearchCategories(query, limit);
    }

    const results = this.categoryIndex.searchPrefix(query, limit);

    // Remove duplicates (same category matched by name and displayName)
    const uniqueResults = new Map<number, SearchResult>();
    for (const result of results) {
      if (!uniqueResults.has(result.id)) {
        uniqueResults.set(result.id, result);
      }
    }

    // Sort by word count (descending) and then by display name
    return Array.from(uniqueResults.values())
      .sort((a, b) => {
        const countDiff = (b.wordCount ?? 0) - (a.wordCount ?? 0);
        if (countDiff !== 0) return countDiff;
        return (a.displayName ?? '').localeCompare(b.displayName ?? '');
      })
      .slice(0, limit);
  }

  /**
   * Search topics by name
   */
  async searchTopics(query: string, limit: number = 15): Promise<SearchResult[]> {
    if (!this.indexInitialized) {
      this.logger.warn('Search index not initialized');
      return [];
    }

    const results = this.topicIndex.searchPrefix(query, limit);

    // Group by topic and count categories
    const topicMap = new Map<string, { topic: string; count: number }>();

    for (const result of results) {
      if (result.topic) {
        const existing = topicMap.get(result.topic);
        if (existing) {
          existing.count++;
        } else {
          topicMap.set(result.topic, { topic: result.topic, count: 1 });
        }
      }
    }

    return Array.from(topicMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(item => ({
        id: 0,
        name: item.topic,
        displayName: item.topic,
        type: 'category' as const,
        topic: item.topic,
        wordCount: item.count,
      }));
  }

  /**
   * Add a word to the index
   */
  async indexWord(word: Word): Promise<void> {
    this.wordIndex.insert(word.word, {
      id: word.id,
      word: word.word,
      type: 'word',
      frequencyRank: word.frequencyRank,
    });
  }

  /**
   * Add a category to the index
   */
  async indexCategory(category: Category, wordCount?: number): Promise<void> {
    const result: SearchResult = {
      id: category.id,
      name: category.name,
      displayName: category.displayName,
      type: 'category',
      topic: category.topic,
      wordCount: wordCount,
    };

    this.categoryIndex.insert(category.name, result);
    this.categoryIndex.insert(category.displayName, result);
    this.topicIndex.insert(category.topic, result);
  }

  /**
   * Get index statistics
   */
  getIndexStats() {
    const wordStats = this.wordIndex.getStats();
    const categoryStats = this.categoryIndex.getStats();
    const topicStats = this.topicIndex.getStats();

    return {
      words: wordStats.totalKeys,
      learnerWords: this.learnerWordIndex.getStats().totalKeys,
      categories: categoryStats.totalKeys,
      topics: topicStats.totalKeys,
      wordIndexHeight: wordStats.height,
      categoryIndexHeight: categoryStats.height,
      initialized: this.indexInitialized,
    };
  }

  /**
   * Fallback search using database when index is not ready
   */
  private async fallbackSearchWords(
    query: string,
    limit: number
  ): Promise<SearchResult[]> {
    const words = await this.wordRepository
      .createQueryBuilder('word')
      .leftJoinAndSelect(
        'word.learnerEntry',
        'learnerEntry',
        'learnerEntry.status = :learnerStatus',
        { learnerStatus: 'published' },
      )
      .where('word.word LIKE :query', { query: `${query.toLowerCase()}%` })
      .orWhere('word.word_normalized LIKE :query', { query: `${query.toLowerCase()}%` })
      .orderBy('CASE WHEN learnerEntry.id IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('learnerEntry.learner_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('word.frequency_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('word.word', 'ASC')
      .limit(limit)
      .getMany();

    return words.map(word => ({
      id: word.id,
      word: word.word,
      type: 'word' as const,
      frequencyRank: word.learnerEntry?.learnerRank ?? word.frequencyRank,
      learnerRank: word.learnerEntry?.learnerRank,
      isLearnerEntry: Boolean(word.learnerEntry),
    }));
  }

  private async fallbackSearchCategories(
    query: string,
    limit: number
  ): Promise<SearchResult[]> {
    const categories = await this.categoryRepository
      .createQueryBuilder('c')
      .leftJoin('c.categoryWords', 'cw')
      .where('c.name ILIKE :query', { query: `%${query}%` })
      .orWhere('c.displayName ILIKE :query', { query: `%${query}%` })
      .select([
        'c.id',
        'c.name',
        'c.displayName',
        'c.topic',
        'COUNT(cw.id) as wordCount',
      ])
      .groupBy('c.id')
      .orderBy('COUNT(cw.id)', 'DESC')
      .limit(limit)
      .getRawMany();

    return categories.map(cat => ({
      id: cat.c_id,
      name: cat.c_name,
      displayName: cat.c_displayName,
      type: 'category' as const,
      topic: cat.c_topic,
      wordCount: parseInt(cat.wordCount, 10),
    }));
  }
}
