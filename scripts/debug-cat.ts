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
  let foundCat = false;

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
      
      // Find "cat" entry
      if (currentTitle === 'cat' && !foundCat) {
        foundCat = true;
        
        console.log('=== FULL CONTENT PREVIEW ===');
        console.log(textContent.substring(0, 500));
        console.log('\n=== CHECKING FOR ==English== ===');
        console.log('Contains ==English==:', textContent.includes('==English=='));
        
        // Extract English section with new regex
        const englishMatch = textContent.match(/==English==([\s\S]*?)(?:\n==(?!=)[A-Z]|$)/);
        if (englishMatch) {
          const englishSection = englishMatch[1];
          console.log('\n=== ENGLISH SECTION FOR "cat" ===');
          console.log(englishSection.substring(0, 2000));
          console.log('\n=== LOOKING FOR ===Noun=== ===');
          const nounMatch = englishSection.match(/===Noun===/);
          console.log('Found ===Noun===:', !!nounMatch);
          
          // Try the regex from the code
          const posRegex = /===([A-Z][a-z]+)===\s*([\s\S]*?)(?====|$)/g;
          const matches = [];
          let posMatch;
          while ((posMatch = posRegex.exec(englishSection)) !== null) {
            matches.push(posMatch[1]);
          }
          console.log('Parts of speech found:', matches);
        } else {
          console.log('Could not extract English section!');
        }
        
        break;
      }
      
      textContent = '';
      currentTitle = '';
    }
  }
}

debug().catch(console.error);
