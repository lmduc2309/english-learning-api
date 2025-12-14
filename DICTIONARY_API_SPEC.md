# Dictionary API Specification

## Database Schema

### Tables

#### 1. `words` table
```sql
CREATE TABLE words (
  id BIGSERIAL PRIMARY KEY,
  word VARCHAR(255) UNIQUE NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  word_normalized VARCHAR(255), -- lowercase, for search
  frequency_rank INTEGER, -- how common the word is
  part_of_speech VARCHAR(50)[], -- ['noun', 'verb']
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_words_normalized ON words(word_normalized);
CREATE INDEX idx_words_frequency ON words(frequency_rank);
```

#### 2. `definitions` table
```sql
CREATE TABLE definitions (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  part_of_speech VARCHAR(50), -- noun, verb, adjective, etc.
  definition_en TEXT NOT NULL,
  definition_vi TEXT NOT NULL,
  level VARCHAR(20), -- beginner, intermediate, advanced
  definition_order INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_definitions_word ON definitions(word_id);
```

#### 3. `examples` table
```sql
CREATE TABLE examples (
  id BIGSERIAL PRIMARY KEY,
  definition_id BIGINT REFERENCES definitions(id) ON DELETE CASCADE,
  example_en TEXT NOT NULL,
  example_vi TEXT NOT NULL,
  source VARCHAR(255), -- where example came from
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 4. `pronunciations` table
```sql
CREATE TABLE pronunciations (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  accent VARCHAR(10), -- US, UK, AU
  ipa TEXT NOT NULL, -- phonetic transcription
  audio_url TEXT, -- URL to audio file
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 5. `synonyms` table
```sql
CREATE TABLE synonyms (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  synonym_word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  context TEXT, -- when this synonym applies
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 6. `word_forms` table
```sql
CREATE TABLE word_forms (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  form_type VARCHAR(50), -- plural, past, present, comparative, etc.
  form_word VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 7. `user_history` table
```sql
CREATE TABLE user_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  searched_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_history_user ON user_history(user_id, searched_at DESC);
```

#### 8. `user_favorites` table
```sql
CREATE TABLE user_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  word_id BIGINT REFERENCES words(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, word_id)
);
```

#### 9. `translations` table
```sql
CREATE TABLE translations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_translations_user ON translations(user_id, created_at DESC);
```

## API Endpoints

### Word Search & Lookup

#### `GET /api/dictionary/search`
Search for words with autocomplete
```json
Query: ?q=hello&limit=10
Response: {
  "suggestions": [
    {
      "word": "hello",
      "frequency_rank": 150,
      "pos": ["noun", "verb", "interjection"]
    },
    {
      "word": "helicopter",
      "frequency_rank": 3420,
      "pos": ["noun"]
    }
  ]
}
```

#### `GET /api/dictionary/word/:word`
Get complete word information
```json
Response: {
  "word": "hello",
  "pronunciations": [
    {"accent": "US", "ipa": "/həˈloʊ/", "audio_url": "..."},
    {"accent": "UK", "ipa": "/həˈləʊ/", "audio_url": "..."}
  ],
  "definitions": [
    {
      "id": 1,
      "pos": "interjection",
      "definition_en": "used as a greeting",
      "definition_vi": "xin chào, chào",
      "level": "beginner",
      "examples": [
        {
          "en": "Hello! How are you?",
          "vi": "Xin chào! Bạn khỏe không?"
        }
      ]
    },
    {
      "id": 2,
      "pos": "noun",
      "definition_en": "an utterance of 'hello'; a greeting",
      "definition_vi": "lời chào",
      "level": "intermediate",
      "examples": [...]
    }
  ],
  "word_forms": {
    "plural": "hellos",
    "present": "helloing"
  },
  "synonyms": ["hi", "hey", "greetings"],
  "frequency_rank": 150
}
```

#### `POST /api/dictionary/word/:word/history`
Add word to user's search history
```json
Request: {
  "user_id": 123
}
Response: {
  "success": true
}
```

### Translation

#### `POST /api/dictionary/translate`
Translate text
```json
Request: {
  "text": "Hello world",
  "source_lang": "en",
  "target_lang": "vi",
  "user_id": 123
}
Response: {
  "original_text": "Hello world",
  "translated_text": "Xin chào thế giới",
  "source_lang": "en",
  "target_lang": "vi",
  "detected_lang": "en"
}
```

#### `POST /api/dictionary/translate/ocr`
Translate text from image
```json
Request: multipart/form-data {
  "image": <file>,
  "source_lang": "en",
  "target_lang": "vi"
}
Response: {
  "extracted_text": "Hello world",
  "translated_text": "Xin chào thế giới",
  "confidence": 0.95
}
```

### User Features

#### `GET /api/dictionary/user/:userId/history`
Get user's search history
```json
Response: {
  "history": [
    {
      "word": "hello",
      "searched_at": "2025-01-10T10:30:00Z",
      "pos": ["interjection", "noun"]
    }
  ],
  "total": 45
}
```

#### `GET /api/dictionary/user/:userId/favorites`
Get user's favorite words
```json
Response: {
  "favorites": [
    {
      "word": "serendipity",
      "notes": "beautiful word!",
      "added_at": "2025-01-05T14:20:00Z"
    }
  ]
}
```

#### `POST /api/dictionary/user/:userId/favorites`
Add word to favorites
```json
Request: {
  "word": "hello",
  "notes": "Common greeting"
}
Response: {
  "success": true,
  "favorite_id": 123
}
```

#### `DELETE /api/dictionary/user/:userId/favorites/:word`
Remove word from favorites

### Dictionary Management (Admin)

#### `POST /api/dictionary/admin/import`
Bulk import dictionary data
```json
Request: {
  "source": "cambridge|oxford|custom",
  "data": [...]
}
```

#### `GET /api/dictionary/stats`
Get dictionary statistics
```json
Response: {
  "total_words": 50000,
  "total_definitions": 125000,
  "total_examples": 200000,
  "languages": ["en", "vi"]
}
```

## Data Sources

### Initial Population
1. **Free Dictionary APIs**:
   - FreeDictionaryAPI
   - WordsAPI
   - Dictionary API

2. **Open Source Dictionaries**:
   - OPTED (Online Plain Text English Dictionary)
   - English-Vietnamese dictionary datasets

3. **LLM-Generated**:
   - Use vLLM to generate Vietnamese translations
   - Generate example sentences
   - Create usage notes

### Pronunciation Audio
1. Generate using TTS services
2. Cache audio files in CDN
3. Store URLs in database

## Caching Strategy

```python
# Redis caching for frequent lookups
CACHE_CONFIG = {
    "word_lookup": 3600,  # 1 hour
    "search_suggestions": 600,  # 10 minutes
    "translations": 1800,  # 30 minutes
}
```

## Search Features

### Fuzzy Search
- Handle typos (Levenshtein distance)
- Phonetic matching
- Wildcard support (* and ?)

### Advanced Search
- Search by definition
- Search by example sentences
- Filter by level, POS, frequency
