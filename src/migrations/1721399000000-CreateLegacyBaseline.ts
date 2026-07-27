import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the schema that predates the versioned mobile/learner migrations.
 *
 * The original application used TypeORM synchronization, so established
 * databases already contain these tables but a fresh production database does
 * not. Every operation is adoptive (`IF NOT EXISTS`) so recording this
 * migration is safe for both cases.
 */
export class CreateLegacyBaseline1721399000000
  implements MigrationInterface
{
  name = 'CreateLegacyBaseline1721399000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL UNIQUE,
        "name" varchar(255) NOT NULL,
        "password" varchar(255) NOT NULL,
        "avatar" varchar(255),
        "role" varchar NOT NULL DEFAULT 'user',
        "isActive" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "words" (
        "id" bigserial PRIMARY KEY,
        "word" varchar(255) NOT NULL UNIQUE,
        "language" varchar(10) NOT NULL DEFAULT 'en',
        "word_normalized" varchar(255) NOT NULL,
        "frequency_rank" integer,
        "part_of_speech" text[],
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_words_normalized" ON "words" ("word_normalized")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "definitions" (
        "id" bigserial PRIMARY KEY,
        "word_id" bigint NOT NULL,
        "part_of_speech" varchar(50) NOT NULL,
        "definition_en" text NOT NULL,
        "definition_vi" text,
        "level" varchar(20) NOT NULL DEFAULT 'intermediate',
        "definition_order" integer NOT NULL DEFAULT 1,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_definitions_word"
          FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_definitions_word" ON "definitions" ("word_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "examples" (
        "id" bigserial PRIMARY KEY,
        "definition_id" bigint NOT NULL,
        "example_en" text NOT NULL,
        "example_vi" text,
        "source" varchar(255),
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_examples_definition"
          FOREIGN KEY ("definition_id") REFERENCES "definitions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_examples_definition" ON "examples" ("definition_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pronunciations" (
        "id" bigserial PRIMARY KEY,
        "word_id" bigint NOT NULL,
        "accent" varchar(10) NOT NULL,
        "ipa" text NOT NULL,
        "audio_url" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_pronunciations_word"
          FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pronunciations_word" ON "pronunciations" ("word_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "word_forms" (
        "id" bigserial PRIMARY KEY,
        "word_id" bigint NOT NULL,
        "form_type" varchar(50) NOT NULL,
        "form_word" varchar(255) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_word_forms_word"
          FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_word_forms_word" ON "word_forms" ("word_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "synonyms" (
        "id" bigserial PRIMARY KEY,
        "word_id" bigint NOT NULL,
        "synonym_word" varchar(255) NOT NULL,
        "similarity_score" numeric(3, 2),
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_synonyms_word"
          FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_synonyms_word" ON "synonyms" ("word_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "categories" (
        "id" bigserial PRIMARY KEY,
        "name" varchar(255) NOT NULL UNIQUE,
        "display_name" varchar(255) NOT NULL,
        "description" text,
        "icon" varchar(100),
        "topic" varchar(100) NOT NULL,
        "display_order" integer NOT NULL DEFAULT 0,
        "parent_id" bigint,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_categories_parent"
          FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_categories_topic" ON "categories" ("topic", "display_order")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "category_words" (
        "id" bigserial PRIMARY KEY,
        "category_id" bigint NOT NULL,
        "word_id" bigint NOT NULL,
        "display_order" integer NOT NULL DEFAULT 0,
        "added_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_category_words_category_word" UNIQUE ("category_id", "word_id"),
        CONSTRAINT "FK_category_words_category"
          FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_category_words_word"
          FOREIGN KEY ("word_id") REFERENCES "words"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_category_words_order" ON "category_words" ("category_id", "display_order")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "word_lists" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "word" varchar(255) NOT NULL,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_word_lists_user_word" UNIQUE ("user_id", "word"),
        CONSTRAINT "FK_word_lists_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verbal_mapping_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "word_list_id" uuid,
        "source_words" jsonb NOT NULL,
        "num_sentences" integer NOT NULL,
        "difficulty" varchar(16) NOT NULL,
        "sentences" jsonb NOT NULL,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        "total_score" numeric(5, 2),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_verbal_mapping_sessions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_verbal_mapping_sessions_user" ON "verbal_mapping_sessions" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verbal_mapping_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "session_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "sentence_index" integer NOT NULL,
        "vi_sentence" text NOT NULL,
        "target_words" jsonb NOT NULL,
        "transcript" text NOT NULL,
        "verdict" varchar(16) NOT NULL,
        "score" integer NOT NULL,
        "feedback" text NOT NULL,
        "suggested_answer" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_verbal_mapping_attempt_sentence"
          UNIQUE ("session_id", "sentence_index"),
        CONSTRAINT "FK_verbal_mapping_attempts_session"
          FOREIGN KEY ("session_id") REFERENCES "verbal_mapping_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_verbal_mapping_attempts_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_verbal_mapping_attempts_session" ON "verbal_mapping_attempts" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_verbal_mapping_attempts_user" ON "verbal_mapping_attempts" ("user_id")`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally adopt-only. Dropping these tables could destroy a legacy
    // database that existed before migrations were introduced.
  }
}
