# Dictionary Data Import Scripts

This directory contains scripts to populate the dictionary database from authoritative sources.

**📖 For complete documentation, see [DATABASE_GENERATION.md](../DATABASE_GENERATION.md)**

## Quick Start

**Automated (Recommended):**
```bash
npm run generate-db
```

**Manual step-by-step:** See usage section below.

## Data Sources

1. **Wiktionary** - Word definitions, IPA pronunciations, examples
   - Download: https://dumps.wikimedia.org/enwiktionary/latest/
   - File: `enwiktionary-latest-pages-articles.xml.bz2`

2. **CMU Pronouncing Dictionary** - Phonetic pronunciations (ARPAbet format)
   - Download: http://www.speech.cs.cmu.edu/cgi-bin/cmudict
   - Alternative: https://github.com/cmusphinx/cmudict

3. **WordNet** - Semantic relationships, synonyms, word forms
   - Download: https://wordnet.princeton.edu/download
   - Alternative: Use `wn` npm package

## Scripts

- `download-sources.sh` - Downloads all data sources
- `parse-wiktionary.ts` - Parses Wiktionary XML dump
- `parse-cmu-dict.ts` - Parses CMU Pronouncing Dictionary
- `parse-wordnet.ts` - Extracts data from WordNet
- `combine-data.ts` - Combines all sources into final dataset
- `import-to-db.ts` - Imports combined data into PostgreSQL

## Usage

```bash
# 1. Install dependencies
npm install

# 2. Download data sources (this will take time and disk space)
./scripts/download-sources.sh

# 3. Parse individual sources
npm run parse-wiktionary
npm run parse-cmu
npm run parse-wordnet

# 4. Combine all data
npm run combine-data

# 5. Import to database
npm run import-to-db
```

## Data Directory Structure

```
data/
├── raw/                    # Downloaded source files
│   ├── wiktionary/
│   ├── cmu-dict/
│   └── wordnet/
├── parsed/                 # Parsed intermediate data
│   ├── wiktionary.json
│   ├── cmu-dict.json
│   └── wordnet.json
└── combined/              # Final combined dataset
    └── dictionary.json
```

## Requirements

- Node.js 16+
- PostgreSQL 12+
- ~5GB disk space for raw data
- ~2GB disk space for parsed data
