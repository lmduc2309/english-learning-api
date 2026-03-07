# English Learning API

A NestJS-based REST API for an English learning application, powered by local LLM using vLLM.

## Features

- 🤖 **LLM Integration**: Connect to local vLLM server for AI-powered sentence generation
- 📝 **Generate Sentences**: Create example sentences using specific vocabulary words
- 💬 **Chat Assistant**: English teacher assistant for grammar and vocabulary questions
- 🎯 **Difficulty Levels**: Support for beginner, intermediate, and advanced levels
- 📚 **Swagger Documentation**: Interactive API documentation
- ✅ **Validation**: Request validation using class-validator
- 🔒 **Type Safety**: Full TypeScript support

## Prerequisites

- Node.js 18+ 
- npm or yarn
- vLLM server running (see setup below)

## vLLM Server Setup

First, start your vLLM server:

```bash
python -m vllm.entrypoints.openai.api_server \
    --model microsoft/Phi-3-mini-4k-instruct \
    --dtype float16 \
    --max-model-len 512 \
    --gpu-memory-utilization 0.6 \
    --host 0.0.0.0 \
    --port 8000 \
    --trust-remote-code
```

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

Update `.env` file with your settings:

```env
VLLM_URL=http://localhost:8000/v1/completions
VLLM_MODEL=microsoft/Phi-3-mini-4k-instruct
PORT=3000
NODE_ENV=development
```

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

## Hardware Requirements

For running the vLLM server:
- **GPU**: 6GB+ VRAM (GTX 1060, RTX 3060, or better)
- **RAM**: 16GB+ recommended
- **Storage**: 10GB+ for model files
- **OS**: Ubuntu 20.04+ or similar Linux distribution

## Recommended Models

- **Phi-3-mini-4k-instruct** (3.8B) - Best for 6GB VRAM
- **Qwen2.5-3B-Instruct** (3B) - Fast and multilingual
- **Llama-3.2-3B-Instruct** (3B) - Good English capabilities

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

[lmduc2309](https://github.com/lmduc2309)
