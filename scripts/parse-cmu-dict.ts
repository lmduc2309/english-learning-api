import * as fs from 'fs';
import * as readline from 'readline';
import { createReadStream } from 'fs';

interface CMUEntry {
  word: string;
  pronunciation: string; // ARPAbet format
  ipa?: string; // Converted to IPA
}

/**
 * CMU Pronouncing Dictionary Parser
 *
 * Parses the CMU Pronouncing Dictionary which contains:
 * - 134,000+ words
 * - ARPAbet phonetic transcription
 * - American English pronunciations
 */
class CMUDictParser {
  private entries: Map<string, CMUEntry> = new Map();

  // ARPAbet to IPA conversion table
  private readonly arpabetToIPA: Record<string, string> = {
    // Vowels
    'AA': 'ɑ', 'AE': 'æ', 'AH': 'ʌ', 'AO': 'ɔ', 'AW': 'aʊ',
    'AY': 'aɪ', 'EH': 'ɛ', 'ER': 'ɝ', 'EY': 'eɪ', 'IH': 'ɪ',
    'IY': 'i', 'OW': 'oʊ', 'OY': 'ɔɪ', 'UH': 'ʊ', 'UW': 'u',
    // Consonants
    'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð', 'F': 'f',
    'G': 'ɡ', 'HH': 'h', 'JH': 'dʒ', 'K': 'k', 'L': 'l',
    'M': 'm', 'N': 'n', 'NG': 'ŋ', 'P': 'p', 'R': 'ɹ',
    'S': 's', 'SH': 'ʃ', 'T': 't', 'TH': 'θ', 'V': 'v',
    'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
  };

  constructor() {}

  /**
   * Parse CMU dictionary file
   */
  async parse(inputFile: string, outputFile: string): Promise<void> {
    console.log('Starting CMU Dictionary parser...');
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);

    const fileStream = createReadStream(inputFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineCount = 0;

    for await (const line of rl) {
      lineCount++;

      // Skip comments and empty lines
      if (!line || line.startsWith(';;;')) continue;

      this.processLine(line);

      if (lineCount % 10000 === 0) {
        console.log(`Processed ${lineCount} lines, found ${this.entries.size} unique words...`);
      }
    }

    console.log(`\nParsed ${this.entries.size} words from CMU dictionary`);
    console.log('Writing to JSON...');

    // Convert to array and write
    const entriesArray = Array.from(this.entries.values());
    fs.writeFileSync(outputFile, JSON.stringify(entriesArray, null, 2));

    console.log(`Successfully wrote ${entriesArray.length} entries to ${outputFile}`);
  }

  /**
   * Process a single line from CMU dict
   * Format: WORD P R O N U N C I A T I O N
   * Example: HELLO HH AH0 L OW1
   */
  private processLine(line: string): void {
    // Split on first space (CMU dict format: word followed by space and pronunciation)
    const spaceIndex = line.indexOf(' ');
    if (spaceIndex === -1) return;

    let word = line.substring(0, spaceIndex).trim();
    const pronunciation = line.substring(spaceIndex + 1).trim();

    // Handle variants (e.g., WORD(1), WORD(2))
    // We'll keep the first variant only
    const variantMatch = word.match(/^([A-Z'-]+)\(\d+\)$/);
    if (variantMatch) {
      word = variantMatch[1];
      // Skip if we already have this word (prefer first pronunciation)
      if (this.entries.has(word.toLowerCase())) return;
    }

    // Convert to lowercase
    const normalizedWord = word.toLowerCase().replace(/'/g, "'");

    // Skip if not a standard word (contains special characters except apostrophe and hyphen)
    if (!/^[a-z'-]+$/.test(normalizedWord)) return;

    // Convert ARPAbet to IPA
    const ipa = this.convertToIPA(pronunciation);

    this.entries.set(normalizedWord, {
      word: normalizedWord,
      pronunciation,
      ipa,
    });
  }

  /**
   * Convert ARPAbet notation to IPA
   * Example: "HH AH0 L OW1" -> "həˈloʊ"
   */
  private convertToIPA(arpabet: string): string {
    const phones = arpabet.split(/\s+/);
    let ipa = '';
    let primaryStressNext = false;
    let secondaryStressNext = false;

    for (const phone of phones) {
      // Extract stress marker (0=no stress, 1=primary, 2=secondary)
      const stressMatch = phone.match(/^([A-Z]+)([012])$/);

      let phoneme: string;
      let stress = '0';

      if (stressMatch) {
        phoneme = stressMatch[1];
        stress = stressMatch[2];
      } else {
        phoneme = phone;
      }

      // Convert to IPA
      const ipaChar = this.arpabetToIPA[phoneme];
      if (!ipaChar) {
        console.warn(`Unknown ARPAbet phoneme: ${phoneme}`);
        continue;
      }

      // Add stress markers before vowel
      if (stress === '1') {
        ipa += 'ˈ';
      } else if (stress === '2') {
        ipa += 'ˌ';
      }

      ipa += ipaChar;
    }

    return '/' + ipa + '/';
  }
}

// Main execution
async function main() {
  const parser = new CMUDictParser();
  const inputFile = 'data/raw/cmu-dict/cmudict.dict';
  const outputFile = 'data/parsed/cmu-dict.json';

  try {
    await parser.parse(inputFile, outputFile);
    console.log('CMU Dictionary parsing complete!');
  } catch (error) {
    console.error('Error parsing CMU Dictionary:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { CMUDictParser };
