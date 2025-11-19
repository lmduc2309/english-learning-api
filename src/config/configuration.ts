export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  llm: {
    url: process.env.VLLM_URL || 'http://localhost:8000/v1/completions',
    model: process.env.VLLM_MODEL || 'microsoft/Phi-3-mini-4k-instruct',
  },
});