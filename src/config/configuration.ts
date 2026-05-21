export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
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
});