import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Data Import Script for Dictionary
 * 
 * This script imports common English words into the database by:
 * 1. Reading from a word list file or fetching from Free Dictionary API
 * 2. Fetching detailed information for each word
 * 3. Inserting into the database via the API endpoint
 * 
 * Usage:
 *   ts-node scripts/import-dictionary-data.ts
 */

interface FreeDictionaryResponse {
  word: string;
  phonetics: Array<{
    text?: string;
    audio?: string;
  }>;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
      synonyms?: string[];
    }>;
  }>;
}

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const FREE_DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// Common English words to import (top 1000 most frequent)
const COMMON_WORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'I',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  // Add more common words
  'hello', 'world', 'love', 'happy', 'sad', 'learn', 'study', 'read', 'write', 'speak',
  'listen', 'understand', 'beautiful', 'difficult', 'easy', 'hard', 'simple', 'complex',
  'friend', 'family', 'home', 'house', 'school', 'work', 'job', 'money', 'time', 'life',
];

/**
 * Fetch word data from Free Dictionary API
 */
async function fetchWordData(word: string): Promise<FreeDictionaryResponse | null> {
  try {
    const response = await axios.get(`${FREE_DICT_API}/${encodeURIComponent(word)}`, {
      timeout: 5000,
    });
    
    if (response.data && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch "${word}":`, error.message);
    return null;
  }
}

/**
 * Translate text using LLM via our API
 */
async function translateToVietnamese(text: string): Promise<string> {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/dictionary/translate`, {
      text,
      source_lang: 'en',
      target_lang: 'vi',
    });
    return response.data.translated_text;
  } catch (error) {
    console.error(`Translation failed for "${text}":`, error.message);
    return text; // Return original if translation fails
  }
}

/**
 * Import a single word into the database
 */
async function importWord(word: string, rank: number): Promise<boolean> {
  console.log(`\n[${rank}] Processing: ${word}`);
  
  const wordData = await fetchWordData(word);
  if (!wordData) {
    console.log(`  ⚠️  No data found for "${word}"`);
    return false;
  }

  try {
    // Extract pronunciations
    const pronunciations: Array<{ accent: string; ipa: string; audio_url?: string }> = [];
    for (const phonetic of wordData.phonetics) {
      if (phonetic.text) {
        const accent = phonetic.audio?.includes('-us') ? 'US' : 
                      phonetic.audio?.includes('-uk') ? 'UK' : 'US';
        pronunciations.push({
          accent,
          ipa: phonetic.text,
          audio_url: phonetic.audio || undefined,
        });
      }
    }

    // If no pronunciations found, skip or use placeholder
    if (pronunciations.length === 0) {
      console.log(`  ⚠️  No pronunciation data for "${word}"`);
    }

    // Extract definitions and translate
    const definitions = [];
    for (const meaning of wordData.meanings.slice(0, 3)) { // Limit to 3 meanings
      for (const def of meaning.definitions.slice(0, 2)) { // Limit to 2 defs per meaning
        const definitionVi = await translateToVietnamese(def.definition);
        const examples = [];
        
        if (def.example) {
          const exampleVi = await translateToVietnamese(def.example);
          examples.push({
            en: def.example,
            vi: exampleVi,
          });
        }

        definitions.push({
          pos: meaning.partOfSpeech,
          definition_en: def.definition,
          definition_vi: definitionVi,
          level: 'intermediate', // Default level
          examples,
        });

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Insert via API endpoint (assuming we create an admin endpoint)
    const payload = {
      word: word,
      word_normalized: word.toLowerCase(),
      language: 'en',
      frequency_rank: rank,
      pronunciations,
      definitions,
      synonyms: wordData.meanings[0]?.definitions[0]?.synonyms?.slice(0, 5) || [],
    };

    console.log(`  📝 Inserting "${word}" with ${definitions.length} definitions`);
    
    // For now, we'll log the payload. You need to create a POST endpoint to save this
    // await axios.post(`${API_BASE_URL}/api/dictionary/admin/import`, payload);
    
    // Save to JSON file for now
    const outputDir = path.join(__dirname, '../data/import');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(outputDir, `${word}.json`),
      JSON.stringify(payload, null, 2)
    );
    
    console.log(`  ✅ Saved "${word}" to file`);
    return true;

  } catch (error) {
    console.error(`  ❌ Failed to import "${word}":`, error.message);
    return false;
  }
}

/**
 * Main import function
 */
async function main() {
  console.log('🚀 Starting dictionary data import...\n');
  console.log(`Words to import: ${COMMON_WORDS.length}`);
  console.log(`API URL: ${API_BASE_URL}\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < COMMON_WORDS.length; i++) {
    const word = COMMON_WORDS[i];
    const success = await importWord(word, i + 1);
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Rate limiting between words
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(50));
  console.log('✨ Import complete!');
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log('='.repeat(50));
}

// Run the import
main().catch(console.error);
