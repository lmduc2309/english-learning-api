import * as fs from 'fs';
import * as readline from 'readline';
import { createReadStream, createWriteStream } from 'fs';
import { createBrotliCompress, createGunzip } from 'zlib';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface WiktionaryEntry {
  word: string;
  language: string;
  pronunciations: Array<{
    accent: string;
    ipa: string;
  }>;
  definitions: Array<{
    pos: string;
    definition_en: string;
    examples: Array<{
      en: string;
    }>;
  }>;
}

/**
 * Parse Wiktionary XML dump and extract English word data
 *
 * This script processes the massive Wiktionary XML dump and extracts:
 * - Word entries
 * - IPA pronunciations
 * - Definitions
 * - Example sentences
 */
class WiktionaryParser {
  private currentPage: string = '';
  private currentTitle: string = '';
  private inText: boolean = false;
  private entries: Map<string, WiktionaryEntry> = new Map();
  private processedCount: number = 0;

  constructor() {}

  /**
   * Main parsing function
   */
  async parse(inputFile: string, outputFile: string): Promise<void> {
    console.log('Starting Wiktionary parser...');
    console.log(`Input: ${inputFile}`);
    console.log(`Output: ${outputFile}`);

    // First, decompress the bz2 file if needed
    let xmlFile = inputFile.replace('.bz2', '');

    if (inputFile.endsWith('.bz2')) {
      console.log('Decompressing bz2 file...');
      await this.decompressBz2(inputFile, xmlFile);
    }

    console.log('Parsing XML...');
    await this.parseXML(xmlFile);

    console.log(`\nParsed ${this.entries.size} English words`);
    console.log('Writing to JSON...');

    // Write to JSON file
    const entriesArray = Array.from(this.entries.values());
    fs.writeFileSync(outputFile, JSON.stringify(entriesArray, null, 2));

    console.log(`Successfully wrote ${entriesArray.length} entries to ${outputFile}`);
  }

  /**
   * Decompress bz2 file
   */
  private async decompressBz2(input: string, output: string): Promise<void> {
    if (fs.existsSync(output)) {
      console.log('Decompressed file already exists, skipping...');
      return;
    }

    try {
      // Use system bzip2 for better performance
      await execAsync(`bzip2 -dk "${input}"`);
      console.log('Decompression complete');
    } catch (error) {
      console.error('Error decompressing file:', error);
      throw error;
    }
  }

