import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'qwen/qwen3.6-plus:free',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    maxRPM: parseInt(process.env.AI_TRANSLATE_MAX_RPM || '20', 10),
    maxDaily: parseInt(process.env.AI_TRANSLATE_MAX_DAILY || '1000', 10),
    timeout: 120000,
    maxRetries: 3,
  },

  batch: {
    size: parseInt(process.env.AI_TRANSLATE_BATCH_SIZE || '15', 10),
    delayBetweenRequests: 3500, // ms — keeps under 20 req/min
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
  },

  progress: {
    // AI_TRANSLATE_PROGRESS_DB lets a rehearsal use a disposable file so it
    // cannot mark production items as done.
    dbPath:
      process.env.AI_TRANSLATE_PROGRESS_DB ||
      path.resolve(__dirname, '../../data/ai-translate-progress.db'),
  },
};

export function validateConfig(): void {
  if (!config.openRouter.apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is required. Add it to your .env file.\n' +
        'Get your key at: https://openrouter.ai/keys',
    );
  }
}
