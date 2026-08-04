import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DSD_DATA_SOURCE } from './dsd-corpus.module';

/**
 * Reads published DSD content, and only that.
 *
 * Every query in this file names a `dsd_serving_*` view. That is not a
 * convention to remember — the `dsd_app` role has been revoked from all nine
 * base tables, so a query against `dsd_senses` fails with a permission error
 * rather than returning drafts. This service could not leak an unreviewed row
 * if it tried.
 *
 * Two other absences are deliberate. There is no generation of any kind here: a
 * missing translation makes an entry incomplete, and the honest answer to an
 * incomplete entry is to serve nothing. And there is no legacy connection — the
 * only data source injected is DSD's, so there is no fallback to fall back to.
 */

/** A complete DSD entry, as the serving views expose it. */
export interface DsdEntryRow {
  id: string;
  headword: string;
  headwordNormalized: string;
  language: string;
  updatedAt: Date;
}

export interface DsdRelationRow {
  relationType: string;
  /** The related sense, and the headword a client would show for it. */
  relatedSenseId: string;
  relatedHeadword: string;
}

export interface DsdSenseRow {
  id: string;
  senseOrder: number;
  partOfSpeech: string;
  definitionEn: string;
  usageLabels: string[];
  translations: Array<{ id: string; locale: string; text: string }>;
  examples: Array<{ id: string; exampleOrder: number; exampleEn: string; exampleVi: string }>;
  /**
   * Published DSD relations only. Absent relations are normal — most senses
   * have none — so this never affects completeness.
   */
  relations: DsdRelationRow[];
}

export interface DsdPronunciationRow {
  id: string;
  accent: string;
  ipa: string;
  priority: number;
  audio: Array<{ storageKey: string; mediaType: string; format: string; durationMs: number }>;
}

export interface DsdEntryAggregate {
  entry: DsdEntryRow;
  senses: DsdSenseRow[];
  pronunciations: DsdPronunciationRow[];
}

export interface DsdSearchHit {
  id: string;
  headword: string;
  partOfSpeech: string;
  definitionEn: string;
  translationVi: string | null;
}

const ENTRY_SQL = `
  SELECT e."id", e."headword", e."headword_normalized" AS "headwordNormalized",
         e."language", e."updated_at" AS "updatedAt"
    FROM dsd_serving_entries e
   WHERE ($1::uuid IS NOT NULL AND e."id" = $1::uuid)
      OR ($2::varchar IS NOT NULL AND e."headword_normalized" = $2)
   LIMIT 1`;

/**
 * Senses with their translations and examples, assembled in the database.
 *
 * One round trip rather than three, and the aggregation happens where the
 * status filters already are — so a partially published sense cannot be
 * reassembled in application code from separately fetched pieces.
 */
const SENSES_SQL = `
  SELECT s."id", s."sense_order" AS "senseOrder", s."part_of_speech" AS "partOfSpeech",
         s."definition_en" AS "definitionEn", s."usage_labels" AS "usageLabels",
         COALESCE((
           SELECT json_agg(json_build_object('id', t."id", 'locale', t."locale", 'text', t."text")
                           ORDER BY t."locale")
             FROM dsd_serving_translations t WHERE t."dsd_sense_id" = s."id"
         ), '[]'::json) AS "translations",
         COALESCE((
           SELECT json_agg(json_build_object('id', x."id", 'exampleOrder', x."example_order",
                                             'exampleEn', x."example_en", 'exampleVi', x."example_vi")
                           ORDER BY x."example_order")
             FROM dsd_serving_examples x WHERE x."dsd_sense_id" = s."id"
         ), '[]'::json) AS "examples",
         COALESCE((
           SELECT json_agg(json_build_object('relationType', r."relation_type",
                                             'relatedSenseId', r."related_sense_id",
                                             'relatedHeadword', re."headword")
                           ORDER BY r."relation_type", re."headword")
             FROM dsd_serving_relations r
             JOIN dsd_serving_senses rs ON rs."id" = r."related_sense_id"
             JOIN dsd_serving_entries re ON re."id" = rs."dsd_entry_id"
            WHERE r."sense_id" = s."id"
         ), '[]'::json) AS "relations"
    FROM dsd_serving_senses s
   WHERE s."dsd_entry_id" = $1
   ORDER BY s."sense_order"`;

