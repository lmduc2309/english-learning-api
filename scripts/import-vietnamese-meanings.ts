import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Vietnamese Meaning Import Script
 *
 * Imports Vietnamese translations from open-source dictionaries:
 *   1. open-vn-en-dict (Cambridge/Lạc Việt) — 370K words with meanings + example sentences
 *   2. VNEDICT (Paul Denisowski) — 54K Vietnamese→English entries (reverse-mapped)
 *
 * Matches words against our database and updates definition_vi + example_vi.
 *
 * Usage:
 *   ts-node scripts/import-vietnamese-meanings.ts                # Import all
 *   ts-node scripts/import-vietnamese-meanings.ts --dry-run      # Preview only
 *   ts-node scripts/import-vietnamese-meanings.ts --limit 1000   # Limit words
 *   ts-node scripts/import-vietnamese-meanings.ts --word love    # Specific word
 *   ts-node scripts/import-vietnamese-meanings.ts --source all   # Both sources (default)
 *   ts-node scripts/import-vietnamese-meanings.ts --source open-vn  # open-vn-en-dict only
 *   ts-node scripts/import-vietnamese-meanings.ts --source vnedict  # VNEDICT only
 */

// ============================================================
// Configuration
// ============================================================

const OPEN_VN_EN_DICT_DIR = path.resolve(__dirname, '../data/vietnamese-sources/open-vn-en-dict/data');
const VNEDICT_FILE = path.resolve(__dirname, '../data/vietnamese-sources/vnedict.txt');
const BATCH_SIZE = 200;

interface VietnameseMeaning {
  word: string;
  meanings: Array<{
    pos: string;
    vi: string;
  }>;
  sentences: Array<{
    en: string;
    vi: string;
  }>;
}

interface VnedictEntry {
  vietnamese: string;
  english: string[];
}

// ============================================================
// Parse open-vn-en-dict
// ============================================================

