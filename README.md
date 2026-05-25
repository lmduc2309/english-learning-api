# English Learning API

A NestJS-based REST API for an English learning application, powered by OpenRouter or any OpenAI-compatible LLM provider.

## Features

- 🤖 **LLM Integration**: Connect to OpenRouter or any OpenAI-compatible provider for AI-powered sentence generation
- 📝 **Generate Sentences**: Create example sentences using specific vocabulary words
- 💬 **Chat Assistant**: English teacher assistant for grammar and vocabulary questions
- 🎯 **Difficulty Levels**: Support for beginner, intermediate, and advanced levels
- 📚 **Swagger Documentation**: Interactive API documentation
- ✅ **Validation**: Request validation using class-validator
- 🔒 **Type Safety**: Full TypeScript support

## Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenRouter API key (or any OpenAI-compatible LLM provider)

## Installation

```bash
# Clone the repository
git clone https://github.com/lmduc2309/english-learning-api.git
cd english-learning-api

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

Update `.env` file with your LLM provider credentials:

```env
LLM_API_KEY=sk-your-api-key-here
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
PORT=3000
NODE_ENV=development
```

See `.env.example` for the full list of LLM_* environment variables.

## Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`

## API Documentation

Once the application is running, visit:
- **Swagger UI**: http://localhost:3000/api/docs
- **Health Check**: http://localhost:3000/api/llm/health

## API Endpoints

### Health Check
```bash
GET /api/llm/health
```

### Generate Sentences
```bash
POST /api/llm/generate-sentences
Content-Type: application/json

{
  "words": ["apple", "happy", "quickly"],
  "numSentences": 3,
  "difficulty": "intermediate",
  "temperature": 0.7
}
```

### Chat
```bash
POST /api/llm/chat
Content-Type: application/json

{
  "message": "What is the difference between affect and effect?",
  "temperature": 0.7,
  "maxTokens": 200
}
```

## Project Structure

```
english-learning-api/
├── src/
│   ├── config/
│   │   └── configuration.ts       # App configuration
│   ├── llm/
│   │   ├── dto/
│   │   │   ├── generate-sentences.dto.ts
│   │   │   └── chat.dto.ts
│   │   ├── llm.controller.ts      # API endpoints
│   │   ├── llm.service.ts         # Business logic
│   │   └── llm.module.ts          # Module definition
│   ├── app.module.ts              # Root module
│   └── main.ts                    # Application entry point
├── .env.example                   # Example environment variables
├── Dockerfile                     # Docker configuration
├── docker-compose.yml             # Docker Compose setup
└── package.json                   # Dependencies
```

## LLM Provider

The API talks to any OpenAI-compatible `/v1/chat/completions` endpoint. The default target is [OpenRouter](https://openrouter.ai), which proxies many models behind one API key. Set `LLM_BASE_URL` and `LLM_MODEL` to point at a different provider or model.

Suggested defaults for getting started:
- `openai/gpt-4o-mini` — cheap, fast, JSON-friendly (used by the dictionary lookup)
- `anthropic/claude-haiku-4.5` — comparable price/quality
- Any local OpenAI-compatible server (e.g., LM Studio, vLLM with `--api-key`)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

[lmduc2309](https://github.com/lmduc2309)