const PRONUNCIATIONS_SQL = `
  SELECT p."id", p."accent", p."ipa", p."priority",
         COALESCE((
           SELECT json_agg(json_build_object('storageKey', a."storage_key",
                                             'mediaType', a."media_type",
                                             'format', a."format",
                                             'durationMs', a."duration_ms")
                           ORDER BY a."format")
             FROM dsd_servable_audio a
            WHERE a."input_kind" = 'pronunciation' AND a."input_record_id" = p."id"
         ), '[]'::json) AS "audio"
    FROM dsd_serving_pronunciations p
   WHERE p."dsd_entry_id" = $1
   ORDER BY p."priority"`;

const SEARCH_SQL = `
  SELECT e."id", e."headword", s."part_of_speech" AS "partOfSpeech",
         s."definition_en" AS "definitionEn",
         (SELECT t."text" FROM dsd_serving_translations t
           WHERE t."dsd_sense_id" = s."id" AND t."locale" = 'vi'
           ORDER BY t."id" LIMIT 1) AS "translationVi"
    FROM dsd_serving_entries e
    JOIN dsd_serving_senses s ON s."dsd_entry_id" = e."id"
   WHERE e."headword_normalized" LIKE $1 || '%'
   ORDER BY length(e."headword_normalized"), e."headword_normalized", s."sense_order"
   LIMIT $2`;

/** Requirements for an entry to be servable at all. */
export interface CompletenessProblem {
  field: string;
  detail: string;
}

/**
 * Why an entry may not be served.
 *
 * An entry missing its Vietnamese, its examples or its IPA is incomplete, and a
 * dictionary that shows an English definition with no translation is not the
 * product. Serving a partial entry would also make the corpus look larger than
 * it is, which is the kind of number that ends up in a contract.
 */
export function completenessProblems(aggregate: DsdEntryAggregate): CompletenessProblem[] {
  const problems: CompletenessProblem[] = [];

  if (aggregate.senses.length === 0) {
    problems.push({ field: 'senses', detail: 'no published sense' });
  }
  for (const sense of aggregate.senses) {
    const where = `sense ${sense.senseOrder}`;
    if (!sense.translations.some((translation) => translation.locale === 'vi')) {
      problems.push({ field: 'translation', detail: `${where} has no published Vietnamese` });
    }
    if (sense.examples.length === 0) {
      problems.push({ field: 'examples', detail: `${where} has no published example` });
    }
  }
  if (aggregate.pronunciations.length === 0) {
    problems.push({ field: 'ipa', detail: 'no published pronunciation' });
  }

  return problems;
}

@Injectable()
export class DsdQueryService {
  private readonly logger = new Logger(DsdQueryService.name);

  constructor(
    @Optional() @Inject(DSD_DATA_SOURCE) private readonly dataSource: DataSource | null,
  ) {}

  /** True when DSD is connected. False on the `off` channel. */
  get available(): boolean {
    return this.dataSource !== null;
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    if (!this.dataSource) {
      // Not an error: the `off` channel intentionally has no connection, and the
      // caller turns an empty result into a 404 rather than a fallback.
      return [];
    }
    return this.dataSource.query(sql, params);
  }

  /** Resolve by DSD UUID or normalized headword. Never by legacy integer id. */
  async findEntry(identifier: string): Promise<DsdEntryAggregate | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier,
    );
    const normalized = identifier.trim().toLowerCase();

    const entries = await this.query<DsdEntryRow>(ENTRY_SQL, [
      isUuid ? identifier : null,
      isUuid ? null : normalized,
    ]);
    if (entries.length === 0) return null;

    const entry = entries[0];
    const [senses, pronunciations] = await Promise.all([
      this.query<DsdSenseRow>(SENSES_SQL, [entry.id]),
      this.query<DsdPronunciationRow>(PRONUNCIATIONS_SQL, [entry.id]),
    ]);

    return { entry, senses, pronunciations };
  }

  /**
   * A complete entry, or null.
   *
   * The distinction matters: `findEntry` is what exists, this is what may be
   * served. Callers that serve content use this one.
   */
  async findCompleteEntry(identifier: string): Promise<DsdEntryAggregate | null> {
    const aggregate = await this.findEntry(identifier);
    if (!aggregate) return null;

    const problems = completenessProblems(aggregate);
    if (problems.length > 0) {
      this.logger.debug(
        `DSD entry '${aggregate.entry.headword}' is published but incomplete: ` +
          problems.map((problem) => problem.detail).join('; '),
      );
      return null;
    }
    return aggregate;
  }

  async search(query: string, limit = 20): Promise<DsdSearchHit[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return this.query<DsdSearchHit>(SEARCH_SQL, [normalized, Math.min(Math.max(limit, 1), 100)]);
  }
}
