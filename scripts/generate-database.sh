#!/bin/bash

# =============================================================================
# Dictionary Database Generation Script
# =============================================================================
# This script automates the entire process of generating and importing
# dictionary data into PostgreSQL from authoritative sources.
#
# Steps:
# 1. Parse Wiktionary XML dump
# 2. Parse CMU Pronouncing Dictionary
# 3. Parse WordNet
# 4. Combine all data sources
# 5. Clear existing database (optional)
# 6. Import to PostgreSQL
#
# Usage:
#   ./scripts/generate-database.sh [--skip-parsing] [--no-clear]
#
# Options:
#   --skip-parsing    Skip parsing steps (use existing parsed data)
#   --no-clear        Don't clear database before import (append mode)
#
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SKIP_PARSING=false
NO_CLEAR=false
START_TIME=$(date +%s)

# Parse command line arguments
for arg in "$@"; do
  case $arg in
    --skip-parsing)
      SKIP_PARSING=true
      shift
      ;;
    --no-clear)
      NO_CLEAR=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-parsing    Skip parsing steps (use existing parsed data)"
      echo "  --no-clear        Don't clear database before import"
      echo "  --help            Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Helper functions
print_header() {
  echo ""
  echo -e "${BLUE}============================================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}============================================================${NC}"
  echo ""
}

print_step() {
  echo -e "${GREEN}▶ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

check_file() {
  if [ ! -f "$1" ]; then
    print_error "Required file not found: $1"
    return 1
  fi
  return 0
}

# Check prerequisites
print_header "Checking Prerequisites"

print_step "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  print_error "Node.js is not installed. Please install Node.js 16+ first."
  exit 1
fi
NODE_VERSION=$(node --version)
print_success "Node.js $NODE_VERSION found"

print_step "Checking PostgreSQL connection..."
if ! npm run --silent test-db-connection &> /dev/null; then
  print_warning "Cannot connect to PostgreSQL. Make sure it's running and configured in .env"
  print_warning "Continuing anyway - will fail at import step if DB is not ready"
fi

print_step "Checking required directories..."
mkdir -p data/raw/wiktionary
mkdir -p data/raw/cmu-dict
mkdir -p data/raw/wordnet
mkdir -p data/parsed
mkdir -p data/combined
print_success "Directories ready"

# Step 1: Parse Wiktionary
if [ "$SKIP_PARSING" = false ]; then
  print_header "Step 1/6: Parsing Wiktionary"

  print_step "Checking for Wiktionary data file..."
  if check_file "data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2"; then
    print_success "Wiktionary dump found"
    print_step "Starting Wiktionary parsing (this may take 15-30 minutes)..."

    PARSE_START=$(date +%s)
    npm run parse-wiktionary
    PARSE_END=$(date +%s)
    PARSE_TIME=$((PARSE_END - PARSE_START))

    print_success "Wiktionary parsed in ${PARSE_TIME}s"
  else
    print_error "Wiktionary dump not found. Please download it first:"
    echo "  cd data/raw/wiktionary"
    echo "  wget https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-pages-articles.xml.bz2"
    exit 1
  fi

  # Step 2: Parse CMU Dictionary
  print_header "Step 2/6: Parsing CMU Pronouncing Dictionary"

  print_step "Checking for CMU Dictionary data..."
  if check_file "data/raw/cmu-dict/cmudict-0.7b"; then
    print_success "CMU Dictionary found"
    print_step "Parsing CMU Dictionary..."
    npm run parse-cmu
    print_success "CMU Dictionary parsed"
  else
    print_warning "CMU Dictionary not found. Skipping pronunciation data from CMU."
    print_warning "To include it, download from:"
    echo "  cd data/raw/cmu-dict"
    echo "  wget https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"
    echo "  mv cmudict.dict cmudict-0.7b"
  fi

  # Step 3: Parse WordNet
  print_header "Step 3/6: Parsing WordNet"

  print_step "Checking for WordNet data..."
  if [ -d "data/raw/wordnet" ] && [ "$(ls -A data/raw/wordnet)" ]; then
    print_success "WordNet data found"
    print_step "Parsing WordNet..."
    npm run parse-wordnet
    print_success "WordNet parsed"
  else
    print_warning "WordNet data not found. Skipping synonyms and word forms."
    print_warning "To include it, download from:"
    echo "  https://wordnet.princeton.edu/download"
  fi
else
  print_header "Skipping Parsing Steps (using existing parsed data)"

  # Verify parsed files exist
  print_step "Checking for parsed data files..."
  if ! check_file "data/parsed/wiktionary.json"; then
    print_error "Parsed Wiktionary data not found. Run without --skip-parsing first."
    exit 1
  fi
  print_success "Parsed data files found"
fi

# Step 4: Combine Data
print_header "Step 4/6: Combining Data Sources"

print_step "Merging Wiktionary, CMU Dict, and WordNet..."
npm run combine-data
print_success "Data sources combined successfully"

print_step "Checking combined data..."
if check_file "data/combined/dictionary.json"; then
  WORD_COUNT=$(jq 'length' data/combined/dictionary.json)
  print_success "Combined dictionary contains $WORD_COUNT words"
else
  print_error "Combined dictionary file not created"
  exit 1
fi

# Step 5: Database Operations
print_header "Step 5/6: Database Import"

if [ "$NO_CLEAR" = false ]; then
  print_warning "This will CLEAR all existing dictionary data from the database!"
  echo -n "Are you sure you want to continue? (yes/no): "
  read -r response

  if [ "$response" != "yes" ]; then
    print_warning "Database import cancelled"
    exit 0
  fi

  print_step "Clearing existing database..."
  echo "yes" | npm run import-to-db:clear
else
  print_step "Importing to database (append mode)..."
  npm run import-to-db
fi

# Step 6: Verification
print_header "Step 6/6: Verification"

print_step "Verifying database import..."
# Create a simple verification query
cat > /tmp/verify-db.js << 'EOF'
const { DataSource } = require('typeorm');
const { Word } = require('./dist/dictionary/entities/word.entity');
require('dotenv').config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [Word],
  synchronize: false,
});

async function verify() {
  await dataSource.initialize();
  const count = await dataSource.getRepository(Word).count();
  console.log(count);
  await dataSource.destroy();
}

verify().catch(() => process.exit(1));
EOF

# Compile TypeScript if needed
if [ ! -d "dist" ]; then
  print_step "Compiling TypeScript..."
  npm run build
fi

# Run verification
if IMPORTED_COUNT=$(node /tmp/verify-db.js 2>/dev/null); then
  print_success "Database import verified: $IMPORTED_COUNT words in database"
  rm /tmp/verify-db.js
else
  print_warning "Could not verify database import automatically"
  print_warning "Please check manually by querying the database"
fi

# Summary
print_header "Generation Complete!"

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

echo -e "${GREEN}Database generation completed successfully!${NC}"
echo ""
echo "Summary:"
echo "  • Total time: ${MINUTES}m ${SECONDS}s"
echo "  • Words in combined dictionary: $WORD_COUNT"
if [ -n "$IMPORTED_COUNT" ]; then
  echo "  • Words imported to database: $IMPORTED_COUNT"
fi
echo ""
echo "Next steps:"
echo "  1. Start the API server: npm run start:dev"
echo "  2. Test a word lookup: curl http://localhost:7474/api/dictionary/word/love"
echo "  3. Check the frontend to verify definitions display correctly"
echo ""
print_success "All done! 🎉"
