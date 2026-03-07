import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'english_learning_db',
  user: process.env.DB_USER || 'dictionary_user',
  password: process.env.DB_PASSWORD || 'dictionary_pass',
});

async function cleanTemplateExamples() {
  const client = await pool.connect();
  
  try {
    console.log('Connecting to database...');
    
    // Find all examples containing template markers
    const patterns = [
      '{{quote-text',
      '{{quote-book',
      '{{quote-journal',
      '{{quote-web',
      '{{quote-song',
      '{{ux|',
      '{{RQ:',
      '{{Q|',
    ];
    
    console.log('\nSearching for examples with template remnants...\n');
    
    let totalAffected = 0;
    const affectedByPattern: { [key: string]: number } = {};
    
    for (const pattern of patterns) {
      const query = `
        SELECT COUNT(*) as count
        FROM examples
        WHERE example_en LIKE $1
      `;
      
      const result = await client.query(query, [`%${pattern}%`]);
      const count = parseInt(result.rows[0].count);
      
      if (count > 0) {
        affectedByPattern[pattern] = count;
        totalAffected += count;
        console.log(`  ${pattern}: ${count} examples`);
      }
    }
    
    console.log(`\nTotal examples with template issues: ${totalAffected}`);
    
    if (totalAffected === 0) {
      console.log('No examples with template issues found. Database is clean!');
      return;
    }
    
    // Ask for confirmation (in production, you'd use readline or similar)
    console.log('\n⚠️  Will DELETE all examples containing template markers.');
    console.log('This operation cannot be undone.');
    console.log('\nStarting cleanup in 3 seconds...\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Delete examples with template remnants
    console.log('Deleting examples with template issues...');
    
    const deleteQuery = `
      DELETE FROM examples
      WHERE example_en LIKE ANY($1)
    `;
    
    const likePatterns = patterns.map(p => `%${p}%`);
    const deleteResult = await client.query(deleteQuery, [likePatterns]);
    
    console.log(`✅ Deleted ${deleteResult.rowCount} examples with template issues\n`);
    
    // Show remaining counts
    const countsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM words) as words,
        (SELECT COUNT(*) FROM definitions) as definitions,
        (SELECT COUNT(*) FROM examples) as examples
    `;
    
    const counts = await client.query(countsQuery);
    const stats = counts.rows[0];
    
    console.log('Database statistics after cleanup:');
    console.log(`  Words: ${stats.words}`);
    console.log(`  Definitions: ${stats.definitions}`);
    console.log(`  Examples: ${stats.examples}`);
    
    // Show some sample words that were affected
    console.log('\nVerifying cleanup - checking previously affected words:');
    
    const sampleWords = ['balled', 'butter', 'action'];
    for (const word of sampleWords) {
      const wordQuery = `
        SELECT 
          w.word,
          COUNT(DISTINCT d.id) as definition_count,
          COUNT(e.id) as example_count
        FROM words w
        LEFT JOIN definitions d ON d.word_id = w.id
        LEFT JOIN examples e ON e.definition_id = d.id
        WHERE w.word = $1
        GROUP BY w.word
      `;
      
      const wordResult = await client.query(wordQuery, [word]);
      if (wordResult.rows.length > 0) {
        const stats = wordResult.rows[0];
        console.log(`  ${word}: ${stats.definition_count} definitions, ${stats.example_count} examples`);
      }
    }
    
  } catch (error) {
    console.error('Error cleaning template examples:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanTemplateExamples()
  .then(() => {
    console.log('\n✅ Template cleanup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Template cleanup failed:', error);
    process.exit(1);
  });
