# Dictionary Data Migration Summary

## Overview

The dictionary system has been upgraded from AI-generated definitions to authoritative, pre-built dictionary data from three high-quality sources:

1. **Wiktionary** - Comprehensive English dictionary with definitions, IPA, and examples
2. **CMU Pronouncing Dictionary** - Phonetic pronunciations for 134,000+ words
3. **WordNet** - Synonyms and semantic relationships

## What Was Changed

### New Files Created

#### Scripts Directory (`scripts/`)

1. **download-sources.sh** - Shell script to download all data sources
2. **parse-wiktionary.ts** - Parses Wiktionary XML dump (150,000+ words)
3. **parse-cmu-dict.ts** - Parses CMU Dictionary for pronunciations
4. **parse-wordnet.ts** - Extracts synonyms and word forms from WordNet
5. **combine-data.ts** - Intelligently combines all three sources
6. **import-to-db.ts** - Imports combined data into PostgreSQL
7. **README.md** - Documentation for the scripts

#### Documentation

1. **DICTIONARY_SETUP.md** - Comprehensive setup guide
2. **DICTIONARY_MIGRATION_SUMMARY.md** - This file

### Modified Files

1. **package.json**
   - Added scripts for data processing: `parse-wiktionary`, `parse-cmu`, `parse-wordnet`, `combine-data`, `import-to-db`
   - Added dev dependencies: `ts-node`, `dotenv`

2. **src/config/configuration.ts**
   - Added `llm.enableFallback` configuration option
   - Controls whether to use LLM for unknown words

3. **src/dictionary/dictionary.service.ts**
   - Added `llmFallbackEnabled` property
   - Modified `lookupWord()` to check configuration before falling back to LLM
   - Now returns 404 when word not found and fallback disabled

4. **.env.example**
   - Added database configuration variables
   - Added `LLM_FALLBACK_ENABLED` flag with documentation

## Database Schema (Already Exists)

The following tables are already defined via TypeORM entities:

- **words** - Main word entries with frequency ranking
- **pronunciations** - IPA notation and audio URLs (US/UK accents)
- **definitions** - Multiple definitions per word with part of speech
- **examples** - Example sentences linked to definitions
- **word_forms** - Plural, past tense, comparative, etc.
- **synonyms** - Related words

## How It Works

### Data Flow

```
Raw Data Sources
       ↓
[Wiktionary] + [CMU Dict] + [WordNet]
       ↓
Parse Scripts (separate JSON files)
       ↓
Combine Script (merge + deduplicate)
       ↓
Single JSON File (~150k-200k words)
       ↓
Import Script (batched database insertion)
       ↓
PostgreSQL Database
       ↓
Dictionary API (query with optional LLM fallback)
```

### API Behavior

**Before** (AI-only):
- Every word lookup calls LLM
- Slow response times (2-5 seconds)
- Inconsistent results
- High resource usage

**After** (Database-first):
1. Check database first (fast: <50ms)
2. If found: return authoritative data
3. If not found and `LLM_FALLBACK_ENABLED=true`: generate with LLM
4. If not found and `LLM_FALLBACK_ENABLED=false`: return 404

### Configuration Modes

#### Development Mode (with LLM fallback)
```env
LLM_FALLBACK_ENABLED=true
```
- Best for development and testing
- Handles rare/new words gracefully
- Requires LLM service running

#### Production Mode (database-only)
```env
LLM_FALLBACK_ENABLED=false
```
- Best for production with complete dictionary
- Fastest performance
- No LLM required
- Returns 404 for unknown words

## Usage Instructions

### Quick Setup (First Time)

```bash
# 1. Navigate to API directory
cd english-learning-api

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Download data sources (~2GB, takes 30-60 mins)
chmod +x scripts/download-sources.sh
./scripts/download-sources.sh

# 5. Parse Wiktionary (takes 2-4 hours)
npm run parse-wiktionary

# 6. Parse CMU Dictionary (takes 1-2 mins)
npm run parse-cmu

# 7. Parse WordNet (takes 5-10 mins)
npm run parse-wordnet

# 8. Combine all sources
npm run combine-data

# 9. Import to database (takes 30-60 mins)
npm run import-to-db

# 10. Optional: Disable LLM fallback for production
# Edit .env: LLM_FALLBACK_ENABLED=false
```

### Regular Usage (After Setup)

