# Redis Cache Implementation - Update Guide

## Category Service Updates

Add Redis cache to the following methods in `category.service.ts`:

### 1. Add RedisCacheService to constructor

```typescript
constructor(
  @InjectRepository(Category)
  private categoryRepository: Repository<Category>,
  @InjectRepository(CategoryWord)
  private categoryWordRepository: Repository<CategoryWord>,
  @InjectRepository(Word)
  private wordRepository: Repository<Word>,
  private searchIndexService: SearchIndexService,
  private cacheService: RedisCacheService, // ADD THIS
) {}
```

### 2. Update getTopics() method

```typescript
async getTopics(): Promise<{ topic: string; categoryCount: number }[]> {
  const cacheKey = 'topics:all';

  return this.cacheService.getOrSet(
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
    {
      prefix: 'category',
      ttl: this.cacheService.getTopicTTL(),
    },
  );
}
```

### 3. Update getCategories() method

```typescript
async getCategories(topic?: string, parentOnly?: boolean): Promise<any[]> {
  const cacheKey = `categories:topic:${topic || 'all'}:parent:${parentOnly || false}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      const qb = this.categoryRepository
        .createQueryBuilder('c')
        // ... existing query builder code ...

      const results = await qb.getRawMany();
      return results.map((r) => ({
        ...r,
        wordCount: parseInt(r.wordCount, 10),
        subCategoryCount: parseInt(r.subCategoryCount, 10),
      }));
    },
    {
      prefix: 'category',
      ttl: this.cacheService.getCategoryTTL(),
    },
  );
}
```

### 4. Update getCategoryWords() method

```typescript
async getCategoryWords(
  idOrName: string,
  page: number = 1,
  limit: number = 100,
  search?: string,
): Promise<any> {
  const category = await this.getCategory(idOrName);
  const cacheKey = `words:${category.id}:page:${page}:limit:${limit}:search:${search || 'none'}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      // ... existing implementation ...
      return {
        category: { /*...*/ },
        subCategories,
        words,
        totalWords,
        page,
        limit,
        totalPages: Math.ceil(totalWords / limit),
        hasMore: offset + limit < totalWords,
      };
    },
    {
      prefix: 'category',
      ttl: this.cacheService.getCategoryTTL(),
    },
  );
}
```

### 5. Update searchCategories() method

```typescript
async searchCategories(query: string, limit: number = 15): Promise<any> {
  const cacheKey = `search:categories:${query}:${limit}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      const results = await this.searchIndexService.searchCategories(query, limit);
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
    {
      prefix: 'category',
      ttl: this.cacheService.getSearchTTL(),
    },
  );
}
```

### 6. Update searchTopics() method

```typescript
async searchTopics(query: string, limit: number = 15): Promise<any> {
  const cacheKey = `search:topics:${query}:${limit}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      const results = await this.searchIndexService.searchTopics(query, limit);
      return {
        suggestions: results.map((r) => ({
          topic: r.displayName,
          categoryCount: r.wordCount,
        })),
        count: results.length,
      };
    },
    {
      prefix: 'topic',
      ttl: this.cacheService.getTopicTTL(),
    },
  );
}
```

## Word-List Service Updates

Add Redis cache to `word-list.service.ts`:

### 1. Add RedisCacheService to constructor

```typescript
constructor(
  @InjectRepository(WordList)
  private wordListRepository: Repository<WordList>,
  private cacheService: RedisCacheService, // ADD THIS
) {}
```

### 2. Update findAll() method

```typescript
async findAll(userId: string, search?: string): Promise<WordList[]> {
  const cacheKey = `user:${userId}:search:${search || 'all'}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      const queryBuilder = this.wordListRepository
        .createQueryBuilder('word_list')
        .where('word_list.user_id = :userId', { userId })
        .orderBy('word_list.word', 'ASC');

      if (search) {
        queryBuilder.andWhere('word_list.word LIKE :search', {
          search: `${search.toLowerCase()}%`,
        });
      }

      return queryBuilder.getMany();
    },
    {
      prefix: 'wordlist',
      ttl: 300, // 5 minutes for user's word list
    },
  );
}
```

### 3. Update search() method

```typescript
async search(userId: string, query: string, limit: number = 15): Promise<string[]> {
  const cacheKey = `user:${userId}:search:${query}:${limit}`;

  return this.cacheService.getOrSet(
    cacheKey,
    async () => {
      const words = await this.wordListRepository
        .createQueryBuilder('word_list')
        .select('word_list.word')
        .where('word_list.user_id = :userId', { userId })
        .andWhere('word_list.word LIKE :query', { query: `${query.toLowerCase()}%` })
        .orderBy('word_list.word', 'ASC')
        .limit(limit)
        .getMany();

      return words.map(w => w.word);
    },
    {
      prefix: 'wordlist',
      ttl: this.cacheService.getSearchTTL(),
    },
  );
}
```

### 4. Invalidate cache on mutations

```typescript
async create(userId: string, createWordDto: CreateWordDto): Promise<WordList> {
  // ... existing implementation ...
  const wordList = await this.wordListRepository.save(newWord);

  // Invalidate user's word list cache
  await this.cacheService.delByPattern(`wordlist:user:${userId}:*`);

  return wordList;
}

