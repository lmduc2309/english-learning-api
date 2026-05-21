# OpenRouter LLM Swap — Design

**Date:** 2026-05-21
**Status:** Approved, awaiting implementation plan
**Scope:** `english-learning-api` backend only

## 1. Goal & Scope

Swap the backend's AI provider from a local **vLLM + Phi-3** server to **OpenRouter** (OpenAI-compatible chat-completions). Along the way, consolidate AI calls into a single `LlmService` so the rest of the app never talks to the provider directly.

### In scope

- Rewrite `LlmService` to use the official `openai` Node SDK pointed at OpenRouter's base URL.
- Refactor `DictionaryService.lookupWord` (LLM dictionary entry fallback) and `DictionaryService.translate` to call `LlmService` instead of speaking HTTP themselves.
- Convert Phi-3 chat-template prompts (`<|system|>...<|end|>`) to OpenAI `messages: [{role, content}]` arrays.
- Rename env vars to provider-neutral names (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`).
- Preserve the MyMemory fallback in `DictionaryService.translate`.

### Out of scope (deferred to the speaking-game spec)

- New game endpoints, sentence/grading prompts, DB tables, per-word stats, frontend work.

### Non-goals

- No per-task model overrides yet (YAGNI — add `LLM_MODEL_DICTIONARY` etc. only if cost/quality forces it).
- No streaming responses.
- No retry layer in app code — rely on the SDK's default retries.

## 2. Architecture

### Today

Two services call vLLM directly: `LlmService` (in `src/llm/llm.service.ts`) and `DictionaryService` (in `src/dictionary/dictionary.service.ts`). Both define their own `VLLMCompletionRequest` interface, both hand-assemble Phi-3 prompt strings, both call `HttpService.post(this.vllmUrl, ...)`. The provider model leaks into both files.

### After

`LlmService` is the only thing in the codebase that imports the OpenAI SDK or knows the provider URL. It exposes a small, typed surface:

- **`chat(messages, opts?)`** — low-level private method: takes `OpenAI.ChatCompletionMessageParam[]`, returns the trimmed assistant content. Used internally by the higher-level methods in this service. (Future callers outside the service — e.g., the speaking game — can promote it to public when that spec lands.)
- **`generateSentences(dto)`** — unchanged DTO; builds `messages` instead of a Phi-3 prompt, calls `chat()`, parses sentences.
- **`chatWithUser(dto)`** — current `chat()` controller method, renamed internally so the public method name doesn't collide with the low-level `chat()`. External `POST /llm/chat` route stays the same.
- **`lookupDictionaryWord(word)`** — moved from `DictionaryService`. Builds the dictionary JSON prompt as a `messages` array, calls `chat()`, returns parsed `LookupWordResponseDto`.
- **`translate(dto)`** — moved from `DictionaryService`. Calls `chat()`. On failure, throws so `DictionaryService` can fall back to MyMemory (the fallback isn't an LLM concern; it stays in `DictionaryService`).
- **`healthCheck()`** — reports configured base URL + model.

`DictionaryService` keeps its public API but its body becomes thin: validate input → call `LlmService.lookupDictionaryWord` / `LlmService.translate` → handle the MyMemory fallback in `translate()` only.

`DictionaryModule` imports `LlmModule` to inject `LlmService`. `LlmModule` already exports `LlmService`, so this is a one-line change.

`LlmModule` drops its `HttpModule` import — the `openai` SDK handles transport. `DictionaryModule` keeps `HttpModule` for the MyMemory fallback only.

## 3. Config & env vars

### `src/config/configuration.ts`

Replace the existing `llm` block with:

```ts
llm: {
  apiKey: process.env.LLM_API_KEY,                                     // required
  baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1', // OpenRouter default
  model: process.env.LLM_MODEL    || 'openai/gpt-4o-mini',             // sensible default; override per-deploy
  enableFallback: process.env.LLM_FALLBACK_ENABLED !== 'false',        // unchanged (dictionary LLM fallback flag)
  appTitle: process.env.LLM_APP_TITLE || 'english-learning-api',       // OpenRouter X-Title header (analytics)
  httpReferer: process.env.LLM_HTTP_REFERER,                           // OpenRouter HTTP-Referer header (optional)
},
```

### `.env.example`

Replace the `# vLLM Configuration` block with an `# LLM Configuration` block containing the new vars and a comment noting any OpenAI-compatible provider works (default = OpenRouter).

### Startup check

`LlmService` constructor throws synchronously if `LLM_API_KEY` is missing — Nest fails to boot with a clear message rather than failing on the first request.

### Default model

`openai/gpt-4o-mini` — cheap, reliable, JSON-friendly (needed by `lookupDictionaryWord`). Override via `LLM_MODEL`. Revisit once real cost is known.

## 4. Prompt conversion (Phi-3 → OpenAI messages)

Mechanical translation: every `<|system|>…<|end|>` block becomes a `system` message; every `<|user|>…<|end|>` block becomes a `user` message; the trailing `<|assistant|>` marker is dropped (the SDK adds it). The vLLM `stop: ['<|end|>', '<|user|>']` array is dropped — those tokens no longer appear in the conversation.

### Four prompts to migrate (wording kept ~verbatim — same instructions, new envelope)

1. **`generateSentences`**
   - `system`: "You are an English teacher helping students learn new vocabulary."
   - `user`: the existing difficulty-gated request + format hint.
   - `temperature` from DTO; `max_tokens: 500`.

2. **`chatWithUser`**
   - `system`: "You are a helpful English teacher assistant. Answer questions about English grammar, vocabulary, and usage."
   - `user`: `dto.message`.
   - `temperature` and `max_tokens` from DTO.

3. **`lookupDictionaryWord`**
   - `system`: "You are an English-Vietnamese dictionary. Provide comprehensive dictionary information in JSON format."
   - `user`: the existing JSON-shape instruction with `${word}` interpolated.
   - `temperature: 0.3`, `max_tokens: 1500`.
   - Pass `response_format: { type: 'json_object' }` so compatible models return strict JSON. The existing `jsonMatch = text.match(/\{[\s\S]*\}/)` parser stays as a safety net.

4. **`translate`**
   - `system`: "You are a professional translator. Translate accurately and naturally."
   - `user`: "Translate the following text from {src} to {tgt}. Output ONLY the translation, nothing else. Text: {text}"
   - `temperature: 0.3`, `max_tokens: 500`, **timeout 5s** (preserved — enables fast MyMemory fallback).

### Helper

A private `LlmService.chat(messages, opts)` wraps `openai.chat.completions.create({ model, messages, temperature, max_tokens, response_format?, ... })` and returns `response.choices[0].message.content?.trim() ?? ''`. The four public methods all go through it.

### Behavior preserved

Same parsed shapes returned to controllers (sentences array, response string, dictionary JSON, translation object). No API consumers change.

## 5. Error handling & fallback

### `LlmService.chat()` — central error mapping

Wrap the SDK call in try/catch:

- Log error with context (model, message count, first 200 chars of last user message). **Never log the API key.**
- Map `openai` SDK errors to NestJS `HttpException`:
  - `APIConnectionTimeoutError` / `APIConnectionError` → `503 Service Unavailable`, `"LLM provider unreachable"`.
  - `RateLimitError` (429) → `429 Too Many Requests`, `"LLM rate limit exceeded"`.
  - `AuthenticationError` (401) → `500 Internal Server Error`, `"LLM provider misconfigured"` (do not leak that the key is bad to clients; log details server-side).
  - Other → `500 Internal Server Error`, `"LLM request failed"`.
- Re-throw so callers above can choose to fall back or surface.

### Per-method behavior

- **`generateSentences` / `chatWithUser`** — let exceptions bubble. Existing controller behavior preserved.
- **`lookupDictionaryWord`** — if JSON parsing fails after a successful call, throw `500 "Failed to parse dictionary data"` (existing behavior). LLM-level errors bubble; `DictionaryService` lets them bubble too (today's behavior).
- **`translate`** — `LlmService.translate()` throws on any failure (5s timeout, network, auth, parse). `DictionaryService.translate()` catches **any** thrown error from `LlmService.translate()` and falls back to MyMemory (same as today's `catch (vllmError)` block, one layer up). `LLM_FALLBACK_ENABLED` is unchanged and still gates the dictionary-lookup LLM path in `DictionaryService.lookupWord`.

### Startup failure

Missing `LLM_API_KEY` throws synchronously in the `LlmService` constructor — Nest fails to boot with a clear message.

### No retries in app code

The `openai` SDK retries on 5xx/timeout (default 2 retries). We don't stack a second retry layer.

## 6. Testing

### Unit tests — `llm.service.spec.ts` (new)

Mock the `openai` SDK by injecting a fake `OpenAI` client via a provider override. Cover:
- `chat()` returns trimmed assistant content on success.
- `chat()` maps `APIConnectionTimeoutError` → 503, `RateLimitError` → 429, `AuthenticationError` → 500 with sanitized message.
- `generateSentences()` builds the right `messages` array (system + user), parses N sentences from a newline-delimited fake response, filters short lines.
- `lookupDictionaryWord()` passes `response_format: { type: 'json_object' }`, parses returned JSON, throws 500 on unparseable text.
- `translate()` propagates the SDK error (so `DictionaryService` can fall back).
- Constructor throws when `LLM_API_KEY` is unset.

### Unit tests — `dictionary.service.spec.ts` (update or add)

Mock `LlmService`:
- `translate()` returns LLM result on success.
- `translate()` falls back to MyMemory when `LlmService.translate` throws — assert the MyMemory URL is hit and its result is returned.
- `lookupWord()` LLM path delegates to `LlmService.lookupDictionaryWord` and returns its result; gating by `LLM_FALLBACK_ENABLED` unchanged.

### Smoke test — opt-in, not in CI

A single `llm.smoke.spec.ts` that hits real OpenRouter using `LLM_API_KEY` from env; guarded by `describe.skipIf(!process.env.LLM_SMOKE)`. Runs locally with `LLM_SMOKE=1 npm test`. Verifies one end-to-end `chat()` call returns non-empty text.

### No integration tests against MyMemory

External, flaky, not worth gating CI.

### Manual verification checklist

- `GET /llm/health` returns `{ status: 'healthy', model, url: base URL }`.
- `POST /llm/generate-sentences` with 3 words returns 3 plausible sentences.
- `POST /llm/chat` returns a coherent reply.
- `GET /dictionary/lookup/:word` for a word not in DB returns a populated entry (when `LLM_FALLBACK_ENABLED=true`).
- `POST /dictionary/translate` works; intentionally break the key → confirm MyMemory fallback engages.

## 7. Migration & rollout

### Cleanup in the same PR

Nothing in production depends on the old vLLM env vars (single-developer setup) — we delete them outright rather than carry shims.

### File-by-file changes

- **`package.json`** — add `openai` (latest 4.x). No `@nestjs/axios` change yet (still needed by `DictionaryService` for MyMemory).
- **`src/config/configuration.ts`** — replace the `llm` block with the new shape from §3.
- **`.env.example`** — replace the `# vLLM Configuration` block with the `# LLM Configuration` block; add a one-line comment showing how to point at any OpenAI-compatible provider.
- **`.env`** — user's responsibility to update locally (we don't touch it). Implementation steps will call this out.
- **`src/llm/llm.module.ts`** — drop `HttpModule` import; `LlmService` provider stays.
- **`src/llm/llm.service.ts`** — rewritten per §§2–5.
- **`src/llm/llm.controller.ts`** — no signature changes; route handlers stay 1-to-1.
- **`src/dictionary/dictionary.module.ts`** — add `LlmModule` to `imports`.
- **`src/dictionary/dictionary.service.ts`** — delete the `VLLMCompletionRequest`/`Response` interfaces, the `vllmUrl`/`vllmModel` fields, and the inline HTTP calls in `lookupWord` and `translate`; replace with `LlmService.lookupDictionaryWord(...)` and `LlmService.translate(...)`; keep the MyMemory fallback block in `translate()` (now catching from `LlmService.translate`).

### Docs touch-ups

- `README.md` (api) — update any "vLLM" references to "OpenRouter / any OpenAI-compatible provider".
- `DICTIONARY_SETUP.md` / `IMPLEMENTATION_GUIDE.md` — if they reference `VLLM_URL` / `VLLM_MODEL`, update.

### Rollout order (single deploy, no flag)

1. Get `LLM_API_KEY` from OpenRouter; pick model.
2. Land the PR.
3. Update local/staging `.env` to set `LLM_API_KEY` (and `LLM_MODEL` if not using default). Boot — service throws fast if key missing.
4. Smoke-check the five manual endpoints in §6.
5. Update prod `.env` and deploy.

### No data migration

No DB changes in this spec.