function stripHtml(html: string): string {
  // Remove HTML tags
  let text = html.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractMeaningsFromHtml(html: string): Array<{ pos: string; vi: string }> {
  const meanings: Array<{ pos: string; vi: string }> = [];

  // Extract POS and meaning blocks
  // Pattern: tính từ, danh từ, động từ, etc. followed by meanings with ■ or ▪ markers
  const posMap: Record<string, string> = {
    'danh từ': 'noun',
    'động từ': 'verb',
    'tính từ': 'adjective',
    'phó từ': 'adverb',
    'giới từ': 'preposition',
    'liên từ': 'conjunction',
    'thán từ': 'interjection',
    'đại từ': 'pronoun',
    'mạo từ': 'article',
    'ngoại động từ': 'verb',
    'nội động từ': 'verb',
  };

  const text = stripHtml(html);

  // Try to split by POS markers (marked with * in the source)
  // Pattern: "* danh từ ■ meaning1 ■ meaning2 * động từ ■ meaning3"
  const posRegex = /\*\s*((?:danh|động|tính|phó|giới|liên|thán|đại|mạo|ngoại động|nội động)\s*từ)/gi;
  const posSections: Array<{ pos: string; start: number }> = [];

  let match;
  while ((match = posRegex.exec(text)) !== null) {
    const viPos = match[1].toLowerCase().trim();
    const enPos = posMap[viPos] || viPos;
    posSections.push({ pos: enPos, start: match.index + match[0].length });
  }

  if (posSections.length > 0) {
    for (let i = 0; i < posSections.length; i++) {
      const start = posSections[i].start;
      const end = i + 1 < posSections.length ? posSections[i + 1].start - 20 : text.length;
      const section = text.substring(start, end);

      // Extract individual meanings (marked with ■ or ▪)
      const meaningParts = section.split(/[■▪◆●]/).filter((s) => s.trim().length > 0);

      for (const part of meaningParts) {
        // Clean the meaning: remove example sentences (marked with ⁃ or ◦)
        let meaning = part.split(/[⁃◦]/)[0].trim();
        // Remove leading/trailing punctuation
        meaning = meaning.replace(/^[\s,;:]+|[\s,;:]+$/g, '');

        if (meaning.length > 1 && meaning.length < 500) {
          meanings.push({ pos: posSections[i].pos, vi: meaning });
        }
      }
    }
  }

  // Fallback: if no POS markers found, extract the whole text as a single meaning
  if (meanings.length === 0 && text.length > 2) {
    // Remove the title part "Từ điển Anh - Việt"
    let cleaned = text.replace(/Từ điển Anh\s*-\s*Việt/i, '').trim();
    // Remove pronunciation
    cleaned = cleaned.replace(/◘\s*\[.*?\]/g, '').trim();
    // Remove leading * and POS markers
    cleaned = cleaned.replace(/^\*\s*/g, '').trim();

    // Try splitting by ■
    const parts = cleaned.split(/[■▪]/).filter((s) => s.trim().length > 1);
    if (parts.length > 0) {
      for (const part of parts.slice(0, 5)) {
        const meaning = part.split(/[⁃◦]/)[0].trim().replace(/^[\s,;:]+|[\s,;:]+$/g, '');
        if (meaning.length > 1 && meaning.length < 500) {
          meanings.push({ pos: '', vi: meaning });
        }
      }
    } else if (cleaned.length > 1 && cleaned.length < 500) {
      meanings.push({ pos: '', vi: cleaned });
    }
  }

  return meanings;
}

function parseOpenVnEnDict(
  limitWords: number,
  specificWord: string | null,
): Map<string, VietnameseMeaning> {
  console.log('📂 Parsing open-vn-en-dict...');

  if (!fs.existsSync(OPEN_VN_EN_DICT_DIR)) {
    console.log('   ⚠️  Directory not found. Run: git clone https://github.com/samuraitruong/open-vn-en-dict.git data/vietnamese-sources/open-vn-en-dict');
    return new Map();
  }

  const results = new Map<string, VietnameseMeaning>();
  let files: string[];

  if (specificWord) {
    const filename = `${specificWord.toLowerCase()}.json`;
    files = fs.existsSync(path.join(OPEN_VN_EN_DICT_DIR, filename)) ? [filename] : [];
  } else {
    files = fs.readdirSync(OPEN_VN_EN_DICT_DIR).filter((f) => f.endsWith('.json'));
  }

  let processed = 0;
  let withMeanings = 0;
  let withSentences = 0;

  for (const file of files) {
    if (limitWords > 0 && processed >= limitWords) break;

    try {
      const raw = fs.readFileSync(path.join(OPEN_VN_EN_DICT_DIR, file), 'utf-8');
      const data = JSON.parse(raw);
      const word = file.replace('.json', '').toLowerCase();

      const entry: VietnameseMeaning = { word, meanings: [], sentences: [] };

      // Extract Vietnamese meanings from HTML content
      const enVnHtml = data?.en_vn?.data?.content;
      if (enVnHtml) {
        entry.meanings = extractMeaningsFromHtml(enVnHtml);
        if (entry.meanings.length > 0) withMeanings++;
      }

      // Extract sentences
      const sentences = data?.sentences;
      if (Array.isArray(sentences)) {
        for (const s of sentences) {
          const en = s.en ? stripHtml(s.en).trim() : '';
          const vi = s.vi ? s.vi.trim() : '';
          if (en.length > 0 && vi.length > 0) {
            entry.sentences.push({ en, vi });
          }
        }
        if (entry.sentences.length > 0) withSentences++;
      }

      if (entry.meanings.length > 0 || entry.sentences.length > 0) {
        results.set(word, entry);
      }

      processed++;
      if (processed % 50000 === 0) {
        process.stdout.write(`   ... ${processed.toLocaleString()} files processed\r`);
      }
    } catch {
      // Skip invalid JSON files
    }
  }

  console.log(`   ✅ Parsed ${processed.toLocaleString()} files`);
  console.log(`      ${withMeanings.toLocaleString()} with Vietnamese meanings`);
  console.log(`      ${withSentences.toLocaleString()} with example sentences`);
  console.log(`      ${results.size.toLocaleString()} total usable entries\n`);

  return results;
}

// ============================================================
// Parse VNEDICT (reverse mapping)
// ============================================================

function parseVnedict(): Map<string, string[]> {
  console.log('📂 Parsing VNEDICT (reverse Vi→En mapping)...');

  if (!fs.existsSync(VNEDICT_FILE)) {
    console.log('   ⚠️  File not found. Download: curl -o data/vietnamese-sources/vnedict.txt http://www.denisowski.org/Vietnamese/vnedict.txt');
    return new Map();
  }

  const content = fs.readFileSync(VNEDICT_FILE, 'utf-8');
  const lines = content.split('\n');

  // VNEDICT format: "Vietnamese : English1; English2; English3"
  // We reverse-map to: English → [Vietnamese1, Vietnamese2, ...]
  const reverseMap = new Map<string, string[]>();
  let parsed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('\uFEFF')) continue;

    const colonIdx = trimmed.indexOf(' : ');
    if (colonIdx < 0) continue;

    const vietnamese = trimmed.substring(0, colonIdx).trim();
    const englishPart = trimmed.substring(colonIdx + 3).trim();

    if (!vietnamese || !englishPart) continue;

    // Split English definitions by semicolons
    const englishWords = englishPart
      .split(/[;,]/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0 && w.length < 100);

    for (const engWord of englishWords) {
      // Clean: remove parenthetical notes
      const cleaned = engWord.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (cleaned.length === 0) continue;

      if (!reverseMap.has(cleaned)) {
        reverseMap.set(cleaned, []);
      }
      const existing = reverseMap.get(cleaned)!;
      if (!existing.includes(vietnamese) && existing.length < 10) {
        existing.push(vietnamese);
      }
    }

    parsed++;
  }

  console.log(`   ✅ Parsed ${parsed.toLocaleString()} Vietnamese entries`);
  console.log(`      Reverse-mapped to ${reverseMap.size.toLocaleString()} English words\n`);

  return reverseMap;
}

