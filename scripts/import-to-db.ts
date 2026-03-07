import * as fs from 'fs';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ImportEntry {
  word: string;
  word_normalized: string;
  language: string;
  frequency_rank?: number;
  pronunciations: Array<{
    accent: string;
    ipa: string;
    audio_url?: string;
  }>;
  definitions: Array<{
    pos: string;
    definition_en: string;
    definition_vi?: string;
    level?: string;
    examples: Array<{
      en: string;
      vi?: string;
    }>;
  }>;
  synonyms?: string[];
  word_forms?: Record<string, string>;
}

/**
 * Database Importer
 *
 * Imports combined dictionary data into PostgreSQL database
 */
class DatabaseImporter {
  private dataSource: DataSource;
  private batchSize = 100;
  private importedCount = 0;
  private errorCount = 0;

  constructor() {
    this.dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'dictionary_user',
      password: process.env.DB_PASSWORD || 'dictionary_pass',
      database: process.env.DB_DATABASE || 'english_learning_db',
      entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
      synchronize: true, // Enable to auto-create tables
      logging: false,
    });
  }

  /**
   * Initialize database connection
   */
  async connect(): Promise<void> {
    console.log('Connecting to database...');
    await this.dataSource.initialize();
    console.log('Connected to database');
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    await this.dataSource.destroy();
    console.log('Disconnected from database');
  }

  /**
   * Import data from JSON file
   */
  async import(inputFile: string): Promise<void> {
    console.log(`\nImporting data from ${inputFile}...`);

    if (!fs.existsSync(inputFile)) {
      throw new Error(`File not found: ${inputFile}`);
    }

    const data: ImportEntry[] = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    console.log(`Loaded ${data.length} entries to import`);

    const totalBatches = Math.ceil(data.length / this.batchSize);

    // Process in batches
    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize);
      const currentBatch = Math.floor(i / this.batchSize) + 1;

      console.log(`\nProcessing batch ${currentBatch}/${totalBatches}...`);

      await this.importBatch(batch);

      console.log(`  Imported: ${this.importedCount} | Errors: ${this.errorCount}`);
    }

    console.log('\n=== Import Complete ===');
    console.log(`Successfully imported: ${this.importedCount} words`);
    console.log(`Errors: ${this.errorCount}`);
  }

  /**
   * Import a batch of entries
   */
  private async importBatch(entries: ImportEntry[]): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    for (const entry of entries) {
      await queryRunner.startTransaction();

      try {
        await this.importEntry(entry, queryRunner);
        await queryRunner.commitTransaction();
        this.importedCount++;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.errorCount++;
        console.error(`  Error importing "${entry.word}": ${error.message}`);
      }
    }

    await queryRunner.release();
  }

  /**
   * Import a single entry with all related data
   */
  private async importEntry(entry: ImportEntry, queryRunner: any): Promise<void> {
    // Check if word already exists
    let wordEntity = await queryRunner.manager.findOne(Word, {
      where: { word: entry.word },
    });

    if (wordEntity) {
      // Word exists, skip or update
      // For now, we'll skip to avoid duplicates
      return;
    }

    // Create word entity
    wordEntity = queryRunner.manager.create(Word, {
      word: entry.word,
      wordNormalized: entry.word_normalized || entry.word.toLowerCase(),
      language: entry.language || 'en',
      frequencyRank: entry.frequency_rank,
      partOfSpeech: entry.definitions?.map(d => d.pos) || [],
    });

    wordEntity = await queryRunner.manager.save(Word, wordEntity);

    // Import pronunciations
    if (entry.pronunciations && entry.pronunciations.length > 0) {
      for (const pron of entry.pronunciations) {
        const pronEntity = queryRunner.manager.create(Pronunciation, {
          wordId: wordEntity.id,
          accent: pron.accent,
          ipa: pron.ipa,
          audioUrl: pron.audio_url,
        });
        await queryRunner.manager.save(Pronunciation, pronEntity);
      }
    }

    // Import definitions and examples
    if (entry.definitions && entry.definitions.length > 0) {
      for (let i = 0; i < entry.definitions.length; i++) {
        const def = entry.definitions[i];

        const defEntity = queryRunner.manager.create(Definition, {
          wordId: wordEntity.id,
          partOfSpeech: def.pos,
          definitionEn: def.definition_en,
          definitionVi: def.definition_vi || null,
          level: def.level || 'intermediate',
          definitionOrder: i + 1,
        });

        const savedDef = await queryRunner.manager.save(Definition, defEntity);

        // Import examples
        if (def.examples && def.examples.length > 0) {
          for (const ex of def.examples) {
            const exEntity = queryRunner.manager.create(Example, {
              definitionId: savedDef.id,
              exampleEn: ex.en,
              exampleVi: ex.vi || null,
            });
            await queryRunner.manager.save(Example, exEntity);
          }
        }
      }
    }

    // Import word forms
    if (entry.word_forms && Object.keys(entry.word_forms).length > 0) {
      for (const [formType, formWord] of Object.entries(entry.word_forms)) {
        const formEntity = queryRunner.manager.create(WordForm, {
          wordId: wordEntity.id,
          formType,
          formWord: formWord as string,
        });
        await queryRunner.manager.save(WordForm, formEntity);
      }
    }

    // Import synonyms
    if (entry.synonyms && entry.synonyms.length > 0) {
      for (const syn of entry.synonyms) {
        const synEntity = queryRunner.manager.create(Synonym, {
          wordId: wordEntity.id,
          synonymWord: syn,
        });
        await queryRunner.manager.save(Synonym, synEntity);
      }
    }
  }

  /**
   * Clear all dictionary data from database
   * Use with caution!
   */
  async clearDatabase(): Promise<void> {
    console.log('WARNING: Clearing all dictionary data from database...');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Delete in correct order (respecting foreign keys)
      // Use TRUNCATE for better performance, with CASCADE to handle foreign keys
      await queryRunner.query('TRUNCATE TABLE examples, definitions, pronunciations, word_forms, synonyms, words CASCADE');

      await queryRunner.commitTransaction();
      console.log('Database cleared successfully');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error clearing database:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const clearFlag = args.includes('--clear');
  const inputFile = args.find(arg => !arg.startsWith('--')) || 'data/combined/dictionary.json';

  const importer = new DatabaseImporter();

  try {
    await importer.connect();

    if (clearFlag) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        readline.question('Are you sure you want to clear the database? (yes/no): ', resolve);
      });

      readline.close();

      if (answer.toLowerCase() === 'yes') {
        await importer.clearDatabase();
      } else {
        console.log('Database clear cancelled');
        await importer.disconnect();
        return;
      }
    }

    await importer.import(inputFile);
    await importer.disconnect();

    console.log('\n✓ Import completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Import failed:', error);
    await importer.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { DatabaseImporter };
