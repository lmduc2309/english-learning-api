export default () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const commercialSafeMode = process.env.COMMERCIAL_SAFE_MODE == null
    ? nodeEnv === 'production'
    : process.env.COMMERCIAL_SAFE_MODE === 'true';

  return {
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv,
    content: {
      // Production fails closed by default. In this mode only published learner
      // overlay rows may cross public API/export boundaries; legacy/reference
      // rows and generated fallbacks remain internal.
      commercialSafeMode,
      allowGeneratedContent:
        commercialSafeMode &&
        process.env.COMMERCIAL_ALLOW_GENERATED_CONTENT === 'true',
    },
    dsd: {
      // Full validation lives in src/dsd-corpus/dsd-corpus.config.ts. Only the
      // channel is surfaced here, so routing can read it without importing the
      // DSD data source.
      database: process.env.DSD_DB_DATABASE || 'dsd_corpus_db',
      releaseChannel: process.env.DSD_RELEASE_CHANNEL || 'off',
    },
    llm: {
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
      model: process.env.LLM_MODEL || 'openai/gpt-4o-mini',
      enableFallback: process.env.LLM_FALLBACK_ENABLED !== 'false',
      appTitle: process.env.LLM_APP_TITLE || 'english-learning-api',
      httpReferer: process.env.LLM_HTTP_REFERER,
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'english_learning',
    },
    ttsService: {
      url: process.env.TTS_SERVICE_URL || 'http://localhost:8001',
    },
  };
};
