# Dictionary Database Generation Guide

This guide explains how to generate and populate the dictionary database with data from authoritative sources.

## Quick Start

### Option 1: Automated (Recommended)

Run the complete generation pipeline with one command:

```bash
npm run generate-db
```

This will:
1. ✓ Parse Wiktionary (15-30 minutes)
2. ✓ Parse CMU Pronouncing Dictionary
3. ✓ Parse WordNet
4. ✓ Combine all data sources
5. ✓ Clear existing database
6. ✓ Import to PostgreSQL (10-30 minutes)

**If you've already parsed the data and just want to re-import:**

```bash
npm run generate-db:quick
```

### Option 2: Manual Step-by-Step

```bash
# 1. Parse data sources
npm run parse-wiktionary    # ~20 minutes, creates 474k+ words
npm run parse-cmu           # ~1 minute, adds pronunciations
npm run parse-wordnet       # ~2 minutes, adds synonyms

# 2. Combine all sources
npm run combine-data        # ~1 minute, merges into 475k+ words

# 3. Import to database
npm run import-to-db:clear  # ~15 minutes, clears DB and imports
```

## Prerequisites

### 1. Download Data Sources

You need to download the source data files first:

#### Wiktionary (Required)
```bash
cd data/raw/wiktionary
wget https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-pages-articles.xml.bz2
```
Size: ~1.4GB compressed, ~11GB uncompressed

#### CMU Pronouncing Dictionary (Optional but recommended)
```bash
cd data/raw/cmu-dict
wget https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
mv cmudict.dict cmudict-0.7b
```

#### WordNet (Optional but recommended)
Download from: https://wordnet.princeton.edu/download
Extract to: `data/raw/wordnet/`

### 2. Database Setup

Ensure PostgreSQL is running and configured in `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=dictionary_user
DB_PASSWORD=dictionary_pass
DB_DATABASE=english_learning_db
```

Create the database if it doesn't exist:

```sql
CREATE DATABASE english_learning_db;
CREATE USER dictionary_user WITH PASSWORD 'dictionary_pass';
GRANT ALL PRIVILEGES ON DATABASE english_learning_db TO dictionary_user;
```

## Data Pipeline Details

### Step 1: Parse Wiktionary

**Script:** `scripts/parse-wiktionary.ts`
**Input:** `data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2`
**Output:** `data/parsed/wiktionary.json`
**Time:** 15-30 minutes
**Result:** ~474,000 English words with definitions, pronunciations, examples

**Key Features:**
- Extracts definitions from both `#` and `##` level entries
- Handles both `===POS===` and `====POS====` section headers
- **Merges case-variant entries** (e.g., "love", "Love", "LoVe")
- Cleans Wikitext markup while preserving content
- Extracts IPA pronunciations
- Extracts usage examples

**Example output for "love":**
```json
{
  "word": "love",
  "language": "en",
  "pronunciations": [{"accent": "US", "ipa": "/lʌv/"}],
  "definitions": [
    {
      "pos": "noun",
      "definition_en": "A deep caring for the existence of another.",
      "examples": [{"en": "A mother's love is not easily shaken."}]
    },
    // ... 26 more definitions
  ]
}
```

### Step 2: Parse CMU Dictionary

**Script:** `scripts/parse-cmu-dict.ts`
**Input:** `data/raw/cmu-dict/cmudict-0.7b`
**Output:** `data/parsed/cmu-dict.json`
**Time:** ~1 minute
**Result:** ~125,000 words with ARPAbet pronunciations

Adds phonetic transcriptions in ARPAbet format (useful for speech synthesis).

### Step 3: Parse WordNet

**Script:** `scripts/parse-wordnet.ts`
**Input:** `data/raw/wordnet/*`
**Output:** `data/parsed/wordnet.json`
**Time:** ~2 minutes
**Result:** ~83,000 words with synonyms and word forms

Adds semantic relationships and word forms (plurals, verb conjugations, etc.).

### Step 4: Combine Data

**Script:** `scripts/combine-data.ts`
**Input:** All parsed JSON files
**Output:** `data/combined/dictionary.json`
**Time:** ~1 minute
**Result:** ~475,000 words with merged data

Merges all sources into a single dictionary:
- Definitions from Wiktionary
- IPA pronunciations from Wiktionary
- ARPAbet pronunciations from CMU
- Synonyms from WordNet
- Word forms from WordNet

### Step 5: Import to Database

**Script:** `scripts/import-to-db.ts`
**Input:** `data/combined/dictionary.json`
**Output:** PostgreSQL database tables
**Time:** 10-30 minutes
**Result:** ~475,000 words in database

Imports into tables:
- `words` - Main word entries
- `definitions` - Word definitions (multiple per word)
- `pronunciations` - IPA and ARPAbet pronunciations
- `synonyms` - Synonym relationships
- `word_forms` - Inflected forms
- `examples` - Usage examples

**Batch Processing:** Imports 100 words at a time for efficiency.