  /**
   * Parse XML file line by line (memory efficient for large files)
   */
  private async parseXML(xmlFile: string): Promise<void> {
    const fileStream = createReadStream(xmlFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let textContent = '';

    for await (const line of rl) {
      const trimmed = line.trim();

      if (trimmed.startsWith('<title>')) {
        this.currentTitle = this.extractText(trimmed, 'title');
      } else if (trimmed.startsWith('<text')) {
        this.inText = true;
        // Extract the text content from the opening tag if it's on the same line
        const textMatch = line.match(/<text[^>]*>(.*)/);
        textContent = textMatch ? textMatch[1] : '';
      } else if (this.inText) {
        textContent += '\n' + line;
      }

      if (this.inText && line.includes('</text>')) {
        this.inText = false;
        // Remove the closing tag
        textContent = textContent.replace(/<\/text>.*$/, '');
        await this.processPage(this.currentTitle, textContent);
        textContent = '';

        this.processedCount++;
        if (this.processedCount % 10000 === 0) {
          console.log(`Processed ${this.processedCount} pages, found ${this.entries.size} English words...`);
        }
      }
    }
  }

  /**
   * Extract text from XML tag
   */
  private extractText(line: string, tag: string): string {
    const match = line.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
    return match ? match[1] : '';
  }

  /**
   * Process a single Wiktionary page
   */
  private async processPage(title: string, content: string): Promise<void> {
    // Only process English words (skip pages with colons, which are meta pages)
    if (!title || title.includes(':')) return;

    // Only process pages that contain English section
    if (!content.includes('==English==')) return;

    // Skip multi-word entries for now (can be added later)
    if (title.includes(' ') && !title.includes('-')) return;

    // Extract English section
    const englishSection = this.extractEnglishSection(content);
    if (!englishSection) return;

    const entry: WiktionaryEntry = {
      word: title.toLowerCase(),
      language: 'en',
      pronunciations: this.extractPronunciations(englishSection),
      definitions: this.extractDefinitions(englishSection),
    };

    // Only add if we have at least one definition
    if (entry.definitions.length > 0) {
      const normalizedWord = entry.word;

      // Check if we already have an entry for this word
      const existingEntry = this.entries.get(normalizedWord);

      if (existingEntry) {
        // Merge definitions from this entry with existing entry
        existingEntry.definitions.push(...entry.definitions);

        // Merge pronunciations (avoid duplicates)
        for (const pron of entry.pronunciations) {
          if (!existingEntry.pronunciations.some(p => p.accent === pron.accent && p.ipa === pron.ipa)) {
            existingEntry.pronunciations.push(pron);
          }
        }
      } else {
        // New entry, add it
        this.entries.set(normalizedWord, entry);
      }
    }
  }

  /**
   * Extract English section from Wikitext
   */
  private extractEnglishSection(content: string): string | null {
    // Match from ==English== to the next language section (==SomeLanguage==) or end of content
    // Use negative lookahead to avoid matching ===SubSection=== (three or more equals)
    const englishMatch = content.match(/==English==([\s\S]*?)(?:\n==(?!=)[A-Z]|$)/);
    return englishMatch ? englishMatch[1] : null;
  }

  /**
   * Extract IPA pronunciations
   */
  private extractPronunciations(section: string): Array<{ accent: string; ipa: string }> {
    const pronunciations: Array<{ accent: string; ipa: string }> = [];

    // Match IPA templates: {{IPA|en|/...../}}
    const ipaRegex = /\{\{IPA\|en\|([^}]+)\}\}/g;
    let match;

    while ((match = ipaRegex.exec(section)) !== null) {
      const ipaContent = match[1];

      // Extract IPA notation
      const ipaMatch = ipaContent.match(/\/([^\/]+)\//);
      if (!ipaMatch) continue;

      const ipa = ipaMatch[0]; // Keep the slashes

      // Determine accent (US/UK)
      let accent = 'US';
      if (ipaContent.includes('UK') || ipaContent.includes('RP') || ipaContent.includes('British')) {
        accent = 'UK';
      } else if (ipaContent.includes('US') || ipaContent.includes('GA') || ipaContent.includes('American')) {
        accent = 'US';
      }

      pronunciations.push({ accent, ipa });
    }

    // If no pronunciations found, try alternative format
    if (pronunciations.length === 0) {
      const altRegex = /\* \{\{a\|([^}]+)\}\} \{\{IPA\|en\|([^}]+)\}\}/g;
      while ((match = altRegex.exec(section)) !== null) {
        const accentInfo = match[1];
        const ipaContent = match[2];
        const ipaMatch = ipaContent.match(/\/([^\/]+)\//);

        if (ipaMatch) {
          let accent = 'US';
          if (accentInfo.includes('UK') || accentInfo.includes('RP') || accentInfo.includes('British')) {
            accent = 'UK';
          }
          pronunciations.push({ accent, ipa: ipaMatch[0] });
        }
      }
    }

    return pronunciations;
  }

