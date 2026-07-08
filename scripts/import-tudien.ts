/**
 * tudien Vietnamese enrichment.
 *
 * DATA: download the StarDict release and unzip into data/vietnamese-sources/tudien/:
 *   curl -L -o /tmp/tudien.zip \
 *     https://github.com/redphx/tudien/releases/download/v20260411/tudien-stardict-en-vi-20260411.zip
 *   mkdir -p data/vietnamese-sources/tudien && unzip -o /tmp/tudien.zip -d data/vietnamese-sources/tudien
 * (produces *.ifo, *.idx, *.dict.dz — the script reads them directly.)
 *
 * USAGE:
 *   npm run import-tudien:dry            # counts only, no writes
 *   npm run import-tudien -- --word run  # inspect a single word
 *   npm run import-tudien                # full run (overwrites definition_vi/example_vi)
 *   npm run import-tudien -- --fill-only # only fill NULLs
 *   npm run import-tudien -- --limit 100 # cap words processed
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import { loadTudien } from './tudien/stardict';
import { parseEntry } from './tudien/parse-entry';
import { planDefinitionUpdates, planExampleUpdates, DbDefinition } from './tudien/merge';

dotenv.config();

const TUDIEN_DIR = path.resolve(__dirname, '../data/vietnamese-sources/tudien');

interface Args {
  dryRun: boolean;
  fillOnly: boolean;
  word: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | null => {
    const i = argv.indexOf(f);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const limitRaw = val('--limit');
  return {
    dryRun: has('--dry-run'),
    fillOnly: has('--fill-only'),
    word: val('--word'),
    limit: limitRaw ? parseInt(limitRaw, 10) : null,
  };
}

// DataSource config copied verbatim from scripts/import-vietnamese-meanings.ts
// (lines 335-344) to stay consistent with the sibling script.
function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    logging: false,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `tudien enrichment — ${args.dryRun ? 'DRY RUN' : 'WRITE'}, ` +
      `${args.fillOnly ? 'fill-only' : 'overwrite'}` +
      `${args.word ? `, word=${args.word}` : ''}${args.limit ? `, limit=${args.limit}` : ''}`,
  );

  console.log(`Loading StarDict from ${TUDIEN_DIR} ...`);
  const tudien = loadTudien(TUDIEN_DIR);
  console.log(`Loaded ${tudien.size} tudien headwords.`);

  const ds = createDataSource();
  await ds.initialize();
  const wordRepo = ds.getRepository(Word);
  const defRepo = ds.getRepository(Definition);

  let wordsProcessed = 0;
  let wordsMatched = 0;
  let defChanges = 0;
  let exChanges = 0;

  const PAGE = 500;
  let page = 0;

  // Fetch DB words in pages (or a single word with --word).
  while (true) {
    let words: Word[];
    if (args.word) {
      const w = await wordRepo
        .createQueryBuilder('w')
        .where('LOWER(w.word) = :word', { word: args.word.toLowerCase() })
        .getOne();
      words = w ? [w] : [];
    } else {
      words = await wordRepo.find({ order: { id: 'ASC' }, skip: page * PAGE, take: PAGE });
    }
    if (words.length === 0) break;

    for (const w of words) {
      if (args.limit != null && wordsProcessed >= args.limit) break;
      wordsProcessed++;
      const html = tudien.get(w.word.toLowerCase());
      if (!html) continue;
      wordsMatched++;

      const entry = parseEntry(html);
      const defs = (await defRepo.find({
        where: { wordId: w.id },
        relations: ['examples'],
        order: { definitionOrder: 'ASC' },
      })) as unknown as DbDefinition[];

      const opts = { fillOnly: args.fillOnly };
      const defUpdates = planDefinitionUpdates(defs, entry, opts);
      const exUpdates = planExampleUpdates(defs, entry, opts);

      if (!args.dryRun && (defUpdates.length || exUpdates.length)) {
        await ds.transaction(async (m) => {
          for (const u of defUpdates) await m.update(Definition, u.definitionId, { definitionVi: u.definitionVi });
          for (const u of exUpdates) await m.update(Example, u.exampleId, { exampleVi: u.exampleVi });
        });
      }
      defChanges += defUpdates.length;
      exChanges += exUpdates.length;

      if (args.word) {
        console.log(JSON.stringify({ word: w.word, defUpdates, exUpdates }, null, 2));
      }
    }

    if (args.word) break;
    if (args.limit != null && wordsProcessed >= args.limit) break;
    page++;
  }

  console.log(
    `Done. words scanned=${wordsProcessed}, matched in tudien=${wordsMatched}, ` +
      `definition_vi ${args.dryRun ? 'would change' : 'changed'}=${defChanges}, ` +
      `example_vi ${args.dryRun ? 'would change' : 'changed'}=${exChanges}.`,
  );

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
