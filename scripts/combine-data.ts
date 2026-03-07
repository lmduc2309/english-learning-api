import * as fs from 'fs';

interface CombinedEntry {
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
 * Data Combiner
 *
 * Combines parsed data from:
 * - Wiktionary (definitions, examples, IPA)
 * - CMU Dict (pronunciations)
 * - WordNet (synonyms, word forms)
 */
class DataCombiner {
  private wiktionaryData: Map<string, any> = new Map();
  private cmuData: Map<string, any> = new Map();
  private wordnetData: Map<string, any> = new Map();
  private combinedData: Map<string, CombinedEntry> = new Map();

  // Common word frequency list (top 5000 words)
  // You can replace this with actual frequency data from COCA or BNC corpus
  private frequencyList: string[] = [];

  constructor() {}

  /**
   * Main combination function
   */
  async combine(
    wiktionaryFile: string,
    cmuFile: string,
    wordnetFile: string,
    outputFile: string,
  ): Promise<void> {
    console.log('Starting data combination...');

    // Load all data sources
    console.log('\nLoading Wiktionary data...');
    await this.loadWiktionary(wiktionaryFile);

    console.log('Loading CMU Dictionary data...');
    await this.loadCMU(cmuFile);

    console.log('Loading WordNet data...');
    await this.loadWordNet(wordnetFile);

    console.log('\nCombining data sources...');
    this.combineAllSources();

    console.log(`\nCombined ${this.combinedData.size} words`);
    console.log('Writing to JSON...');

    // Write output
    const entriesArray = Array.from(this.combinedData.values())
      .sort((a, b) => {
        // Sort by frequency rank, then alphabetically
        if (a.frequency_rank && b.frequency_rank) {
          return a.frequency_rank - b.frequency_rank;
        }
        if (a.frequency_rank) return -1;
        if (b.frequency_rank) return 1;
        return a.word.localeCompare(b.word);
      });

    fs.writeFileSync(outputFile, JSON.stringify(entriesArray, null, 2));

    console.log(`Successfully wrote ${entriesArray.length} entries to ${outputFile}`);
    this.printStatistics();
  }

  /**
   * Load Wiktionary parsed data
   */
  private async loadWiktionary(file: string): Promise<void> {
    if (!fs.existsSync(file)) {
      console.warn(`Warning: ${file} not found, skipping Wiktionary data`);
      return;
    }

    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log(`  Loaded ${data.length} entries from Wiktionary`);

    for (const entry of data) {
      this.wiktionaryData.set(entry.word, entry);
    }
  }

  /**
   * Load CMU Dictionary parsed data
   */
  private async loadCMU(file: string): Promise<void> {
    if (!fs.existsSync(file)) {
      console.warn(`Warning: ${file} not found, skipping CMU data`);
      return;
    }

    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log(`  Loaded ${data.length} entries from CMU Dictionary`);

    for (const entry of data) {
      this.cmuData.set(entry.word, entry);
    }
  }

  /**
   * Load WordNet parsed data
   */
  private async loadWordNet(file: string): Promise<void> {
    if (!fs.existsSync(file)) {
      console.warn(`Warning: ${file} not found, skipping WordNet data`);
      return;
    }

    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log(`  Loaded ${data.length} entries from WordNet`);

    for (const entry of data) {
      this.wordnetData.set(entry.word, entry);
    }
  }

