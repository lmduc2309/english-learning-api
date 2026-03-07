import * as fs from 'fs';

// Read the love entry from the extracted file
const xmlContent = fs.readFileSync('/tmp/love-entry.xml', 'utf-8');
const loveMatch = xmlContent.match(/<text[^>]*>([\s\S]*?)<\/text>/);

if (!loveMatch) {
  console.log('Love entry not found!');
  process.exit(1);
}

const loveText = loveMatch[1];

// Extract English section
const englishMatch = loveText.match(/==English==([\s\S]*?)(?:\n==(?!=)[A-Z]|$)/);
if (!englishMatch) {
  console.log('English section not found!');
  process.exit(1);
}

const englishSection = englishMatch[1];

console.log('English section length:', englishSection.length);
console.log('\n=== Checking POS sections ===\n');

// Test the POS regex
const posRegex = /(?:====([A-Z][a-z]+)====|===([A-Z][a-z]+)===)\s*([\s\S]*?)(?====|===|$)/g;
let posMatch;
let matchCount = 0;

while ((posMatch = posRegex.exec(englishSection)) !== null) {
  matchCount++;
  const pos = (posMatch[1] || posMatch[2]).toLowerCase();
  const posContent = posMatch[3];
  const firstLine = posContent.split('\n')[0];

  console.log(`Match ${matchCount}: pos="${pos}", content_length=${posContent.length}, first_line="${firstLine.substring(0, 80)}"`);

  if (pos === 'noun' || pos === 'verb') {
    // Count definitions
    const defLines = posContent.split('\n').filter(line => {
      const defMatch = line.match(/^(#{1,2})\s+([^:#*].+)$/);
      return defMatch && defMatch[1].length <= 2;
    });
    console.log(`  -> Found ${defLines.length} definition lines`);
    if (defLines.length > 0) {
      console.log(`  -> First def: "${defLines[0].substring(0, 100)}"`);
    }
  }
}

console.log(`\nTotal POS matches: ${matchCount}`);
