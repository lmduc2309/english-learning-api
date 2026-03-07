import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createReadStream } from 'fs';

interface WordNetEntry {
  word: string;
  pos: string; // Part of speech: noun, verb, adj, adv
  synonyms: string[];
  wordForms?: {
    [key: string]: string; // e.g., { "plural": "cats", "past": "ran" }
  };
}

/**
 * WordNet Parser
 *
 * Parses WordNet database to extract:
 * - Synonyms (from synsets)
 * - Word forms (morphological variations)
 * - Semantic relationships
 */
class WordNetParser {
  private entries: Map<string, WordNetEntry> = new Map();
  private wordNetPath: string;

  constructor(wordNetPath: string) {
    this.wordNetPath = wordNetPath;
  }

  /**
   * Parse WordNet data files
   */
  async parse(outputFile: string): Promise<void> {
    console.log('Starting WordNet parser...');
    console.log(`WordNet path: ${this.wordNetPath}`);
    console.log(`Output: ${outputFile}`);

    // Parse each part of speech
    const posTypes = ['noun', 'verb', 'adj', 'adv'];

    for (const pos of posTypes) {
      console.log(`\nParsing ${pos} synsets...`);
      await this.parseSynsets(pos);
    }

    // Parse morphological exceptions (word forms)
    console.log('\nParsing word forms...');
    for (const pos of posTypes) {
      await this.parseMorphology(pos);
    }

    console.log(`\nParsed ${this.entries.size} words from WordNet`);
    console.log('Writing to JSON...');

    // Convert to array grouped by word
    const groupedEntries = this.groupEntriesByWord();
    fs.writeFileSync(outputFile, JSON.stringify(groupedEntries, null, 2));

    console.log(`Successfully wrote ${groupedEntries.length} entries to ${outputFile}`);
  }

  /**
   * Parse synset data file for a specific POS
   * File format: data.{noun|verb|adj|adv}
   */
  private async parseSynsets(pos: string): Promise<void> {
    const dataFile = path.join(this.wordNetPath, 'dict', `data.${pos}`);

    if (!fs.existsSync(dataFile)) {
      console.warn(`Warning: ${dataFile} not found, skipping...`);
      return;
    }

    const fileStream = createReadStream(dataFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;

    for await (const line of rl) {
      // Skip comments and empty lines
      if (!line || line.startsWith('  ')) continue;

      this.processSynsetLine(line, pos);

      lineCount++;
      if (lineCount % 5000 === 0) {
        console.log(`  Processed ${lineCount} ${pos} synsets...`);
      }
    }
  }

  /**
   * Process a single synset line
   * Format: synset_offset lex_filenum ss_type w_cnt word lex_id [word lex_id...] p_cnt [ptr...] [frames...] | gloss
   */
  private processSynsetLine(line: string, pos: string): void {
    // Split by pipe to separate synset data from gloss
    const parts = line.split('|');
    if (parts.length < 1) return;

    const synsetData = parts[0].trim();
    const tokens = synsetData.split(/\s+/);

    if (tokens.length < 4) return;

    // Parse word count
    const wCountIndex = 3;
    const wCount = parseInt(tokens[wCountIndex], 16); // Hexadecimal

    if (isNaN(wCount) || wCount === 0) return;

    // Extract all words in this synset (synonyms)
    const words: string[] = [];
    let currentIndex = wCountIndex + 1;

    for (let i = 0; i < wCount; i++) {
      if (currentIndex >= tokens.length) break;

      const word = tokens[currentIndex].replace(/_/g, ' ').toLowerCase();
      words.push(word);

      currentIndex += 2; // Skip lex_id
    }

    // Add each word with its synonyms
    for (const word of words) {
      // Skip multi-word entries for now
      if (word.includes(' ')) continue;

      // Get other words as synonyms
      const synonyms = words.filter(w => w !== word && !w.includes(' '));

      const key = `${word}:${pos}`;
      const existing = this.entries.get(key);

      if (existing) {
        // Merge synonyms
        const allSynonyms = [...new Set([...existing.synonyms, ...synonyms])];
        existing.synonyms = allSynonyms;
      } else {
        this.entries.set(key, {
          word,
          pos,
          synonyms,
        });
      }
    }
  }

  /**
   * Parse morphological exception files
   * File format: {noun|verb|adj|adv}.exc
   * Format: inflected_form lemma [lemma...]
   */
  private async parseMorphology(pos: string): Promise<void> {
    const excFile = path.join(this.wordNetPath, 'dict', `${pos}.exc`);

    if (!fs.existsSync(excFile)) {
      console.warn(`Warning: ${excFile} not found, skipping...`);
      return;
    }

    const fileStream = createReadStream(excFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const inflected = parts[0].toLowerCase();
      const base = parts[1].toLowerCase();

      // Determine form type based on POS
      let formType: string | null = null;

      if (pos === 'noun') {
        formType = 'plural';
      } else if (pos === 'verb') {
        // WordNet doesn't specify, so we guess based on suffix
        if (inflected.endsWith('ed')) {
          formType = 'past';
        } else if (inflected.endsWith('ing')) {
          formType = 'present_participle';
        } else if (inflected.endsWith('s')) {
          formType = 'third_person';
        }
      } else if (pos === 'adj') {
        if (inflected.endsWith('er')) {
          formType = 'comparative';
        } else if (inflected.endsWith('est')) {
          formType = 'superlative';
        }
      }

      if (!formType) continue;

      // Add to base word entry
      const key = `${base}:${pos}`;
      const entry = this.entries.get(key);

      if (entry) {
        if (!entry.wordForms) {
          entry.wordForms = {};
        }
        entry.wordForms[formType] = inflected;
      }
    }
  }

  /**
   * Group entries by word (combine different POS)
   */
  private groupEntriesByWord(): any[] {
    const wordMap = new Map<string, any>();

    for (const entry of this.entries.values()) {
      const existing = wordMap.get(entry.word);

      if (existing) {
        // Merge synonyms
        existing.synonyms = [...new Set([...existing.synonyms, ...entry.synonyms])];

        // Merge word forms
        if (entry.wordForms) {
          existing.word_forms = {
            ...existing.word_forms,
            ...entry.wordForms,
          };
        }
      } else {
        wordMap.set(entry.word, {
          word: entry.word,
          synonyms: entry.synonyms,
          word_forms: entry.wordForms || {},
        });
      }
    }

    return Array.from(wordMap.values());
  }
}

// Main execution
async function main() {
  const wordNetPath = 'data/raw/wordnet/WordNet-3.0';
  const outputFile = 'data/parsed/wordnet.json';

  const parser = new WordNetParser(wordNetPath);

  try {
    await parser.parse(outputFile);
    console.log('WordNet parsing complete!');
  } catch (error) {
    console.error('Error parsing WordNet:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { WordNetParser };
