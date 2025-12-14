-- English Learning Dictionary Database Schema
-- PostgreSQL 15+

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- Words table (core vocabulary)
CREATE TABLE IF NOT EXISTS words (
  id BIGSERIAL PRIMARY KEY,
  word VARCHAR(255) UNIQUE NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  word_normalized VARCHAR(255) NOT NULL,
  frequency_rank INTEGER,
  part_of_speech TEXT[], -- array of POS tags
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_words_normalized ON words USING gin(word_normalized gin_trgm_ops);
CREATE INDEX idx_words_frequency ON words(frequency_rank);
CREATE INDEX idx_words_language ON words(language);

-- Definitions table
CREATE TABLE IF NOT EXISTS definitions (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  part_of_speech VARCHAR(50) NOT NULL,
  definition_en TEXT NOT NULL,
  definition_vi TEXT NOT NULL,
  level VARCHAR(20) DEFAULT 'intermediate',
  definition_order INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_definitions_word ON definitions(word_id);
CREATE INDEX idx_definitions_level ON definitions(level);

-- Examples table
CREATE TABLE IF NOT EXISTS examples (
  id BIGSERIAL PRIMARY KEY,
  definition_id BIGINT NOT NULL REFERENCES definitions(id) ON DELETE CASCADE,
  example_en TEXT NOT NULL,
  example_vi TEXT NOT NULL,
  source VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_examples_definition ON examples(definition_id);

-- Pronunciations table
CREATE TABLE IF NOT EXISTS pronunciations (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  accent VARCHAR(10) NOT NULL,
  ipa TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pronunciations_word ON pronunciations(word_id);

-- Synonyms table
CREATE TABLE IF NOT EXISTS synonyms (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  synonym_word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  context TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(word_id, synonym_word_id)
);

CREATE INDEX idx_synonyms_word ON synonyms(word_id);

-- Word forms table (plurals, tenses, etc.)
CREATE TABLE IF NOT EXISTS word_forms (
  id BIGSERIAL PRIMARY KEY,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  form_type VARCHAR(50) NOT NULL,
  form_word VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_word_forms_word ON word_forms(word_id);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  username VARCHAR(100) UNIQUE,
  full_name VARCHAR(255),
  preferred_language VARCHAR(10) DEFAULT 'vi',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- User history table
CREATE TABLE IF NOT EXISTS user_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_history_user ON user_history(user_id, searched_at DESC);
CREATE INDEX idx_user_history_word ON user_history(word_id);

-- User favorites table
CREATE TABLE IF NOT EXISTS user_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, word_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites(user_id, created_at DESC);

-- Translations table
CREATE TABLE IF NOT EXISTS translations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang VARCHAR(10) NOT NULL,
  target_lang VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_translations_user ON translations(user_id, created_at DESC);

-- Vocabulary lists table
CREATE TABLE IF NOT EXISTS vocabulary_lists (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vocab_lists_user ON vocabulary_lists(user_id);

-- Vocabulary list items
CREATE TABLE IF NOT EXISTS vocabulary_list_items (
  id BIGSERIAL PRIMARY KEY,
  list_id BIGINT NOT NULL REFERENCES vocabulary_lists(id) ON DELETE CASCADE,
  word_id BIGINT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  notes TEXT,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(list_id, word_id)
);

CREATE INDEX idx_vocab_list_items_list ON vocabulary_list_items(list_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_words_updated_at BEFORE UPDATE ON words
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vocab_lists_updated_at BEFORE UPDATE ON vocabulary_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data for testing
INSERT INTO words (word, word_normalized, frequency_rank, part_of_speech) VALUES
('hello', 'hello', 150, ARRAY['interjection', 'noun', 'verb']),
('world', 'world', 280, ARRAY['noun']),
('dictionary', 'dictionary', 3500, ARRAY['noun']),
('learn', 'learn', 420, ARRAY['verb']),
('example', 'example', 890, ARRAY['noun'])
ON CONFLICT (word) DO NOTHING;

-- Add pronunciations
INSERT INTO pronunciations (word_id, accent, ipa, audio_url)
SELECT id, 'US', '/həˈloʊ/', null FROM words WHERE word = 'hello'
UNION ALL
SELECT id, 'UK', '/həˈləʊ/', null FROM words WHERE word = 'hello'
ON CONFLICT DO NOTHING;

-- Add definitions
INSERT INTO definitions (word_id, part_of_speech, definition_en, definition_vi, level, definition_order)
SELECT id, 'interjection', 'used as a greeting or to begin a phone conversation', 'xin chào, chào', 'beginner', 1
FROM words WHERE word = 'hello'
UNION ALL
SELECT id, 'noun', 'an utterance of "hello"; a greeting', 'lời chào', 'intermediate', 2
FROM words WHERE word = 'hello'
ON CONFLICT DO NOTHING;

-- Add examples
INSERT INTO examples (definition_id, example_en, example_vi, source)
SELECT d.id, 'Hello! How are you?', 'Xin chào! Bạn khỏe không?', 'common_phrases'
FROM definitions d
JOIN words w ON d.word_id = w.id
WHERE w.word = 'hello' AND d.definition_order = 1
ON CONFLICT DO NOTHING;

COMMIT;
