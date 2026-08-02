import { DataSource } from 'typeorm';
import { Word } from '../../src/dictionary/entities/word.entity';
import { Definition } from '../../src/dictionary/entities/definition.entity';
import { Example } from '../../src/dictionary/entities/example.entity';
import { Pronunciation } from '../../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../../src/dictionary/entities/word-form.entity';
import { Synonym } from '../../src/dictionary/entities/synonym.entity';
// Word has a OneToOne to LearnerEntry, and that graph reaches the rest of the
// learner overlay. TypeORM resolves relation metadata eagerly, so omitting any
// of them makes every query fail with "Entity metadata for Word#learnerEntry
// was not found" — the connector could not run at all before this.
import { LearnerEntry } from '../../src/dictionary/entities/learner-entry.entity';
import { LearnerSense } from '../../src/dictionary/entities/learner-sense.entity';
import { LearnerSenseTranslation } from '../../src/dictionary/entities/learner-sense-translation.entity';
import { LearnerExample } from '../../src/dictionary/entities/learner-example.entity';
import { LearnerPronunciation } from '../../src/dictionary/entities/learner-pronunciation.entity';
import { config } from './config';
import type { TranslationItem, ExampleItem } from './types';

export class DbConnector {
  /** Keep identical to CJK_RE in src/dictionary/dictionary-quality.ts. */
  private static readonly PG_CJK =
    `('[' || chr(12288) || '-' || chr(12351) || chr(13312) || '-' || chr(19903) ||` +
    ` chr(19968) || '-' || chr(40959) || chr(63744) || '-' || chr(64255) ||` +
    ` chr(65280) || '-' || chr(65519) || ']')`;

  private dataSource: DataSource;

  constructor() {
    this.dataSource = new DataSource({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      entities: [
        Word, Definition, Example, Pronunciation, WordForm, Synonym,
        LearnerEntry, LearnerSense, LearnerSenseTranslation,
        LearnerExample, LearnerPronunciation,
      ],
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
   * Fetch definitions whose Vietnamese is contaminated with CJK.
   *
   * The NULL-targeted fetcher above cannot reach these: their Vietnamese is
   * present, just wrong. Ordering falls through to def.id because
   * words.frequency_rank is null on every row, making the rank ordering inert.
   */
  async fetchCjkContaminatedDefinitions(
    limit: number,
    excludeIds: Set<number>,
    specificWord?: string | null,
  ): Promise<TranslationItem[]> {
    const qb = this.dataSource
      .getRepository(Definition)
      .createQueryBuilder('def')
      .leftJoinAndSelect('def.word', 'word')
      .where(`'vi_contains_cjk' = ANY(def.quality_flags)`)
      .andWhere('def.definitionVi IS NOT NULL')
      .andWhere('def.definitionEn IS NOT NULL')
      .orderBy('def.id', 'ASC');

    if (specificWord) {
      qb.andWhere('LOWER(word.word) = :word', { word: specificWord.toLowerCase() });
    }

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
   * Fetch examples whose Vietnamese is contaminated with CJK.
   */
  async fetchCjkContaminatedExamples(
    limit: number,
    excludeIds: Set<number>,
    specificWord?: string | null,
  ): Promise<ExampleItem[]> {
    const qb = this.dataSource
      .getRepository(Example)
      .createQueryBuilder('ex')
      .leftJoinAndSelect('ex.definition', 'def')
      .leftJoinAndSelect('def.word', 'word')
      .where(`'vi_contains_cjk' = ANY(ex.quality_flags)`)
      .andWhere('ex.exampleVi IS NOT NULL')
      .andWhere('ex.exampleEn IS NOT NULL')
      .orderBy('ex.id', 'ASC');

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

    // The flag recompute MUST happen in the same statement as the text write.
    // Previously quality_flags was left untouched, so a repaired row kept
    // vi_contains_cjk: the candidate count never fell, the run could not
    // terminate, --reset re-paid for finished rows, and dictionary-presenter
    // kept suppressing the row via isUnsafeVietnamese, so no user ever saw the
    // repair. English-derived flags are preserved; only the Vietnamese-derived
    // ones are rebuilt, from the NEW text.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "definitions" d
            SET "definition_vi"      = v.vi,
                "review_status"      = 'raw',
                "is_learner_visible" = false,
                "quality_flags"      =
                  ARRAY(SELECT f FROM unnest(d."quality_flags") f
                         WHERE f IN ('raw_markup','empty_definition'))
                  || ARRAY(SELECT f FROM (
                       SELECT 'missing_vi' AS f      WHERE btrim(v.vi) = ''
                       UNION ALL SELECT 'vi_contains_cjk' WHERE v.vi ~ ${DbConnector.PG_CJK}
                       UNION ALL SELECT 'vi_equals_en'
                         WHERE lower(btrim(v.vi)) = lower(btrim(d."definition_en"))
                     ) s)
           FROM (SELECT * FROM unnest($1::bigint[], $2::text[]) AS t(id, vi)) v
          WHERE d."id" = v.id`,
        [updates.map((u) => u.id), updates.map((u) => u.vi)],
      );
    });
  }

  /**
   * Batch update example_vi for multiple examples.
   */
  async updateExampleVietnamese(updates: { id: number; vi: string }[]): Promise<void> {
    if (updates.length === 0) return;

    // Same atomic recompute as definitions. example_too_long is English-derived
    // and must survive the Vietnamese rewrite.
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "examples" e
            SET "example_vi"         = v.vi,
                "review_status"      = 'raw',
                "is_learner_visible" = false,
                "quality_flags"      =
                  ARRAY(SELECT f FROM unnest(e."quality_flags") f
                         WHERE f IN ('raw_markup','empty_definition','example_too_long'))
                  || ARRAY(SELECT f FROM (
                       SELECT 'missing_vi' AS f      WHERE btrim(v.vi) = ''
                       UNION ALL SELECT 'vi_contains_cjk' WHERE v.vi ~ ${DbConnector.PG_CJK}
                       UNION ALL SELECT 'vi_equals_en'
                         WHERE lower(btrim(v.vi)) = lower(btrim(e."example_en"))
                     ) s)
           FROM (SELECT * FROM unnest($1::bigint[], $2::text[]) AS t(id, vi)) v
          WHERE e."id" = v.id`,
        [updates.map((u) => u.id), updates.map((u) => u.vi)],
      );
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