```bash
# Start the API server
npm run start:dev

# The dictionary endpoints now use database-first approach:
# GET /dictionary/lookup/hello - Returns data from database
# GET /dictionary/search?q=hel - Autocomplete from database
```

## Expected Results

### Data Statistics (After Import)

- **Total words:** ~150,000 - 200,000
- **With pronunciations:** ~95% (US/UK IPA)
- **With definitions:** ~100%
- **With examples:** ~80%
- **With synonyms:** ~60%
- **With word forms:** ~40%
- **Frequency ranked:** ~5,000 most common words

### Performance Improvements

- **Lookup speed:** 2-5s (LLM) → <50ms (database)
- **Consistency:** Variable → 100% consistent
- **Offline capable:** No → Yes (when LLM fallback disabled)
- **Resource usage:** High → Minimal

### Data Quality Improvements

- **IPA accuracy:** AI-generated → Authoritative (Wiktionary + CMU)
- **Definitions:** AI-generated → Human-curated (Wiktionary)
- **Examples:** AI-generated → Real usage (Wiktionary)
- **Synonyms:** None → Comprehensive (WordNet)
- **Coverage:** Limited → 150k-200k words

## Disk Space Requirements

- **Raw data:** ~2GB
  - Wiktionary dump: ~1.5GB (compressed)
  - CMU Dictionary: ~3MB
  - WordNet: ~10MB

- **Parsed data:** ~500MB-1GB
  - wiktionary.json: ~400MB
  - cmu-dict.json: ~30MB
  - wordnet.json: ~50MB
  - combined/dictionary.json: ~500MB

- **Database:** ~1-2GB
  - Depends on PostgreSQL storage and indexes

**Total:** ~4-5GB for complete setup

## Migration Checklist

- [x] Create data download script
- [x] Create Wiktionary parser
- [x] Create CMU Dictionary parser
- [x] Create WordNet parser
- [x] Create data combination script
- [x] Create database import script
- [x] Add npm scripts to package.json
- [x] Update configuration to support fallback toggle
- [x] Update dictionary service to respect configuration
- [x] Create comprehensive documentation
- [x] Update .env.example with new variables

## Next Steps (Optional Enhancements)

1. **Add Vietnamese Translations**
   - Use Google Translate API to add Vietnamese definitions
   - Update combine-data.ts to include translation step

2. **Add Audio Files**
   - Download MP3 files from Forvo or other sources
   - Store in filesystem or S3
   - Update pronunciations table with local paths

3. **Add Word Frequency Data**
   - Download COCA (Corpus of Contemporary American English) frequency list
   - Update import script to add frequency ranks
   - Improves search ranking and difficulty level assignment

4. **Incremental Updates**
   - Add timestamp tracking to words
   - Implement delta updates instead of full reimport
   - Schedule weekly/monthly update jobs

5. **Add More Languages**
   - Parse other Wiktionary dumps (French, Spanish, etc.)
   - Modify schema to support multiple languages per word
   - Update API to handle language parameter

6. **Performance Optimization**
   - Add full-text search indexes for definitions
   - Implement caching layer (Redis) for common words
   - Add database partitioning for very large datasets

## Troubleshooting

### Import fails with "relation does not exist"
**Solution:** Run TypeORM migrations or set `synchronize: true` in app.module.ts temporarily to create tables.

### Out of memory during Wiktionary parsing
**Solution:** The parser uses streaming to minimize memory usage, but still needs ~4GB RAM. Close other applications or upgrade machine.

### LLM fallback not working
**Solution:** Check that `LLM_FALLBACK_ENABLED=true` in .env and that the vLLM service is running at the configured URL.

### Word lookup returns 404 after import
**Solution:** Check that the word is actually in the database. Try enabling LLM fallback temporarily or verify the import completed successfully.

## Support and Maintenance

- The parsing scripts are idempotent and can be re-run safely
- Use `npm run import-to-db:clear` to clear database before reimporting
- Keep raw data directory for future updates
- Update data sources periodically (Wiktionary updates weekly)

## License Compliance

When distributing or using this dictionary data:

1. **Wiktionary**: Licensed under CC BY-SA 3.0
   - Attribution required
   - Share-alike (modifications must use same license)

2. **CMU Dictionary**: Public Domain
   - No restrictions

3. **WordNet**: WordNet License (BSD-style)
   - Attribution required in documentation
   - Free for research and commercial use

Include appropriate license notices in your application's documentation and about page.
