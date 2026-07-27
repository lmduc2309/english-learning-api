/**
 * Legacy tudien Vietnamese enrichment (quarantined source).
 *
 * SOURCE RISK: the archive does not state an explicit reusable license and
 * aggregates content attributed to third-party dictionaries. Do not treat its
 * output as reviewed learner content. Dry-run inspection is the default.
 *
 * DATA (for local forensic inspection only): download the StarDict release and
 * unzip into data/vietnamese-sources/tudien/:
 *   curl -L -o /tmp/tudien.zip \
 *     https://github.com/redphx/tudien/releases/download/v20260411/tudien-stardict-en-vi-20260411.zip
 *   mkdir -p data/vietnamese-sources/tudien && unzip -o /tmp/tudien.zip -d data/vietnamese-sources/tudien
 * (produces *.ifo, *.idx, *.dict.dz — the script reads them directly.)
 *
 * USAGE:
 *   npm run import-tudien                     # dry run; never writes by default
 *   npm run import-tudien -- --word run       # inspect one word; still dry run
 *   npm run import-tudien -- --limit 100      # inspect a bounded sample
 *   npm run import-tudien:write -- \
 *     --acknowledge-unlicensed-source-risk    # explicit, high-risk write
 *   npm run import-tudien:write -- \
 *     --acknowledge-unlicensed-source-risk \
 *     --fill-only                             # write NULL fields only
 *
 * Definition updates are disabled by default because matching senses by POS +
 * array position caused systematic bilingual misalignment. Exact English
 * example matches avoid positional alignment, but their source provenance and
 * reuse rights remain unverified. The legacy definition behavior is available
 * only for forensic/recovery work via --unsafe-positional-definitions.
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
import { parseImportTudienArgs, shouldPersistTudienUpdates } from './tudien/import-policy';

dotenv.config();

const TUDIEN_DIR = path.resolve(__dirname, '../data/vietnamese-sources/tudien');

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
  // Parse the write policy before loading source files or opening PostgreSQL.
  const args = parseImportTudienArgs(process.argv.slice(2));
  const persistUpdates = shouldPersistTudienUpdates(args);
  console.warn(
    'SOURCE WARNING: tudien has no explicit reusable license and aggregates third-party dictionary content.',
  );
  console.log(
    `tudien enrichment — ${persistUpdates ? 'WRITE (SOURCE RISK ACKNOWLEDGED)' : 'DRY RUN'}, ` +
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

      const opts = {
        fillOnly: args.fillOnly,
        allowPositionalDefinitionMatch: args.unsafePositionalDefinitions,
      };
      const defUpdates = planDefinitionUpdates(defs, entry, opts);
      const exUpdates = planExampleUpdates(defs, entry, opts);

      // One shared gate covers both unsafe positional definitions and exact
      // English-example matches. Neither path may write in the default mode.
      if (persistUpdates && (defUpdates.length || exUpdates.length)) {
        await ds.transaction(async (m) => {
          for (const u of defUpdates) {
            await m.update(Definition, u.definitionId, {
              definitionVi: u.definitionVi,
              reviewStatus: 'raw',
              isLearnerVisible: false,
            });
          }
          for (const u of exUpdates) {
            await m.update(Example, u.exampleId, {
              exampleVi: u.exampleVi,
              reviewStatus: 'raw',
              isLearnerVisible: false,
            });
          }
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
      `definition_vi ${persistUpdates ? 'changed' : 'would change'}=${defChanges}, ` +
      `example_vi ${persistUpdates ? 'changed' : 'would change'}=${exChanges}.`,
  );

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
