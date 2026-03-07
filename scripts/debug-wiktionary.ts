import * as fs from 'fs';
import * as readline from 'readline';
import { createReadStream } from 'fs';

async function debug() {
  const fileStream = createReadStream('/tmp/test-wiktionary-sample.xml');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentTitle = '';
  let inText = false;
  let textContent = '';
  let pageCount = 0;
  let englishCount = 0;

  for await (const line of rl) {
    const trimmed = line.trim();

    if (trimmed.startsWith('<title>')) {
      const match = line.match(/<title[^>]*>([^<]+)<\/title>/);
      currentTitle = match ? match[1] : '';
    } else if (trimmed.startsWith('<text')) {
      inText = true;
      const textMatch = line.match(/<text[^>]*>(.*)/);
      textContent = textMatch ? textMatch[1] : '';
    } else if (inText) {
      textContent += '\n' + line;
    }

    if (inText && line.includes('</text>')) {
      inText = false;
      textContent = textContent.replace(/<\/text>.*$/, '');
      
      pageCount++;
      
      // Check for English content
      if (!currentTitle.includes(':') && textContent.includes('==English==')) {
        englishCount++;
        console.log(`\n=== Page ${englishCount}: "${currentTitle}" ===`);
        console.log(`Has English: ${textContent.includes('==English==')}`);
        console.log(`Content length: ${textContent.length}`);
        console.log(`First 500 chars: ${textContent.substring(0, 500)}`);
        
        if (englishCount >= 3) break;
      }
      
      textContent = '';
      currentTitle = '';
    }
  }

  console.log(`\n\nTotal pages: ${pageCount}`);
  console.log(`English pages: ${englishCount}`);
}

debug().catch(console.error);