  /**
   * Extract definitions with examples
   */
  private extractDefinitions(section: string): Array<{
    pos: string;
    definition_en: string;
    examples: Array<{ en: string }>;
  }> {
    const definitions: Array<any> = [];

    // Match part of speech sections at both ===Level=== and ====Level====
    // Wiktionary uses ====Noun====, ====Verb==== under ===Etymology 1=== sections
    // But also uses ===Noun===, ===Verb=== for simple words without etymologies
    // Match both formats separately to ensure correct matching
    const posRegex = /(?:====([A-Z][a-z]+)====|===([A-Z][a-z]+)===)\s*([\s\S]*?)(?====|===|$)/g;
    let posMatch;

    while ((posMatch = posRegex.exec(section)) !== null) {
      // posMatch[1] is for ====Header==== format, posMatch[2] is for ===Header=== format
      const pos = (posMatch[1] || posMatch[2]).toLowerCase();
      const posContent = posMatch[3];

      // Skip etymology, pronunciation, and other non-definition sections
      if (['etymology', 'pronunciation', 'references', 'anagrams', 'alternative', 'usage', 'derived', 'related', 'see', 'translations', 'further', 'synonyms', 'antonyms', 'hyponyms', 'hypernyms', 'coordinate', 'meronyms', 'holonyms'].includes(pos)) {
        continue;
      }

      // Split content by lines to process definitions and their examples
      // Pre-process: join lines that are continuations of multi-line templates
      const rawLines = posContent.split('\n');
      const lines: string[] = [];
      let templateAccumulator = '';
      let templateBraceDepth = 0;

      for (const rawLine of rawLines) {
        if (templateAccumulator) {
          const opens = (rawLine.match(/\{\{/g) || []).length;
          const closes = (rawLine.match(/\}\}/g) || []).length;
          templateBraceDepth += opens - closes;
          templateAccumulator += ' ' + rawLine.trim();

          if (templateBraceDepth <= 0) {
            lines.push(templateAccumulator);
            templateAccumulator = '';
            templateBraceDepth = 0;
          }
          continue;
        }

        const opens = (rawLine.match(/\{\{/g) || []).length;
        const closes = (rawLine.match(/\}\}/g) || []).length;

        if (opens > closes) {
          templateAccumulator = rawLine;
          templateBraceDepth = opens - closes;
        } else {
          lines.push(rawLine);
        }
      }
      if (templateAccumulator) {
        lines.push(templateAccumulator);
      }

      let currentDef: { pos: string; definition_en: string; examples: Array<{ en: string }> } | null = null;

      for (const line of lines) {
        // Check if it's a definition line (starts with # or ##, but not ###, #:, #*, etc.)
        // Matches: #<space> or ##<space> followed by text
        const defMatch = line.match(/^(#{1,2})\s+([^:#*].+)$/);

        if (defMatch) {
          const hashLevel = defMatch[1].length;
          const defText = defMatch[2];

          // Only process if it's # or ##, not deeper levels
          if (hashLevel <= 2) {
            // Save previous definition if exists
            if (currentDef && currentDef.definition_en) {
              definitions.push(currentDef);
            }

            // Start new definition
            // Clean the definition text
            const cleanDef = this.cleanWikitext(defText);

            // Skip if the cleaned definition is too short or empty
            // Reduced minimum length to catch more definitions
            if (cleanDef && cleanDef.length >= 3) {
              currentDef = {
                pos,
                definition_en: cleanDef,
                examples: [],
              };
            }
          }
        } else if (currentDef) {
          // Check if it's an example line (starts with #:, #*, but not ##)
          // Examples can be at # level (#:) or ## level (##:)
          const exMatch = line.match(/^#+[:*]+\s*(.+)$/);
          if (exMatch) {
            const rawText = exMatch[1];
            // Only process lines that contain usage examples {{ux}} or quotations {{quote-*}}
            // Skip other templates like {{syn}}, {{cot}}, {{hypo}}, etc.
            if (rawText.includes('{{ux|') || rawText.includes('{{quote-')) {
              const exampleText = this.cleanWikitext(rawText);
              if (exampleText && exampleText.length > 5 && !exampleText.includes('{{')) {
                // Limit to 3 examples per definition
                if (currentDef.examples.length < 3) {
                  currentDef.examples.push({ en: exampleText });
                }
              }
            }
          }
        }
      }

      // Don't forget to add the last definition
      if (currentDef && currentDef.definition_en) {
        definitions.push(currentDef);
      }
    }

    return definitions;
  }

  /**
   * Clean up Wikitext markup
   */
  private cleanWikitext(text: string): string {
    let result = text;

    // Extract text from usage example templates {{ux|lang|example text}}
    result = result.replace(/\{\{ux\|[^|]+\|([^}]+)\}\}/g, '$1');

    // Process {{quote-*}} templates - extract passage= or text= values
    // Uses brace-matching to handle nested templates properly
    result = this.processQuoteTemplates(result);

    // Handle label templates {{lb|en|...}} by extracting the label text
    result = result.replace(/\{\{lb\|en\|([^}]+)\}\}/g, '($1)');

    // Handle context templates {{context|...}} similarly
    result = result.replace(/\{\{context\|([^}]+)\}\}/g, '($1)');

    // Extract definition text from {{defn|...}} or {{gloss|...}} templates
    result = result.replace(/\{\{(?:defn|gloss)\|([^}]+)\}\}/g, '$1');

