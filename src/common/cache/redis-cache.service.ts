import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Cache key prefix
}

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: RedisClientType;
  private isConnected = false;

  // Default TTL values (in seconds)
  private readonly DEFAULT_TTL = 300; // 5 minutes
  private readonly SEARCH_TTL = 600; // 10 minutes for search results
  private readonly CATEGORY_TTL = 1800; // 30 minutes for categories
  private readonly WORD_DETAIL_TTL = 3600; // 1 hour for word details
  private readonly TOPIC_TTL = 3600; // 1 hour for topics

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    this.client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            this.logger.error('Too many Redis reconnection attempts');
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis Client Error', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      this.logger.log('Redis Client Connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      this.logger.log('Redis Client Ready');
      this.isConnected = true;
    });

    this.client.on('end', () => {
      this.logger.warn('Redis Client Disconnected');
      this.isConnected = false;
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Redis cache service initialized');
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error.stack);
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    } catch (error) {
      this.logger.error('Error closing Redis connection', error.stack);
    }
  }

  /**
   * Generate cache key with prefix
   */
  private generateKey(key: string, prefix?: string): string {
    return prefix ? `${prefix}:${key}` : key;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options?: CacheOptions): Promise<T | null> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, cache miss');
      return null;
    }

    try {
      const fullKey = this.generateKey(key, options?.prefix);
      const value = await this.client.get(fullKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, skipping cache set');
      return;
    }

    try {
      const fullKey = this.generateKey(key, options?.prefix);
      const ttl = options?.ttl || this.DEFAULT_TTL;

      await this.client.setEx(fullKey, ttl, JSON.stringify(value));
    } catch (error) {
      this.logger.error(`Error setting cache key ${key}:`, error.message);
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string, options?: CacheOptions): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      const fullKey = this.generateKey(key, options?.prefix);
      await this.client.del(fullKey);
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key}:`, error.message);
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delByPattern(pattern: string): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        this.logger.log(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting keys by pattern ${pattern}:`, error.message);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string, options?: CacheOptions): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const fullKey = this.generateKey(key, options?.prefix);
      const exists = await this.client.exists(fullKey);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Error checking cache key ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Get or set with function (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      this.logger.debug(`Cache HIT: ${key}`);
      return cached;
    }

    this.logger.debug(`Cache MISS: ${key}`);

    // Fetch from source
    const value = await fetchFn();

    // Store in cache
    await this.set(key, value, options);

    return value;
  }

  /**
   * Invalidate all search caches
   */
  async invalidateSearchCaches(): Promise<void> {
    await this.delByPattern('search:*');
    await this.delByPattern('category:search:*');
    await this.delByPattern('topic:search:*');
  }

  /**
   * Invalidate category-related caches
   */
  async invalidateCategoryCaches(categoryId?: number): Promise<void> {
    if (categoryId) {
      await this.delByPattern(`category:${categoryId}:*`);
      await this.delByPattern(`category:words:${categoryId}:*`);
    } else {
      await this.delByPattern('category:*');
    }
  }

  /**
   * Invalidate topic-related caches
   */
  async invalidateTopicCaches(topic?: string): Promise<void> {
    if (topic) {
      await this.delByPattern(`topic:${topic}:*`);
    } else {
      await this.delByPattern('topic:*');
    }
  }

  /**
   * Invalidate word-related caches
   */
  async invalidateWordCaches(word?: string): Promise<void> {
    if (word) {
      await this.del(`word:${word}`);
      await this.delByPattern(`search:${word}*`);
    } else {
      await this.delByPattern('word:*');
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    dbSize: number;
    memoryUsed: string;
    hitRate?: number;
  }> {
    if (!this.isConnected) {
      return {
        connected: false,
        dbSize: 0,
        memoryUsed: '0',
      };
    }

    try {
      const dbSize = await this.client.dbSize();
      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsed = memoryMatch ? memoryMatch[1].trim() : '0';

      const statsInfo = await this.client.info('stats');
      const hitsMatch = statsInfo.match(/keyspace_hits:(\d+)/);
      const missesMatch = statsInfo.match(/keyspace_misses:(\d+)/);

      let hitRate: number | undefined;
      if (hitsMatch && missesMatch) {
        const hits = parseInt(hitsMatch[1], 10);
        const misses = parseInt(missesMatch[1], 10);
        const total = hits + misses;
        hitRate = total > 0 ? (hits / total) * 100 : 0;
      }

      return {
        connected: true,
        dbSize,
        memoryUsed,
        hitRate,
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error.message);
      return {
        connected: this.isConnected,
        dbSize: 0,
        memoryUsed: '0',
      };
    }
  }

  /**
   * Clear all caches
   */
  async flushAll(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.flushAll();
      this.logger.log('All cache cleared');
    } catch (error) {
      this.logger.error('Error flushing cache:', error.message);
    }
  }

  // TTL Getters
  getSearchTTL(): number {
    return this.SEARCH_TTL;
  }

  getCategoryTTL(): number {
    return this.CATEGORY_TTL;
  }

  getWordDetailTTL(): number {
    return this.WORD_DETAIL_TTL;
  }

  getTopicTTL(): number {
    return this.TOPIC_TTL;
  }
}