## Command Reference

### Full Generation
```bash
npm run generate-db                    # Full pipeline with all steps
npm run generate-db:quick              # Skip parsing, just combine & import
./scripts/generate-database.sh --help  # See all options
```

### Individual Steps
```bash
npm run parse-wiktionary   # Parse Wiktionary XML
npm run parse-cmu          # Parse CMU Dictionary
npm run parse-wordnet      # Parse WordNet
npm run combine-data       # Merge all parsed data
npm run import-to-db       # Import to DB (append mode)
npm run import-to-db:clear # Clear DB and import
```

### Script Options
```bash
./scripts/generate-database.sh --skip-parsing  # Use existing parsed data
./scripts/generate-database.sh --no-clear      # Append to DB instead of clearing
```

## Troubleshooting

### Parsing Takes Too Long
The Wiktionary parser processes 10+ million pages. Expected time: 15-30 minutes on modern hardware.
Progress is logged every 10,000 pages.

### Database Import Fails
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Ensure database exists
- Check disk space (needs ~2-5GB for full dictionary)

### Out of Memory
Increase Node.js memory limit:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run parse-wiktionary
```

### Missing Definitions
If words like "love" or "fix" show wrong definitions, make sure you're using the latest parser with the case-variant merge fix (see [parse-wiktionary.ts:166-186](parse-wiktionary.ts#L166-186)).

## Data Quality

### Coverage Statistics
After import, you should see:
- **Total words:** ~475,000
- **With definitions:** 99.7% (~474,000)
- **With pronunciations:** 17.7% (~84,000)
- **With synonyms:** 8.7% (~41,000)
- **With word forms:** 0.6% (~2,700)

### Sample Words to Verify

Test these words to ensure quality:

```bash
curl http://localhost:7474/api/dictionary/word/love
curl http://localhost:7474/api/dictionary/word/fix
curl http://localhost:7474/api/dictionary/word/dictionary
curl http://localhost:7474/api/dictionary/word/computer
```

Expected results:
- **love:** 27 definitions (noun + verb)
- **fix:** 27 definitions (verb + noun)
- **dictionary:** 9 definitions
- **computer:** Multiple definitions from general to technical

## Recent Fixes

### Case-Variant Entry Merge (February 2026)
**Problem:** Words with different capitalizations (e.g., "love", "Love", "FIX") were overwriting each other, leaving only the last (often obscure) definition.

**Solution:** Parser now merges definitions from all case variants.

**Files Changed:**
- [scripts/parse-wiktionary.ts](scripts/parse-wiktionary.ts#L166-186)

**Verification:**
```bash
# Before fix:
# love: 1 definition (radiotelephony clear-code)
# fix: 1 definition (clotting factor IX)

# After fix:
# love: 27 definitions (proper meanings)
# fix: 27 definitions (proper meanings)
```

## Performance Tips

### For Development
Use `--skip-parsing` to iterate quickly on import/combine logic:
```bash
npm run generate-db:quick
```

### For Production
Run full generation once, then backup the data files:
```bash
tar -czf dictionary-backup.tar.gz data/parsed/ data/combined/
pg_dump english_learning_db > dictionary-db-backup.sql
```

### Incremental Updates
To update just one source (e.g., when Wiktionary releases new dump):
```bash
# Download new Wiktionary dump
npm run parse-wiktionary
npm run combine-data
npm run import-to-db:clear
```

## File Structure

```
data/
├── raw/                              # Downloaded source files
│   ├── wiktionary/
│   │   └── enwiktionary-latest-pages-articles.xml.bz2  (1.4GB)
│   ├── cmu-dict/
│   │   └── cmudict-0.7b
│   └── wordnet/
│       └── (WordNet data files)
├── parsed/                           # Parsed intermediate JSON
│   ├── wiktionary.json               (~220MB, 474k words)
│   ├── cmu-dict.json                 (~10MB, 125k words)
│   └── wordnet.json                  (~5MB, 83k words)
└── combined/                         # Final merged data
    └── dictionary.json               (~260MB, 475k words)
```

## Next Steps

After successful generation:

1. **Start the API:**
   ```bash
   npm run start:dev
   ```

2. **Test the API:**
   ```bash
   curl http://localhost:7474/api/dictionary/word/test
   ```

3. **Verify in Frontend:**
   - Open your frontend application
   - Search for common words
   - Check that definitions are complete and correct

4. **Optional: Enrich with Vietnamese:**
   ```bash
   npm run enrich-vi:dry  # Preview changes
   npm run enrich-vi      # Add Vietnamese translations
   ```

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the scripts in `scripts/` directory
- Check logs in console output
- Verify database with: `psql -U dictionary_user -d english_learning_db`

## License

Data sources have their own licenses:
- **Wiktionary:** Creative Commons BY-SA 3.0
- **CMU Dictionary:** Public Domain
- **WordNet:** WordNet License (free for research/commercial use)