    // Handle {{w|text}} or {{w|link|text}} wiki link templates
    result = result.replace(/\{\{w\|(?:[^|]+\|)?([^}]+)\}\}/g, '$1');

    // Remove wiki links but keep the display text
    result = result.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');

    // Remove any remaining templates - handle nested braces by matching conservatively
    // This removes templates like {{quote-book|...}} that don't have text/passage parameters
    // Do this iteratively to handle nested templates
    let prevResult = '';
    let iterations = 0;
    while (prevResult !== result && iterations < 10) {
      prevResult = result;
      result = result.replace(/\{\{[^{}]*\}\}/g, '');
      iterations++;
    }

    // Remove HTML entities
    result = result.replace(/&amp;/g, '&');
    result = result.replace(/&lt;/g, '<');
    result = result.replace(/&gt;/g, '>');
    result = result.replace(/&quot;/g, '"');
    result = result.replace(/&apos;/g, "'");

    // Remove HTML tags
    result = result.replace(/<[^>]+>/g, '');

    // Remove references
    result = result.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');

    // Remove bold/italic wiki markup
    result = result.replace(/'{2,5}/g, '');

    // Clean up whitespace
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Process {{quote-*}} templates by finding balanced braces and extracting passage/text
   */
  private processQuoteTemplates(text: string): string {
    let result = text;
    let startIdx = 0;

    while (true) {
      const quoteIdx = result.indexOf('{{quote-', startIdx);
      if (quoteIdx === -1) break;

      // Find the matching closing }} using brace depth tracking
      let depth = 0;
      let endIdx = -1;
      for (let i = quoteIdx; i < result.length - 1; i++) {
        if (result[i] === '{' && result[i + 1] === '{') {
          depth++;
          i++;
        } else if (result[i] === '}' && result[i + 1] === '}') {
          depth--;
          i++;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }

      if (endIdx === -1) {
        // Unmatched template - remove from {{ to end of string
        result = result.substring(0, quoteIdx).trim();
        break;
      }

      const template = result.substring(quoteIdx, endIdx);
      const passage = this.extractPassageFromTemplate(template);
      result = result.substring(0, quoteIdx) + passage + result.substring(endIdx);
      startIdx = quoteIdx + passage.length;
    }

    return result;
  }

  /**
   * Extract passage= or text= value from a complete {{quote-*}} template string
   * Handles nested templates like {{w|...}} within parameter values
   */
  private extractPassageFromTemplate(template: string): string {
    for (const param of ['passage', 'text']) {
      const paramPattern = `|${param}=`;
      const paramIdx = template.indexOf(paramPattern);
      if (paramIdx === -1) continue;

      const valueStart = paramIdx + paramPattern.length;
      let depth = 0;
      let end = template.length;

      for (let i = valueStart; i < template.length; i++) {
        if (template[i] === '{' && i + 1 < template.length && template[i + 1] === '{') {
          depth++;
          i++;
        } else if (template[i] === '}' && i + 1 < template.length && template[i + 1] === '}') {
          if (depth === 0) {
            end = i;
            break;
          }
          depth--;
          i++;
        } else if (template[i] === '|' && depth === 0) {
          // Check if this is a new named parameter (word=)
          const rest = template.substring(i + 1);
          if (rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*=/)) {
            end = i;
            break;
          }
        }
      }

      const value = template.substring(valueStart, end).trim();
      if (value) return value;
    }

    return '';
  }
}

// Main execution
async function main() {
  const parser = new WiktionaryParser();
  // Use environment variable to allow testing with different files
  const inputFile = process.env.WIKTIONARY_INPUT || 'data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2';
  const outputFile = process.env.WIKTIONARY_OUTPUT || 'data/parsed/wiktionary.json';

  try {
    await parser.parse(inputFile, outputFile);
    console.log('Wiktionary parsing complete!');
  } catch (error) {
    console.error('Error parsing Wiktionary:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { WiktionaryParser };
