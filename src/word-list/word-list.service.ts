import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WordList } from './entities/word-list.entity';
import { CreateWordDto } from './dto/create-word.dto';
import { UpdateWordDto } from './dto/update-word.dto';
import { RedisCacheService } from '../common/cache/redis-cache.service';

@Injectable()
export class WordListService {
  constructor(
    @InjectRepository(WordList)
    private wordListRepository: Repository<WordList>,
    private cacheService: RedisCacheService,
  ) {}

  async create(userId: string, createWordDto: CreateWordDto): Promise<WordList> {
    // Check if word already exists for this user
    const existing = await this.wordListRepository.findOne({
      where: {
        userId,
        word: createWordDto.word.toLowerCase().trim(),
      },
    });

    if (existing) {
      throw new ConflictException('Word already exists in your list');
    }

    const wordList = this.wordListRepository.create({
      userId,
      word: createWordDto.word.toLowerCase().trim(),
      notes: createWordDto.notes,
    });

    const result = await this.wordListRepository.save(wordList);

    // Invalidate user's word list caches
    await this.invalidateUserCaches(userId);

    return result;
  }

  async findAll(userId: string, search?: string): Promise<WordList[]> {
    const cacheKey = `${userId}${search ? `:search:${search.toLowerCase()}` : ':all'}`;
    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const queryBuilder = this.wordListRepository
          .createQueryBuilder('word_list')
          .where('word_list.user_id = :userId', { userId })
          .orderBy('word_list.word', 'ASC');

        if (search) {
          // Use prefix matching for better performance with B+ tree indexes
          queryBuilder.andWhere('word_list.word LIKE :search', {
            search: `${search.toLowerCase()}%`,
          });
        }

        return queryBuilder.getMany();
      },
      { prefix: 'wordlist', ttl: 600 }, // 10 minutes TTL
    );
  }

  /**
   * Search word list with autocomplete (returns up to 15 results)
   */
  async search(userId: string, query: string, limit: number = 15): Promise<string[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `${userId}:autocomplete:${normalizedQuery}:${limit}`;

    return await this.cacheService.getOrSet(
      cacheKey,
      async () => {
        const words = await this.wordListRepository
          .createQueryBuilder('word_list')
          .select('word_list.word')
          .where('word_list.user_id = :userId', { userId })
          .andWhere('word_list.word LIKE :query', { query: `${normalizedQuery}%` })
          .orderBy('word_list.word', 'ASC')
          .limit(limit)
          .getMany();

        return words.map(w => w.word);
      },
      { prefix: 'wordlist', ttl: this.cacheService.getSearchTTL() },
    );
  }

  async findOne(userId: string, id: string): Promise<WordList> {
    const wordList = await this.wordListRepository.findOne({
      where: { id, userId },
    });

    if (!wordList) {
      throw new NotFoundException('Word not found in your list');
    }

    return wordList;
  }

  async update(
    userId: string,
    id: string,
    updateWordDto: UpdateWordDto,
  ): Promise<WordList> {
    const wordList = await this.findOne(userId, id);

    Object.assign(wordList, updateWordDto);

    const result = await this.wordListRepository.save(wordList);

    // Invalidate user's word list caches
    await this.invalidateUserCaches(userId);

    return result;
  }

  async remove(userId: string, id: string): Promise<void> {
    const wordList = await this.findOne(userId, id);
    await this.wordListRepository.remove(wordList);

    // Invalidate user's word list caches
    await this.invalidateUserCaches(userId);
  }

  async removeByWord(userId: string, word: string): Promise<void> {
    const result = await this.wordListRepository.delete({
      userId,
      word: word.toLowerCase().trim(),
    });

    if (result.affected === 0) {
      throw new NotFoundException('Word not found in your list');
    }

    // Invalidate user's word list caches
    await this.invalidateUserCaches(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.wordListRepository.delete({ userId });

    // Invalidate user's word list caches
    await this.invalidateUserCaches(userId);
  }

  async import(userId: string, words: string[]): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    for (const word of words) {
      const cleanWord = word.toLowerCase().trim();
      if (!cleanWord) continue;

      try {
        const existing = await this.wordListRepository.findOne({
          where: { userId, word: cleanWord },
        });

        if (!existing) {
          const wordList = this.wordListRepository.create({
            userId,
            word: cleanWord,
          });
          await this.wordListRepository.save(wordList);
          added++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
      }
    }

    // Invalidate user's word list caches after bulk import
    if (added > 0) {
      await this.invalidateUserCaches(userId);
    }

    return { added, skipped };
  }

  /**
   * Invalidate all cached data for a specific user's word list
   */
  private async invalidateUserCaches(userId: string): Promise<void> {
    await this.cacheService.delByPattern(`wordlist:${userId}*`);
  }
}
