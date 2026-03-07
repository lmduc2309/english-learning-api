#!/bin/bash

# Script to download dictionary data sources
# Run from the english-learning-api directory

set -e  # Exit on error

echo "=== Dictionary Data Download Script ==="
echo ""

# Create directory structure
echo "Creating data directories..."
mkdir -p data/raw/wiktionary
mkdir -p data/raw/cmu-dict
mkdir -p data/raw/wordnet
mkdir -p data/parsed
mkdir -p data/combined

# Download Wiktionary dump
echo ""
echo "=== Downloading Wiktionary (this will take a while, ~1.5GB) ==="
if [ -f "data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2" ]; then
    echo "Wiktionary dump already exists, skipping..."
else
    curl -L "https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-pages-articles.xml.bz2" \
        -o "data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2"
    echo "Wiktionary downloaded successfully"
fi

# Download CMU Pronouncing Dictionary
echo ""
echo "=== Downloading CMU Pronouncing Dictionary ==="
if [ -f "data/raw/cmu-dict/cmudict.dict" ]; then
    echo "CMU Dict already exists, skipping..."
else
    # Download from GitHub (more reliable than original source)
    curl -L "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict" \
        -o "data/raw/cmu-dict/cmudict.dict"
    echo "CMU Dict downloaded successfully"
fi

# Download WordNet
echo ""
echo "=== Downloading WordNet ==="
if [ -f "data/raw/wordnet/WordNet-3.0.tar.bz2" ]; then
    echo "WordNet already exists, skipping..."
else
    curl -L "http://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.bz2" \
        -o "data/raw/wordnet/WordNet-3.0.tar.bz2"

    # Extract WordNet
    echo "Extracting WordNet..."
    cd data/raw/wordnet
    tar -xjf WordNet-3.0.tar.bz2
    cd ../../..
    echo "WordNet downloaded and extracted successfully"
fi

echo ""
echo "=== Download Complete ==="
echo ""
echo "Data locations:"
echo "  Wiktionary: data/raw/wiktionary/enwiktionary-latest-pages-articles.xml.bz2"
echo "  CMU Dict:   data/raw/cmu-dict/cmudict.dict"
echo "  WordNet:    data/raw/wordnet/WordNet-3.0/"
echo ""
echo "Next steps:"
echo "  1. Run: npm run parse-wiktionary"
echo "  2. Run: npm run parse-cmu"
echo "  3. Run: npm run parse-wordnet"
echo "  4. Run: npm run combine-data"
echo "  5. Run: npm run import-to-db"
