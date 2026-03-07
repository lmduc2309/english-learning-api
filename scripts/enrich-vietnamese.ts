import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

/**
 * Vietnamese Translation Enrichment Script
 *
 * Translates missing definition_vi and example_vi fields in the database
 * using Google Translate free API.
 *
 * Usage:
 *   ts-node scripts/enrich-vietnamese.ts              # Translate all missing
 *   ts-node scripts/enrich-vietnamese.ts --dry-run     # Preview without saving
 *   ts-node scripts/enrich-vietnamese.ts --limit 100   # Limit to 100 definitions
 *   ts-node scripts/enrich-vietnamese.ts --word love   # Translate specific word only
 */

const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';

async function translateToVietnamese(text: string): Promise<string | null> {
  try {
    const response = await axios.get(GOOGLE_TRANSLATE_URL, {
      params: {
        client: 'gtx',
        sl: 'en',
        tl: 'vi',
        dt: 't',
        q: text,
      },
      timeout: 10000,
    });

    // Google Translate returns nested arrays: [[["translated","original",...],...],...]
    const data = response.data;
    if (data && data[0]) {
      const translated = data[0]
        .map((segment: any[]) => segment[0])
        .join('');
      return translated;
    }

    return null;
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log('  Rate limited, waiting 30s...');
      await sleep(30000);
      return translateToVietnamese(text); // Retry
    }
    console.error(`  Translation failed: ${error.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const wordIdx = args.indexOf('--word');
  const specificWord = wordIdx >= 0 ? args[wordIdx + 1] : null;

  console.log('Vietnamese Translation Enrichment Script');
  console.log('========================================');
  if (dryRun) console.log('  Mode: DRY RUN (no changes will be saved)');
  if (limit) console.log(`  Limit: ${limit} definitions`);
  if (specificWord) console.log(`  Word: ${specificWord}`);
  console.log('');

  // Connect to database
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    logging: false,
  });

  try {
    await dataSource.initialize();
    console.log('Connected to database.\n');

    const definitionRepo = dataSource.getRepository(Definition);
    const exampleRepo = dataSource.getRepository(Example);

    // === Step 1: Translate definitions ===
    console.log('Step 1: Translating definitions...');

    let defQuery = definitionRepo
      .createQueryBuilder('def')
      .leftJoinAndSelect('def.word', 'word')
      .where('def.definitionVi IS NULL')
      .andWhere('def.definitionEn IS NOT NULL')
      .orderBy('word.frequencyRank', 'ASC', 'NULLS LAST');

    if (specificWord) {
      defQuery = defQuery.andWhere('word.word = :word', { word: specificWord.toLowerCase() });
    }
    if (limit > 0) {
      defQuery = defQuery.limit(limit);
    }

    const defsToTranslate = await defQuery.getMany();
    console.log(`  Found ${defsToTranslate.length} definitions without Vietnamese translation.\n`);

    let defSuccess = 0;
    let defFail = 0;

    for (let i = 0; i < defsToTranslate.length; i++) {
      const def = defsToTranslate[i];
      const wordText = def.word?.word || `(word_id: ${def.wordId})`;
      const progress = `[${i + 1}/${defsToTranslate.length}]`;

      process.stdout.write(`  ${progress} "${wordText}" (${def.partOfSpeech}): `);

      const translated = await translateToVietnamese(def.definitionEn);
      if (translated) {
        console.log(translated);

        if (!dryRun) {
          await definitionRepo.update(def.id, { definitionVi: translated });
        }
        defSuccess++;
      } else {
        console.log('FAILED');
        defFail++;
      }

      // Rate limiting: 200ms between requests
      await sleep(200);
    }

    console.log(`\n  Definitions: ${defSuccess} translated, ${defFail} failed.\n`);

    // === Step 2: Translate examples ===
    console.log('Step 2: Translating examples...');

    let exQuery = exampleRepo
      .createQueryBuilder('ex')
      .leftJoinAndSelect('ex.definition', 'def')
      .leftJoinAndSelect('def.word', 'word')
      .where('ex.exampleVi IS NULL')
      .andWhere('ex.exampleEn IS NOT NULL')
      .orderBy('word.frequencyRank', 'ASC', 'NULLS LAST');

    if (specificWord) {
      exQuery = exQuery.andWhere('word.word = :word', { word: specificWord.toLowerCase() });
    }
    if (limit > 0) {
      exQuery = exQuery.limit(limit);
    }

    const examplesToTranslate = await exQuery.getMany();
    console.log(`  Found ${examplesToTranslate.length} examples without Vietnamese translation.\n`);

    let exSuccess = 0;
    let exFail = 0;

    for (let i = 0; i < examplesToTranslate.length; i++) {
      const ex = examplesToTranslate[i];
      const wordText = ex.definition?.word?.word || `(def_id: ${ex.definitionId})`;
      const progress = `[${i + 1}/${examplesToTranslate.length}]`;

      process.stdout.write(`  ${progress} "${wordText}": `);

      const translated = await translateToVietnamese(ex.exampleEn);
      if (translated) {
        console.log(translated);

        if (!dryRun) {
          await exampleRepo.update(ex.id, { exampleVi: translated });
        }
        exSuccess++;
      } else {
        console.log('FAILED');
        exFail++;
      }

      await sleep(200);
    }

    console.log(`\n  Examples: ${exSuccess} translated, ${exFail} failed.\n`);

    // === Summary ===
    console.log('========================================');
    console.log('Summary:');
    console.log(`  Definitions translated: ${defSuccess}/${defsToTranslate.length}`);
    console.log(`  Examples translated:    ${exSuccess}/${examplesToTranslate.length}`);
    if (dryRun) {
      console.log('\n  (DRY RUN - no changes were saved to the database)');
    }
    console.log('========================================');
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await dataSource.destroy();
    console.log('\nDisconnected from database.');
  }
}

main();
