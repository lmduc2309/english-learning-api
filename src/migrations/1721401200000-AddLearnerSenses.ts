import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Adds a curated learner-content overlay without modifying the imported raw
 * dictionary tables. Publication and approval states are kept separate so a
 * reviewed English sense never implicitly approves its Vietnamese translation,
 * examples, or pronunciations.
 */
export class AddLearnerSenses1721401200000 implements MigrationInterface {
  name = 'AddLearnerSenses1721401200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const learnerTables = [
      'learner_entries',
      'learner_senses',
      'learner_sense_translations',
      'learner_examples',
      'learner_pronunciations',
    ];
    const existingTables = (
      await Promise.all(
        learnerTables.map(async (tableName) => ({
          tableName,
          exists: await queryRunner.hasTable(tableName),
        })),
      )
    ).filter(({ exists }) => exists);

    // Development uses TypeORM synchronization, so a running dev server can
    // create the complete entity schema before the migration is recorded. In
    // that case adopt it only after a strict structural check. A partial or old
    // denormalized schema is never accepted silently.
    if (existingTables.length > 0) {
      if (existingTables.length !== learnerTables.length) {
        throw new Error(
          `Refusing to adopt a partial learner schema. Found: ${existingTables
            .map(({ tableName }) => tableName)
            .join(', ')}`,
        );
      }
      await this.assertExistingSchema(queryRunner);
      return;
    }

    await queryRunner.query(`
      CREATE TABLE "learner_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "word_id" bigint NOT NULL,
        "learner_rank" integer,
        "learner_band" varchar(24),
        "rank_source" varchar(80),
        "rank_source_version" varchar(40),
        "rank_source_url" text,
        "rank_source_license" varchar(80),
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_learner_entry_word" FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_learner_entry_word" UNIQUE ("word_id"),
        CONSTRAINT "CHK_learner_entry_rank" CHECK ("learner_rank" IS NULL OR "learner_rank" > 0),
        CONSTRAINT "CHK_learner_entry_rank_provenance" CHECK (
          "learner_rank" IS NULL OR (
            "rank_source" IS NOT NULL AND length(btrim("rank_source")) > 0 AND
            "rank_source_version" IS NOT NULL AND length(btrim("rank_source_version")) > 0 AND
            "rank_source_license" IS NOT NULL AND length(btrim("rank_source_license")) > 0
          )
        ),
        CONSTRAINT "CHK_learner_entry_status" CHECK ("status" IN ('draft', 'published', 'retired')),
        CONSTRAINT "CHK_learner_entry_band" CHECK ("learner_band" IS NULL OR length(btrim("learner_band")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_entry_publication"
      ON "learner_entries" ("status", "learner_rank")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_entry_band"
      ON "learner_entries" ("learner_band", "learner_rank")
    `);

    await queryRunner.query(`
      CREATE TABLE "learner_senses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "learner_entry_id" uuid NOT NULL,
        "source_definition_id" bigint,
        "sense_key" varchar(255) NOT NULL,
        "sense_order" smallint NOT NULL,
        "part_of_speech" varchar(50) NOT NULL,
        "definition_en" text NOT NULL,
        "cefr_level" varchar(2),
        "cefr_source" varchar(80),
        "cefr_source_url" text,
        "cefr_source_version" varchar(40),
        "cefr_source_license" varchar(80),
        "cefr_basis" varchar(40),
        "cefr_confidence" real,
        "usage_labels" text[] NOT NULL DEFAULT '{}',
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "definition_source" varchar(80) NOT NULL,
        "definition_source_url" text,
        "definition_source_license" varchar(80) NOT NULL,
        "review_notes" text,
        "reviewed_by" varchar(255),
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_learner_sense_entry" FOREIGN KEY ("learner_entry_id") REFERENCES "learner_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_learner_sense_source_definition" FOREIGN KEY ("source_definition_id") REFERENCES "definitions"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_learner_sense_entry_key" UNIQUE ("learner_entry_id", "sense_key"),
        CONSTRAINT "UQ_learner_sense_entry_order" UNIQUE ("learner_entry_id", "sense_order"),
        CONSTRAINT "CHK_learner_sense_key" CHECK (length(btrim("sense_key")) > 0),
        CONSTRAINT "CHK_learner_sense_order" CHECK ("sense_order" > 0),
        CONSTRAINT "CHK_learner_sense_pos" CHECK (length(btrim("part_of_speech")) > 0),
        CONSTRAINT "CHK_learner_sense_definition" CHECK (length(btrim("definition_en")) > 0),
        CONSTRAINT "CHK_learner_sense_cefr" CHECK ("cefr_level" IS NULL OR "cefr_level" IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        CONSTRAINT "CHK_learner_sense_cefr_source" CHECK (
          "cefr_level" IS NULL OR ("cefr_source" IS NOT NULL AND length(btrim("cefr_source")) > 0)
        ),
        CONSTRAINT "CHK_learner_sense_cefr_provenance" CHECK (
          "cefr_level" IS NULL OR (
            "cefr_source_url" IS NOT NULL AND length(btrim("cefr_source_url")) > 0 AND
            "cefr_source_version" IS NOT NULL AND length(btrim("cefr_source_version")) > 0 AND
            "cefr_source_license" IS NOT NULL AND length(btrim("cefr_source_license")) > 0 AND
            "cefr_basis" IS NOT NULL AND length(btrim("cefr_basis")) > 0
          )
        ),
        CONSTRAINT "CHK_learner_sense_cefr_confidence" CHECK ("cefr_confidence" IS NULL OR ("cefr_confidence" >= 0 AND "cefr_confidence" <= 1)),
        CONSTRAINT "CHK_learner_sense_status" CHECK ("status" IN ('draft', 'published', 'retired')),
        CONSTRAINT "CHK_learner_sense_source" CHECK (length(btrim("definition_source")) > 0),
        CONSTRAINT "CHK_learner_sense_license" CHECK (length(btrim("definition_source_license")) > 0),
        CONSTRAINT "CHK_learner_sense_published_review" CHECK (
          "status" <> 'published' OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_sense_publication"
      ON "learner_senses" ("learner_entry_id", "status", "sense_order")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_sense_cefr"
      ON "learner_senses" ("cefr_level", "sense_order")
      WHERE "status" = 'published'
    `);

    await queryRunner.query(`
      CREATE TABLE "learner_sense_translations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "learner_sense_id" uuid NOT NULL,
        "locale" varchar(10) NOT NULL DEFAULT 'vi',
        "text" text NOT NULL,
        "method" varchar(40) NOT NULL,
        "source" varchar(80) NOT NULL,
        "source_url" text,
        "source_license" varchar(80) NOT NULL,
        "confidence" real,
        "review_status" varchar(24) NOT NULL DEFAULT 'draft',
        "reviewed_by" varchar(255),
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_learner_translation_sense" FOREIGN KEY ("learner_sense_id") REFERENCES "learner_senses"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_learner_translation_sense_locale" UNIQUE ("learner_sense_id", "locale"),
        CONSTRAINT "CHK_learner_translation_locale" CHECK (length(btrim("locale")) > 0),
        CONSTRAINT "CHK_learner_translation_text" CHECK (length(btrim("text")) > 0),
        CONSTRAINT "CHK_learner_translation_method" CHECK (length(btrim("method")) > 0),
        CONSTRAINT "CHK_learner_translation_source" CHECK (length(btrim("source")) > 0),
        CONSTRAINT "CHK_learner_translation_license" CHECK (length(btrim("source_license")) > 0),
        CONSTRAINT "CHK_learner_translation_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
        CONSTRAINT "CHK_learner_translation_status" CHECK ("review_status" IN ('draft', 'in_review', 'approved', 'rejected')),
        CONSTRAINT "CHK_learner_translation_approved_review" CHECK (
          "review_status" <> 'approved' OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_translation_approved"
      ON "learner_sense_translations" ("learner_sense_id", "locale")
      WHERE "review_status" = 'approved'
    `);

    await queryRunner.query(`
      CREATE TABLE "learner_examples" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "learner_sense_id" uuid NOT NULL,
        "source_example_id" bigint,
        "example_order" smallint NOT NULL,
        "example_en" text NOT NULL,
        "example_vi" text NOT NULL,
        "review_status" varchar(24) NOT NULL DEFAULT 'draft',
        "source" varchar(80) NOT NULL,
        "source_url" text,
        "source_license" varchar(80) NOT NULL,
        "reviewed_by" varchar(255),
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_learner_example_sense" FOREIGN KEY ("learner_sense_id") REFERENCES "learner_senses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_learner_example_source" FOREIGN KEY ("source_example_id") REFERENCES "examples"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_learner_example_sense_order" UNIQUE ("learner_sense_id", "example_order"),
        CONSTRAINT "CHK_learner_example_order" CHECK ("example_order" > 0),
        CONSTRAINT "CHK_learner_example_en" CHECK (length(btrim("example_en")) > 0),
        CONSTRAINT "CHK_learner_example_vi" CHECK (length(btrim("example_vi")) > 0),
        CONSTRAINT "CHK_learner_example_source" CHECK (length(btrim("source")) > 0),
        CONSTRAINT "CHK_learner_example_license" CHECK (length(btrim("source_license")) > 0),
        CONSTRAINT "CHK_learner_example_status" CHECK ("review_status" IN ('draft', 'in_review', 'approved', 'rejected')),
        CONSTRAINT "CHK_learner_example_approved_review" CHECK (
          "review_status" <> 'approved' OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_example_approved"
      ON "learner_examples" ("learner_sense_id", "example_order")
      WHERE "review_status" = 'approved'
    `);

    await queryRunner.query(`
      CREATE TABLE "learner_pronunciations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "learner_entry_id" uuid NOT NULL,
        "accent" varchar(20) NOT NULL,
        "ipa" text NOT NULL,
        "priority" smallint NOT NULL DEFAULT 1,
        "source" varchar(80) NOT NULL,
        "source_url" text,
        "source_license" varchar(80) NOT NULL,
        "review_status" varchar(24) NOT NULL DEFAULT 'draft',
        "reviewed_by" varchar(255),
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_learner_pronunciation_entry" FOREIGN KEY ("learner_entry_id") REFERENCES "learner_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_learner_pronunciation_entry_accent_priority" UNIQUE ("learner_entry_id", "accent", "priority"),
        CONSTRAINT "CHK_learner_pronunciation_accent" CHECK (length(btrim("accent")) > 0),
        CONSTRAINT "CHK_learner_pronunciation_ipa" CHECK (length(btrim("ipa")) > 0),
        CONSTRAINT "CHK_learner_pronunciation_priority" CHECK ("priority" > 0),
        CONSTRAINT "CHK_learner_pronunciation_source" CHECK (length(btrim("source")) > 0),
        CONSTRAINT "CHK_learner_pronunciation_license" CHECK (length(btrim("source_license")) > 0),
        CONSTRAINT "CHK_learner_pronunciation_status" CHECK ("review_status" IN ('draft', 'in_review', 'approved', 'rejected')),
        CONSTRAINT "CHK_learner_pronunciation_approved_review" CHECK (
          "review_status" <> 'approved' OR (
            "reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_learner_pronunciation_approved"
      ON "learner_pronunciations" ("learner_entry_id", "accent", "priority")
      WHERE "review_status" = 'approved'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "learner_pronunciations"');
    await queryRunner.query('DROP TABLE "learner_examples"');
    await queryRunner.query('DROP TABLE "learner_sense_translations"');
    await queryRunner.query('DROP TABLE "learner_senses"');
    await queryRunner.query('DROP TABLE "learner_entries"');
  }

  private async assertExistingSchema(queryRunner: QueryRunner): Promise<void> {
    const requiredColumns: Record<string, string[]> = {
      learner_entries: [
        'id', 'word_id', 'learner_rank', 'learner_band', 'rank_source',
        'rank_source_version', 'rank_source_url', 'rank_source_license',
        'status', 'created_at', 'updated_at',
      ],
      learner_senses: [
        'id', 'learner_entry_id', 'source_definition_id', 'sense_key',
        'sense_order', 'part_of_speech', 'definition_en', 'cefr_level',
        'cefr_source', 'cefr_source_url', 'cefr_source_version',
        'cefr_source_license', 'cefr_basis', 'cefr_confidence',
        'usage_labels', 'status', 'definition_source',
        'definition_source_url', 'definition_source_license', 'review_notes',
        'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
      ],
      learner_sense_translations: [
        'id', 'learner_sense_id', 'locale', 'text', 'method', 'source',
        'source_url', 'source_license', 'confidence', 'review_status',
        'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
      ],
      learner_examples: [
        'id', 'learner_sense_id', 'source_example_id', 'example_order',
        'example_en', 'example_vi', 'review_status', 'source', 'source_url',
        'source_license', 'reviewed_by', 'reviewed_at', 'created_at',
        'updated_at',
      ],
      learner_pronunciations: [
        'id', 'learner_entry_id', 'accent', 'ipa', 'priority', 'source',
        'source_url', 'source_license', 'review_status', 'reviewed_by',
        'reviewed_at', 'created_at', 'updated_at',
      ],
    };
    const requiredChecks: Record<string, string[]> = {
      learner_entries: [
        'CHK_learner_entry_rank', 'CHK_learner_entry_rank_provenance',
        'CHK_learner_entry_status', 'CHK_learner_entry_band',
      ],
      learner_senses: [
        'CHK_learner_sense_key', 'CHK_learner_sense_order',
        'CHK_learner_sense_pos', 'CHK_learner_sense_definition',
        'CHK_learner_sense_cefr', 'CHK_learner_sense_cefr_source',
        'CHK_learner_sense_cefr_provenance',
        'CHK_learner_sense_cefr_confidence', 'CHK_learner_sense_status',
        'CHK_learner_sense_source', 'CHK_learner_sense_license',
        'CHK_learner_sense_published_review',
      ],
      learner_sense_translations: [
        'CHK_learner_translation_locale', 'CHK_learner_translation_text',
        'CHK_learner_translation_method', 'CHK_learner_translation_source',
        'CHK_learner_translation_license',
        'CHK_learner_translation_confidence',
        'CHK_learner_translation_status',
        'CHK_learner_translation_approved_review',
      ],
      learner_examples: [
        'CHK_learner_example_order', 'CHK_learner_example_en',
        'CHK_learner_example_vi', 'CHK_learner_example_source',
        'CHK_learner_example_license', 'CHK_learner_example_status',
        'CHK_learner_example_approved_review',
      ],
      learner_pronunciations: [
        'CHK_learner_pronunciation_accent', 'CHK_learner_pronunciation_ipa',
        'CHK_learner_pronunciation_priority',
        'CHK_learner_pronunciation_source',
        'CHK_learner_pronunciation_license',
        'CHK_learner_pronunciation_status',
        'CHK_learner_pronunciation_approved_review',
      ],
    };
    const requiredIndexes: Record<string, string[]> = {
      learner_entries: ['IDX_learner_entry_publication', 'IDX_learner_entry_band'],
      learner_senses: ['IDX_learner_sense_publication', 'IDX_learner_sense_cefr'],
      learner_sense_translations: ['IDX_learner_translation_approved'],
      learner_examples: ['IDX_learner_example_approved'],
      learner_pronunciations: ['IDX_learner_pronunciation_approved'],
    };

    for (const [tableName, columns] of Object.entries(requiredColumns)) {
      const table = await queryRunner.getTable(tableName);
      if (!table) throw new Error(`Missing learner table: ${tableName}`);
      this.requireNames(tableName, 'columns', columns, table.columns.map(({ name }) => name));
      this.requireNames(tableName, 'checks', requiredChecks[tableName], table.checks.map(({ name }) => name));
      this.requireNames(tableName, 'indexes', requiredIndexes[tableName], table.indices.map(({ name }) => name));
    }

    const entries = await this.requireTable(queryRunner, 'learner_entries');
    const senses = await this.requireTable(queryRunner, 'learner_senses');
    const translations = await this.requireTable(queryRunner, 'learner_sense_translations');
    const examples = await this.requireTable(queryRunner, 'learner_examples');
    const pronunciations = await this.requireTable(queryRunner, 'learner_pronunciations');
    this.requireUnique(entries, ['word_id']);
    this.requireUnique(senses, ['learner_entry_id', 'sense_key']);
    this.requireUnique(senses, ['learner_entry_id', 'sense_order']);
    this.requireUnique(translations, ['learner_sense_id', 'locale']);
    this.requireUnique(examples, ['learner_sense_id', 'example_order']);
    this.requireUnique(pronunciations, ['learner_entry_id', 'accent', 'priority']);

    const requiredForeignKeys = [
      [entries, 'FK_learner_entry_word'],
      [senses, 'FK_learner_sense_entry'],
      [senses, 'FK_learner_sense_source_definition'],
      [translations, 'FK_learner_translation_sense'],
      [examples, 'FK_learner_example_sense'],
      [examples, 'FK_learner_example_source'],
      [pronunciations, 'FK_learner_pronunciation_entry'],
    ] as const;
    for (const [table, foreignKeyName] of requiredForeignKeys) {
      if (!table.foreignKeys.some(({ name }) => name === foreignKeyName)) {
        throw new Error(`Cannot adopt ${table.name}: missing foreign key ${foreignKeyName}`);
      }
    }
  }

  private async requireTable(queryRunner: QueryRunner, tableName: string): Promise<Table> {
    const table = await queryRunner.getTable(tableName);
    if (!table) throw new Error(`Missing learner table: ${tableName}`);
    return table;
  }

  private requireNames(
    tableName: string,
    kind: string,
    required: string[],
    actual: string[],
  ): void {
    const missing = required.filter((name) => !actual.includes(name));
    if (missing.length > 0) {
      throw new Error(`Cannot adopt ${tableName}: missing ${kind} ${missing.join(', ')}`);
    }
  }

  private requireUnique(table: Table, columns: string[]): void {
    const expected = [...columns].sort().join(',');
    const exists = table.uniques.some(
      (unique) => [...unique.columnNames].sort().join(',') === expected,
    );
    if (!exists) {
      throw new Error(`Cannot adopt ${table.name}: missing unique constraint on ${columns.join(', ')}`);
    }
  }
}
