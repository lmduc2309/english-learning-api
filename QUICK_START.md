# Quick Start Guide - Dictionary Database Setup

## TL;DR

Transform your dictionary from AI-generated to authoritative data in 5 steps:

```bash
# 1. Download data (~30-60 mins, ~2GB)
./scripts/download-sources.sh

# 2. Parse all sources (~3-4 hours total)
npm run parse-wiktionary  # ~2-4 hours
npm run parse-cmu         # ~1-2 mins
npm run parse-wordnet     # ~5-10 mins

# 3. Combine data (~2-5 mins)
npm run combine-data

# 4. Import to database (~30-60 mins)
npm run import-to-db

# 5. Optional: Disable LLM fallback for production
# Edit .env: LLM_FALLBACK_ENABLED=false
```

## Prerequisites

✅ Node.js 16+
✅ PostgreSQL 12+ (running)
✅ ~5GB free disk space
✅ 4GB RAM minimum
✅ Internet connection (for downloads)

## Step-by-Step

### 1. Setup

```bash
cd english-learning-api
npm install
cp .env.example .env
# Edit .env with your database credentials
```

### 2. Download Data Sources

```bash
chmod +x scripts/download-sources.sh
./scripts/download-sources.sh
```

**Downloads:**
- Wiktionary (~1.5GB) - Definitions, examples, IPA
- CMU Dictionary (~3MB) - Pronunciations
- WordNet (~10MB) - Synonyms, word forms

**Time:** 30-60 minutes depending on internet speed

### 3. Parse Data

**Option A: Run all at once (recommended overnight)**
```bash
npm run parse-wiktionary && npm run parse-cmu && npm run parse-wordnet && npm run combine-data
```

**Option B: Run separately**
```bash
# Parse Wiktionary (SLOW: 2-4 hours)
npm run parse-wiktionary
# Output: data/parsed/wiktionary.json (~400MB, ~150k words)

# Parse CMU Dict (FAST: 1-2 mins)
npm run parse-cmu
# Output: data/parsed/cmu-dict.json (~30MB, ~134k pronunciations)

# Parse WordNet (MEDIUM: 5-10 mins)
npm run parse-wordnet
# Output: data/parsed/wordnet.json (~50MB, ~150k words with synonyms)
```

### 4. Combine Data

```bash
npm run combine-data
```

**Output:** `data/combined/dictionary.json` (~500MB)

Combines all three sources:
- Wiktionary → Base data (definitions + examples)
- CMU Dict → Adds/supplements pronunciations
- WordNet → Adds synonyms and word forms

**Time:** 2-5 minutes

### 5. Import to Database

```bash
# First time import
npm run import-to-db

# Clear database and reimport (CAUTION: deletes all dictionary data)
npm run import-to-db:clear
```

**Time:** 30-60 minutes for ~150k-200k words
**Progress:** Shows batches being imported in real-time

### 6. Verify

```bash
# Check database
psql -U postgres -d english_learning -c "SELECT COUNT(*) FROM words;"

# Test API
curl http://localhost:7474/dictionary/lookup/hello
```

### 7. Configure Production Mode (Optional)

For best performance after importing data:

```env
# .env
LLM_FALLBACK_ENABLED=false  # Only use database, no AI fallback
```

## Results

After import you'll have:

- **~150,000-200,000 words** in database
- **<50ms lookup time** (vs 2-5s with AI)
- **Authoritative data** from trusted sources
- **Offline capable** (when LLM fallback disabled)

## Common Issues

**"Out of memory" during Wiktionary parsing**
→ Close other applications, need ~4GB RAM available

**"Cannot connect to database"**
→ Check PostgreSQL is running: `psql -U postgres -l`

**"npm run parse-wiktionary" is too slow**
→ This is normal! It processes 10GB+ of text. Run overnight.

**"Word not found" after import**
→ Check word is in database, or enable LLM fallback temporarily

## What's Next?

Read the full guides for more details:

- [DICTIONARY_SETUP.md](DICTIONARY_SETUP.md) - Complete setup instructions
- [DICTIONARY_MIGRATION_SUMMARY.md](DICTIONARY_MIGRATION_SUMMARY.md) - Technical details
- [scripts/README.md](scripts/README.md) - Script documentation

## Help

Having issues? Check:
1. Console output for specific errors
2. Database connection and credentials
3. Disk space (~5GB needed)
4. RAM availability (~4GB for Wiktionary parsing)

## Time Estimates

| Step | Time | Can Skip? |
|------|------|-----------|
| Download | 30-60 mins | No |
| Parse Wiktionary | 2-4 hours | No |
| Parse CMU | 1-2 mins | No |
| Parse WordNet | 5-10 mins | Optional* |
| Combine | 2-5 mins | No |
| Import | 30-60 mins | No |

*WordNet is optional but highly recommended for synonyms

**Total Time:** ~4-6 hours (mostly automated, can run overnight)

## Pro Tips

1. **Run parsing overnight** - It's CPU-intensive but doesn't need supervision
2. **Keep raw data** - Saves hours if you need to reparse
3. **Test with small subset** - Modify import script to limit rows for testing
4. **Monitor disk space** - Need ~5GB total, watch during Wiktionary extraction
5. **Backup before reimport** - Use `pg_dump` if you have existing data

---

**Ready?** Start with step 1! ⬆️
