# Dictionary Database Setup Guide

This guide explains how to populate your dictionary database from authoritative sources instead of using AI generation.

## Overview

The dictionary system now uses a combination of three authoritative sources:

1. **Wiktionary** - Comprehensive definitions, IPA pronunciations, and example sentences
2. **CMU Pronouncing Dictionary** - American English phonetic pronunciations
3. **WordNet** - Synonyms and semantic relationships

## Prerequisites

- Node.js 16+ and npm
- PostgreSQL 12+ running locally or remotely
- ~5GB free disk space for raw data
- ~2GB free disk space for processed data
- bzip2 installed (for decompressing Wiktionary dump)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd english-learning-api
npm install
```

This will install:
- `ts-node` - To run TypeScript scripts
- `dotenv` - For environment variables
- All existing dependencies including TypeORM and PostgreSQL driver

### 2. Configure Database

Make sure your `.env` file has the correct database configuration:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=english_learning
```

### 3. Create Database Schema

The database schema is already defined in the entity files. If you haven't created the tables yet:

```bash
# Option 1: Let TypeORM auto-create tables (development)
# Set synchronize: true in src/app.module.ts temporarily

# Option 2: Run migrations (recommended for production)
# Create and run migrations using TypeORM CLI
```

The schema includes:
- `words` - Main word entries
- `pronunciations` - IPA and audio URLs
- `definitions` - Word definitions with part of speech
- `examples` - Example sentences
- `word_forms` - Plural, past tense, etc.
- `synonyms` - Related words

### 4. Download Source Data

**Warning:** This step downloads ~2GB of data and may take 30-60 minutes depending on your connection.

```bash
cd english-learning-api
chmod +x scripts/download-sources.sh
./scripts/download-sources.sh
```

This will download:
- Wiktionary XML dump (~1.5GB compressed)
- CMU Pronouncing Dictionary (~3MB)
- WordNet 3.0 database (~10MB)

All files are saved to `data/raw/` directory.

### 5. Parse Source Data

Parse each data source into structured JSON format:

#### Parse Wiktionary (takes 2-4 hours)

```bash
npm run parse-wiktionary
```

This processes the massive Wiktionary XML dump and extracts:
- ~150,000 English words
- Definitions with part of speech
- IPA pronunciations (US and UK)
- Example sentences

Output: `data/parsed/wiktionary.json`

#### Parse CMU Dictionary (takes 1-2 minutes)

```bash
npm run parse-cmu
```

This processes CMU Pronouncing Dictionary and extracts:
- ~134,000 word pronunciations
- ARPAbet phonetic notation
- Converted IPA notation

Output: `data/parsed/cmu-dict.json`

#### Parse WordNet (takes 5-10 minutes)

```bash
npm run parse-wordnet
```

This processes WordNet database and extracts:
- ~150,000 words
- Synonym relationships
- Word forms (plurals, verb forms, etc.)

Output: `data/parsed/wordnet.json`

### 6. Combine Data Sources

```bash
npm run combine-data
```

This intelligently combines data from all three sources:
- Uses Wiktionary as the primary source (most complete definitions)
- Supplements with CMU pronunciations where missing
- Adds WordNet synonyms and word forms
- Removes duplicates and conflicts

Output: `data/combined/dictionary.json`

**Statistics (estimated):**
- Total words: ~150,000-200,000
- With pronunciations: ~95%
- With definitions: ~100%
- With synonyms: ~60%
- With word forms: ~40%

### 7. Import to Database

**Important:** This will clear existing dictionary data if you use the `--clear` flag.

```bash
# Import data (keeps existing data)
npm run import-to-db

# Or clear database first then import (use with caution!)
npm run import-to-db:clear
```

The import process:
- Processes data in batches of 100 words
- Shows progress during import
- Handles errors gracefully
- Takes 30-60 minutes for full import

### 8. Verify Import

Check your database to verify the import:

