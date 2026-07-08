# AI Vietnamese Translation

Batch-translates English definitions and examples to Vietnamese using **Qwen3.6 Plus** via [OpenRouter](https://openrouter.ai/).

## Setup

1. Get an API key at https://openrouter.ai/keys
2. Add to `.env`:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxx
   ```
3. (Recommended) Purchase $10 credits on OpenRouter for 1,000 req/day limit

## Usage

```bash
# Translate definitions (most common words first)
npm run ai-translate

# Translate example sentences
npm run ai-translate:examples

# Preview without saving
npm run ai-translate:dry

# Check progress
npm run ai-translate:stats

# Translate specific word
npm run ai-translate -- --word love

# Limit to N items
npm run ai-translate -- --limit 500

# Custom batch size (default: 15)
npm run ai-translate -- --batch-size 20

# Reset failed items for retry
npm run ai-translate -- --reset

# Combine options
npm run ai-translate -- --type definitions --limit 1000 --batch-size 20
```

## How It Works

1. Fetches untranslated definitions/examples from PostgreSQL (ordered by word frequency)
2. Groups them into batches of 15 (configurable)
3. Sends each batch to Qwen3.6 Plus with a structured prompt
4. Parses the JSON response and writes translations back to DB
5. Tracks progress in a local SQLite DB (`data/ai-translate-progress.db`)

### Resumable

The script is fully resumable. If interrupted (Ctrl+C), it saves progress and skips already-translated items on the next run.

### Rate Limits

| Account Type | Requests/min | Requests/day | Defs/day (batch=15) |
|-------------|-------------|-------------|-------------------|
| Free (no credits) | 20 | 50 | ~750 |
| Free ($10+ credits) | 20 | 1,000 | ~15,000 |

## Configuration

Environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | (required) | Your OpenRouter API key |
| `OPENROUTER_MODEL` | `qwen/qwen3.6-plus:free` | Model to use |
| `AI_TRANSLATE_BATCH_SIZE` | `15` | Items per API request |
| `AI_TRANSLATE_MAX_RPM` | `20` | Max requests per minute |
| `AI_TRANSLATE_MAX_DAILY` | `1000` | Max requests per day |

## Files

```
scripts/ai-translate/
├── index.ts               # CLI entry point
├── config.ts              # Environment config
├── types.ts               # TypeScript interfaces
├── openrouter-client.ts   # OpenRouter API client with rate limiting
├── prompts.ts             # Translation prompt templates
├── batch-processor.ts     # Batch orchestration pipeline
├── progress-tracker.ts    # SQLite progress tracking
├── db-connector.ts        # PostgreSQL read/write
└── README.md              # This file
```