// ============================================================
// Database import
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const wordIdx = args.indexOf('--word');
  const specificWord = wordIdx >= 0 ? args[wordIdx + 1] : null;
  const sourceIdx = args.indexOf('--source');
  const source = sourceIdx >= 0 ? args[sourceIdx + 1] : 'all';

  console.log('');
  console.log('🇻🇳 Vietnamese Meaning Import');
  console.log('════════════════════════════════════════');
  if (dryRun) console.log('   Mode:   DRY RUN (no changes saved)');
  if (limit) console.log(`   Limit:  ${limit} words`);
  if (specificWord) console.log(`   Word:   ${specificWord}`);
  console.log(`   Source: ${source}`);
  console.log('');

  // Step 1: Parse sources
  let openVnData = new Map<string, VietnameseMeaning>();
  let vnedictData = new Map<string, string[]>();

  if (source === 'all' || source === 'open-vn') {
    openVnData = parseOpenVnEnDict(limit, specificWord);
  }
  if (source === 'all' || source === 'vnedict') {
    vnedictData = parseVnedict();
  }

  if (openVnData.size === 0 && vnedictData.size === 0) {
    console.log('❌ No data to import. Download sources first.\n');
    process.exit(1);
  }

  // Step 2: Connect to database
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
    console.log('✅ Connected to database\n');

    const wordRepo = dataSource.getRepository(Word);
    const defRepo = dataSource.getRepository(Definition);
    const exRepo = dataSource.getRepository(Example);

    // Collect all words we have Vietnamese data for
    const allViWords = new Set<string>();
    for (const word of openVnData.keys()) allViWords.add(word);
    for (const word of vnedictData.keys()) allViWords.add(word);

    // If specific word requested, filter to only that word
    if (specificWord) {
      const target = specificWord.toLowerCase();
      const filtered = new Set<string>();
      if (allViWords.has(target)) filtered.add(target);
      allViWords.clear();
      for (const w of filtered) allViWords.add(w);
    }

    console.log(`📊 Total unique words with Vietnamese data: ${allViWords.size.toLocaleString()}`);

    // Step 3: Process in batches — find DB words that match
    const wordArray = Array.from(allViWords);
    let totalDefsUpdated = 0;
    let totalExamplesUpdated = 0;
    let totalWordsMatched = 0;
    let totalWordsUnmatched = 0;

    for (let i = 0; i < wordArray.length; i += BATCH_SIZE) {
      const batch = wordArray.slice(i, i + BATCH_SIZE);

      // Find matching words in DB
      const dbWords = await wordRepo
        .createQueryBuilder('w')
        .where('LOWER(w.word) IN (:...words)', { words: batch })
        .getMany();

      if (dbWords.length === 0) {
        totalWordsUnmatched += batch.length;
        continue;
      }

      const wordIdMap = new Map<string, number>();
      for (const w of dbWords) {
        wordIdMap.set(w.word.toLowerCase(), w.id);
      }

      totalWordsMatched += dbWords.length;
      totalWordsUnmatched += batch.length - dbWords.length;

      // For each matched word, update definitions
      for (const dbWord of dbWords) {
        const wordLower = dbWord.word.toLowerCase();
        const wordId = dbWord.id;

        // Fetch definitions for this word that need Vietnamese
        const defs = await defRepo
          .createQueryBuilder('d')
          .where('d.wordId = :wordId', { wordId })
          .andWhere('d.definitionVi IS NULL')
          .orderBy('d.definitionOrder', 'ASC')
          .getMany();

        if (defs.length === 0) continue;

        // Get Vietnamese meanings from open-vn-en-dict (priority 1)
        const openVnEntry = openVnData.get(wordLower);
        // Get Vietnamese meanings from VNEDICT (priority 2)
        const vnedictMeanings = vnedictData.get(wordLower);

        let defsUpdatedForWord = 0;

        // Strategy: match by POS first, then by order
        if (openVnEntry && openVnEntry.meanings.length > 0) {
          // Try POS-based matching
          for (const def of defs) {
            if (def.definitionVi) continue; // Already has Vietnamese

            const defPos = (def.partOfSpeech || '').toLowerCase();

            // Find matching meaning by POS
            let matchedMeaning = openVnEntry.meanings.find(
              (m) => m.pos && defPos && m.pos.toLowerCase() === defPos,
            );

            // Fallback: use any available meaning
            if (!matchedMeaning && openVnEntry.meanings.length > defsUpdatedForWord) {
              matchedMeaning = openVnEntry.meanings[defsUpdatedForWord];
            }

            if (matchedMeaning) {
              if (!dryRun) {
                await defRepo.update(def.id, {
                  definitionVi: matchedMeaning.vi,
                  reviewStatus: 'raw',
                  isLearnerVisible: false,
                });
              }
              defsUpdatedForWord++;
              totalDefsUpdated++;
            }
          }
        }

        // Fill remaining defs with VNEDICT data
        if (vnedictMeanings && vnedictMeanings.length > 0) {
          const remainingDefs = defs.filter((d) => !d.definitionVi);
          // Only use VNEDICT if open-vn-en-dict didn't fill this definition
          // After the loop above, some defs may have been updated in-memory but not refetched
          // So we check defsUpdatedForWord
          const unfilledDefs = defs.slice(defsUpdatedForWord);

          for (let j = 0; j < unfilledDefs.length && j < vnedictMeanings.length; j++) {
            if (!dryRun) {
              await defRepo.update(unfilledDefs[j].id, {
                definitionVi: vnedictMeanings[j],
                reviewStatus: 'raw',
                isLearnerVisible: false,
              });
            }
            totalDefsUpdated++;
          }
        }

        // Update examples with sentences from open-vn-en-dict
        if (openVnEntry && openVnEntry.sentences.length > 0) {
          const examples = await exRepo
            .createQueryBuilder('e')
            .leftJoin('e.definition', 'd')
            .where('d.wordId = :wordId', { wordId })
            .andWhere('e.exampleVi IS NULL')
            .andWhere('e.exampleEn IS NOT NULL')
            .getMany();

          for (const ex of examples) {
            // Try to find a matching sentence by English text similarity
            const exEnNorm = ex.exampleEn.toLowerCase().replace(/[^\w\s]/g, '').trim();

            const matchedSentence = openVnEntry.sentences.find((s) => {
              const sEnNorm = s.en.toLowerCase().replace(/[^\w\s]/g, '').trim();
              // Require exact match or very close length (within 20%) for substring match
              if (sEnNorm === exEnNorm) return true;
              if (sEnNorm.length < 5 || exEnNorm.length < 5) return false;
              const lenRatio = Math.min(sEnNorm.length, exEnNorm.length) / Math.max(sEnNorm.length, exEnNorm.length);
              if (lenRatio < 0.8) return false;
              return exEnNorm.includes(sEnNorm) || sEnNorm.includes(exEnNorm);
            });

            if (matchedSentence) {
              if (!dryRun) {
                await exRepo.update(ex.id, {
                  exampleVi: matchedSentence.vi,
                  reviewStatus: 'raw',
                  isLearnerVisible: false,
                });
              }
              totalExamplesUpdated++;
            }
          }
        }
      }

      // Progress
      const progress = Math.min(i + BATCH_SIZE, wordArray.length);
      const pct = ((progress / wordArray.length) * 100).toFixed(1);
      process.stdout.write(
        `   [${progress.toLocaleString()}/${wordArray.length.toLocaleString()}] ${pct}% | ` +
          `${totalWordsMatched.toLocaleString()} matched | ` +
          `${totalDefsUpdated.toLocaleString()} defs | ` +
          `${totalExamplesUpdated.toLocaleString()} examples\r`,
      );
    }

    // Summary
    console.log('\n');
    console.log('════════════════════════════════════════');
    console.log('📋 Import Summary:');
    console.log(`   Words matched in DB:     ${totalWordsMatched.toLocaleString()}`);
    console.log(`   Words not in DB:         ${totalWordsUnmatched.toLocaleString()}`);
    console.log(`   Definitions updated:     ${totalDefsUpdated.toLocaleString()}`);
    console.log(`   Examples updated:        ${totalExamplesUpdated.toLocaleString()}`);
    if (dryRun) {
      console.log('\n   (DRY RUN — no changes were saved to the database)');
    }
    console.log('════════════════════════════════════════\n');
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  } finally {
    await dataSource.destroy();
    console.log('Disconnected from database.\n');
  }
}

main();