  /**
   * Combine all data sources
   */
  private combineAllSources(): void {
    // Start with Wiktionary as the base (has most complete data)
    for (const [word, wiktEntry] of this.wiktionaryData.entries()) {
      const combined: CombinedEntry = {
        word: word,
        word_normalized: word.toLowerCase(),
        language: 'en',
        pronunciations: [],
        definitions: [],
      };

      // Add Wiktionary data
      if (wiktEntry.pronunciations && wiktEntry.pronunciations.length > 0) {
        combined.pronunciations = wiktEntry.pronunciations;
      }

      if (wiktEntry.definitions && wiktEntry.definitions.length > 0) {
        combined.definitions = wiktEntry.definitions.map((def: any) => ({
          pos: def.pos,
          definition_en: def.definition_en,
          definition_vi: undefined, // Will need translation
          level: this.determineLevel(word),
          examples: def.examples || [],
        }));
      }

      // Supplement with CMU pronunciation if missing or add US variant
      const cmuEntry = this.cmuData.get(word);
      if (cmuEntry && cmuEntry.ipa) {
        const hasUS = combined.pronunciations.some(p => p.accent === 'US');
        if (!hasUS) {
          combined.pronunciations.push({
            accent: 'US',
            ipa: cmuEntry.ipa,
          });
        }
      }

      // Add WordNet synonyms and word forms
      const wordnetEntry = this.wordnetData.get(word);
      if (wordnetEntry) {
        if (wordnetEntry.synonyms && wordnetEntry.synonyms.length > 0) {
          combined.synonyms = wordnetEntry.synonyms.slice(0, 10); // Limit to 10
        }

        if (wordnetEntry.word_forms && Object.keys(wordnetEntry.word_forms).length > 0) {
          combined.word_forms = wordnetEntry.word_forms;
        }
      }

      // Add frequency rank if available
      const freqRank = this.getFrequencyRank(word);
      if (freqRank > 0) {
        combined.frequency_rank = freqRank;
      }

      // Only add if we have definitions
      if (combined.definitions.length > 0) {
        this.combinedData.set(word, combined);
      }
    }

    // Add words from CMU/WordNet that aren't in Wiktionary (less common)
    // This ensures we have pronunciation for more words even without full definitions
    for (const [word, cmuEntry] of this.cmuData.entries()) {
      if (this.combinedData.has(word)) continue;

      const wordnetEntry = this.wordnetData.get(word);

      // Only add if we have some useful data from WordNet
      if (wordnetEntry && wordnetEntry.synonyms && wordnetEntry.synonyms.length > 0) {
        this.combinedData.set(word, {
          word: word,
          word_normalized: word.toLowerCase(),
          language: 'en',
          pronunciations: [{
            accent: 'US',
            ipa: cmuEntry.ipa,
          }],
          definitions: [], // Will be empty, can be filled later
          synonyms: wordnetEntry.synonyms?.slice(0, 10),
          word_forms: wordnetEntry.word_forms,
        });
      }
    }
  }

  /**
   * Determine difficulty level based on word characteristics
   */
  private determineLevel(word: string): string {
    const freqRank = this.getFrequencyRank(word);

    if (freqRank > 0 && freqRank <= 1000) {
      return 'beginner';
    } else if (freqRank > 0 && freqRank <= 5000) {
      return 'intermediate';
    } else if (word.length <= 5) {
      return 'beginner';
    } else if (word.length <= 8) {
      return 'intermediate';
    } else {
      return 'advanced';
    }
  }

  /**
   * Get frequency rank for a word
   * Returns 0 if not in frequency list
   */
  private getFrequencyRank(word: string): number {
    const index = this.frequencyList.indexOf(word);
    return index >= 0 ? index + 1 : 0;
  }

  /**
   * Print statistics about combined data
   */
  private printStatistics(): void {
    let withPronunciations = 0;
    let withDefinitions = 0;
    let withSynonyms = 0;
    let withWordForms = 0;
    let withFrequencyRank = 0;

    for (const entry of this.combinedData.values()) {
      if (entry.pronunciations.length > 0) withPronunciations++;
      if (entry.definitions.length > 0) withDefinitions++;
      if (entry.synonyms && entry.synonyms.length > 0) withSynonyms++;
      if (entry.word_forms && Object.keys(entry.word_forms).length > 0) withWordForms++;
      if (entry.frequency_rank) withFrequencyRank++;
    }

    console.log('\nData Statistics:');
    console.log(`  Total words: ${this.combinedData.size}`);
    console.log(`  With pronunciations: ${withPronunciations} (${(withPronunciations/this.combinedData.size*100).toFixed(1)}%)`);
    console.log(`  With definitions: ${withDefinitions} (${(withDefinitions/this.combinedData.size*100).toFixed(1)}%)`);
    console.log(`  With synonyms: ${withSynonyms} (${(withSynonyms/this.combinedData.size*100).toFixed(1)}%)`);
    console.log(`  With word forms: ${withWordForms} (${(withWordForms/this.combinedData.size*100).toFixed(1)}%)`);
    console.log(`  With frequency rank: ${withFrequencyRank} (${(withFrequencyRank/this.combinedData.size*100).toFixed(1)}%)`);
  }
}

// Main execution
async function main() {
  const combiner = new DataCombiner();

  const wiktionaryFile = 'data/parsed/wiktionary.json';
  const cmuFile = 'data/parsed/cmu-dict.json';
  const wordnetFile = 'data/parsed/wordnet.json';
  const outputFile = 'data/combined/dictionary.json';

  try {
    await combiner.combine(wiktionaryFile, cmuFile, wordnetFile, outputFile);
    console.log('\nData combination complete!');
  } catch (error) {
    console.error('Error combining data:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { DataCombiner };