async remove(userId: string, id: string): Promise<void> {
  // ... existing implementation ...

  // Invalidate cache
  await this.cacheService.delByPattern(`wordlist:user:${userId}:*`);
}

async clear(userId: string): Promise<void> {
  await this.wordListRepository.delete({ userId });

  // Invalidate cache
  await this.cacheService.delByPattern(`wordlist:user:${userId}:*`);
}
```

## Module Updates

### Update category.module.ts

```typescript
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, CategoryWord, Word]),
    SearchModule,
    CacheModule, // ADD THIS
  ],
  // ...
})
```

### Update word-list.module.ts

```typescript
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WordList]),
    CacheModule, // ADD THIS
  ],
  // ...
})
```

## Cache Invalidation Strategy

### When to Invalidate

1. **Word Added to Database**: `await cacheService.invalidateWordCaches(word);`
2. **Category Created/Updated**: `await cacheService.invalidateCategoryCaches(categoryId);`
3. **Topic Modified**: `await cacheService.invalidateTopicCaches(topic);`
4. **User Word List Changed**: `await cacheService.delByPattern(`wordlist:user:${userId}:*`);`
5. **Search Index Rebuilt**: `await cacheService.invalidateSearchCaches();`

### Cache Keys Pattern

- **Dictionary Search**: `dict:search:{query}:{limit}`
- **Word Detail**: `dict:word:{word}`
- **Topics**: `category:topics:all`
- **Categories**: `category:categories:topic:{topic}:parent:{boolean}`
- **Category Words**: `category:words:{categoryId}:page:{page}:limit:{limit}:search:{query}`
- **Category Search**: `category:search:categories:{query}:{limit}`
- **Topic Search**: `topic:search:topics:{query}:{limit}`
- **User Word List**: `wordlist:user:{userId}:search:{query}`

## Environment Variables

Add to `.env`:

```env
REDIS_URL=redis://localhost:6379
# Or for remote Redis:
# REDIS_URL=redis://username:password@host:port/db
```

## Testing Redis Cache

```bash
# Check Redis connection
redis-cli ping

# Monitor cache hits
redis-cli monitor

# Check cache keys
redis-cli keys "*"

# Check specific key
redis-cli get "dict:word:hello"

# Flush all cache (development only)
redis-cli flushall
```

## Cache Stats Endpoint

Add to any controller:

```typescript
@Get('cache/stats')
async getCacheStats() {
  return this.cacheService.getStats();
}
```

Returns:
```json
{
  "connected": true,
  "dbSize": 1234,
  "memoryUsed": "5.2M",
  "hitRate": 92.5
}
```
