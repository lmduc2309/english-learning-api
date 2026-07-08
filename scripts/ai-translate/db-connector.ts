import { DataSource } from 'typeorm';
import { Word } from '../../src/dictionary/entities/word.entity';
import { Definition } from '../../src/dictionary/entities/definition.entity';
import { Example } from '../../src/dictionary/entities/example.entity';
import { Pronunciation } from '../../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../../src/dictionary/entities/word-form.entity';
import { Synonym } from '../../src/dictionary/entities/synonym.entity';
import { config } from './config';
import type { TranslationItem, ExampleItem } from './types';

export class DbConnector {
  private dataSource: DataSource;

  constructor() {
    this.dataSource = new DataSource({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
      logging: false,
    });
  }

  async connect(): Promise<void> {
    await this.dataSource.initialize();
  }

  async disconnect(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  /**
   * Fetch definitions that have no Vietnamese translation yet.
   * Ordered by word frequency (most common first).
   * Optionally exclude already-done IDs (from progress tracker).
   */
  async fetchUntranslatedDefinitions(
    limit: number,
    excludeIds: Set<number>,
    specificWord?: string | null,
  ): Promise<TranslationItem[]> {
    const qb = this.dataSource
      .getRepository(Definition)
      .createQueryBuilder('def')
      .leftJoinAndSelect('def.word', 'word')
      .where('def.definitionVi IS NULL')
      .andWhere('def.definitionEn IS NOT NULL')
      .orderBy('word.frequencyRank', 'ASC', 'NULLS LAST')
      .addOrderBy('def.id', 'ASC');

    if (specificWord) {
      qb.andWhere('LOWER(word.word) = :word', { word: specificWord.toLowerCase() });
    }

    // Fetch more than limit to account for excluded IDs
    const fetchLimit = limit > 0 ? limit + excludeIds.size : 0;
    if (fetchLimit > 0) {
      qb.take(fetchLimit);
    }

    const defs = await qb.getMany();

    const items: TranslationItem[] = [];
    for (const def of defs) {
      if (excludeIds.has(def.id)) continue;
      if (limit > 0 && items.length >= limit) break;

      items.push({
        id: def.id,
        word: def.word?.word || '',
        pos: def.partOfSpeech || '',
        en: def.definitionEn,
      });
    }

    return items;
  }

  /**
   * Fetch examples that have no Vietnamese translation yet.
   */
  async fetchUntranslatedExamples(
    limit: number,
    excludeIds: Set<number>,
    specificWord?: string | null,
  ): Promise<ExampleItem[]> {
    const qb = this.dataSource
      .getRepository(Example)
      .createQueryBuilder('ex')
      .leftJoinAndSelect('ex.definition', 'def')
      .leftJoinAndSelect('def.word', 'word')
      .where('ex.exampleVi IS NULL')
      .andWhere('ex.exampleEn IS NOT NULL')
      .orderBy('word.frequencyRank', 'ASC', 'NULLS LAST')
      .addOrderBy('ex.id', 'ASC');

    if (specificWord) {
      qb.andWhere('LOWER(word.word) = :word', { word: specificWord.toLowerCase() });
    }

    const fetchLimit = limit > 0 ? limit + excludeIds.size : 0;
    if (fetchLimit > 0) {
      qb.take(fetchLimit);
    }

    const examples = await qb.getMany();

    const items: ExampleItem[] = [];
    for (const ex of examples) {
      if (excludeIds.has(ex.id)) continue;
      if (limit > 0 && items.length >= limit) break;

      items.push({
        id: ex.id,
        word: ex.definition?.word?.word || '',
        en: ex.exampleEn,
      });
    }

    return items;
  }

  /**
   * Batch update definition_vi for multiple definitions.
   */
  async updateDefinitionVietnamese(updates: { id: number; vi: string }[]): Promise<void> {
    if (updates.length === 0) return;

    const repo = this.dataSource.getRepository(Definition);
    await this.dataSource.transaction(async (manager) => {
      for (const update of updates) {
        await manager.getRepository(Definition).update(update.id, { definitionVi: update.vi });
      }
    });
  }

  /**
   * Batch update example_vi for multiple examples.
   */
  async updateExampleVietnamese(updates: { id: number; vi: string }[]): Promise<void> {
    if (updates.length === 0) return;

    await this.dataSource.transaction(async (manager) => {
      for (const update of updates) {
        await manager.getRepository(Example).update(update.id, { exampleVi: update.vi });
      }
    });
  }

  /**
   * Get total counts for reporting.
   */
  async getCounts(): Promise<{
    totalDefs: number;
    defsWithVi: number;
    totalExamples: number;
    examplesWithVi: number;
  }> {
    const defRepo = this.dataSource.getRepository(Definition);
    const exRepo = this.dataSource.getRepository(Example);

    const [totalDefs, defsWithVi, totalExamples, examplesWithVi] = await Promise.all([
      defRepo.count(),
      defRepo.count({ where: { definitionVi: undefined } }).then(
        // Count WHERE NOT NULL
        () =>
          defRepo
            .createQueryBuilder('d')
            .where('d.definitionVi IS NOT NULL')
            .getCount(),
      ),
      exRepo.count(),
      exRepo
        .createQueryBuilder('e')
        .where('e.exampleVi IS NOT NULL')
        .getCount(),
    ]);

    return { totalDefs, defsWithVi, totalExamples, examplesWithVi };
  }
}