```sql
-- Count imported words
SELECT COUNT(*) FROM words;

-- Check a sample word
SELECT w.word, p.ipa, d.definition_en
FROM words w
LEFT JOIN pronunciations p ON p.word_id = w.id
LEFT JOIN definitions d ON d.word_id = w.id
WHERE w.word = 'hello';

-- Check database statistics
SELECT
  (SELECT COUNT(*) FROM words) as total_words,
  (SELECT COUNT(*) FROM pronunciations) as total_pronunciations,
  (SELECT COUNT(*) FROM definitions) as total_definitions,
  (SELECT COUNT(*) FROM examples) as total_examples,
  (SELECT COUNT(*) FROM synonyms) as total_synonyms;
```

## Quick Start (All Steps)

If you want to run everything in sequence:

```bash
# 1. Download data
./scripts/download-sources.sh

# 2. Parse all sources (this takes several hours!)
npm run parse-wiktionary
npm run parse-cmu
npm run parse-wordnet

# 3. Combine data
npm run combine-data

# 4. Import to database
npm run import-to-db
```

## Updating the Dictionary

To update the dictionary with newer data:

1. Download fresh source data:
   ```bash
   rm -rf data/raw/*
   ./scripts/download-sources.sh
   ```

2. Re-run all parsing steps

3. Clear and re-import:
   ```bash
   npm run import-to-db:clear
   ```

## Data Sources

### Wiktionary
- **URL:** https://dumps.wikimedia.org/enwiktionary/latest/
- **Update Frequency:** Weekly
- **License:** CC BY-SA 3.0
- **Best for:** Definitions, examples, IPA pronunciations

### CMU Pronouncing Dictionary
- **URL:** https://github.com/cmusphinx/cmudict
- **Update Frequency:** Occasionally
- **License:** Public Domain
- **Best for:** American English pronunciations

### WordNet
- **URL:** https://wordnet.princeton.edu/
- **Update Frequency:** Stable (WordNet 3.0 from 2006)
- **License:** WordNet License (Free)
- **Best for:** Synonyms, semantic relationships

## API Changes

After populating the database, the dictionary API will:

1. **Always check database first** for word lookups
2. **Only fall back to LLM** if word not found in database
3. **Return richer data** including:
   - Multiple pronunciations (US/UK)
   - Comprehensive definitions
   - Real example sentences
   - Synonyms and word forms

The API endpoints remain the same:
- `GET /dictionary/search?q=word` - Search/autocomplete
- `GET /dictionary/lookup/:word` - Get full word data
- `GET /dictionary/audio/:word/:accent` - Get audio pronunciation

## Troubleshooting

### "Cannot find module" errors
```bash
npm install
```

### "Database connection failed"
Check your `.env` file and ensure PostgreSQL is running:
```bash
psql -U postgres -d english_learning -c "SELECT 1;"
```

### "Out of memory" during Wiktionary parsing
The Wiktionary parser is memory-efficient but still needs ~4GB RAM. Close other applications or use a more powerful machine.

### "Wiktionary parsing is too slow"
This is normal. The Wiktionary dump is huge (~1.5GB compressed, ~10GB uncompressed). It processes 10,000 pages per minute and takes 2-4 hours total.

You can monitor progress in the console output.

### Import fails with foreign key errors
Make sure your database schema is created correctly. Check that all entity files are loaded and TypeORM has created all tables with relationships.

## Performance Tips

1. **Use SSD for data directory** - Much faster parsing
2. **Close other applications** during parsing to free up RAM
3. **Run parsing overnight** - It takes several hours
4. **Use PostgreSQL indexes** - Already defined in entities, but verify they're created
5. **Consider incremental imports** - Import common words first, then expand

## Future Enhancements

Potential improvements:
- Add COCA frequency data for better word ranking
- Include audio file downloads from Forvo or other sources
- Add Vietnamese translations via automated translation
- Parse additional Wiktionary features (etymology, usage notes)
- Implement delta updates instead of full reimport
- Add API endpoint to trigger background data updates

## Support

If you encounter issues:
1. Check the console output for specific error messages
2. Verify all prerequisites are met
3. Ensure enough disk space and memory
4. Check the GitHub issues for similar problems

## License

The data sources have their own licenses:
- Wiktionary: CC BY-SA 3.0
- CMU Dict: Public Domain
- WordNet: WordNet License

Your application should comply with these licenses when distributing the dictionary data.
