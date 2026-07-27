# Verbal Mapping Game — Design

**Date:** 2026-05-25
**Status:** Approved, awaiting implementation plan
**Scope:** `english-learning-api` (new module) + `english-learning-games` (new game mode at `/modes/verbal-mapping`)

## 1. Goal & Scope

A new game mode where a logged-in user practices speaking English from Vietnamese prompts built around English words they're learning. One round = Vietnamese sentence is shown + spoken aloud; user speaks the English equivalent; an LLM grades the spoken answer; result + Next.

### In scope

- New route `/modes/verbal-mapping` in `english-learning-games`, plus a launch card on `/games`.
- Setup screen (word source + length + difficulty) → upfront LLM generation of all sentences → N play rounds → summary.
- Browser Web Speech API for STT and TTS; LLM grading via OpenRouter.
- Backend module `verbal-mapping` with three endpoints (start, attempt, finish) and TypeORM entities for sessions + attempts.
- Two new LLM methods on `LlmService` (`generateVietnameseSentences`, `gradeSpokenAnswer`).
- Per-word stats derived from the attempts table via SQL (no aggregate table).
- JWT-protected; logged-in only.

### Out of scope

- Spaced-repetition / "review struggling words" UI (the per-word stats *enable* it; no UI in this spec).
- Social features, leaderboards, multi-user sessions.
- Multi-language target (Vietnamese→English only this spec).
- Session pause/resume — refreshing mid-session abandons it.
- Mobile-native audio capture; browser STT only.

### Non-goals

- No fine-grained per-word diff in grading output (verdict + score + feedback + one suggested answer is enough).
- No backend retries layered on top of `LlmService` retries.
- No materialized aggregates yet; query the raw attempts table.

## 2. UX Flow

### Entry

A new card on `/games`, third position, titled "Verbal Mapping" with mic icon (`AudioOutlined`). Tap → `/modes/verbal-mapping`. Auth guard: if no `auth_token` in localStorage, redirect to `/auth?return=/modes/verbal-mapping`.

### Setup screen

Stacked sections:

1. **Word source** — segmented control:
   - *Saved list*: dropdown of the user's word lists (`GET /serious/word-list`).
   - *Type words*: textarea, comma/newline-separated, min 1, max 30 words.
2. **Session length** — 5 / 10 / 15 / 20 buttons, default 10.
3. **Difficulty** — Beginner / Intermediate / Advanced radio chips, default Intermediate.
4. **Start session** — primary CTA, disabled until: word source picked + ≥1 word resolved + length set.

### Loading state

Spinner + "Generating sentences..." for the upfront LLM call (~2–5s). On failure, show inline retry button + friendly error; don't kick the user back to setup.

### Play screen (one round at a time)

- **Header:** progress chip `Round 3 / 10` + running average score.
- **Prompt:** the Vietnamese sentence as text + 🔊 button to replay TTS. Auto-plays once on round load.
- **Mic button:** big circular control, states idle → recording (pulsing) → done. Live transcript appears below as the user speaks.
- **Transcript edit:** after STT stops, transcript is shown editable ("looks wrong? fix it") with a **Submit** button.
- **Result panel:** verdict badge (✅ / 🟡 / ❌), score 0–100, one-sentence feedback, and a suggested correct English sentence. **Next ▶** advances.
- **End session:** small link in header — counts as completed with whatever rounds were finished.

### Summary screen

- Final score (average), rounds played, time elapsed.
- Per-word breakdown: word | times shown | avg score | best/worst verdict.
- **Play again** (returns to setup, pre-filled) + **Back to /games**.

### Browser-unsupported fallback

If `window.SpeechRecognition ?? window.webkitSpeechRecognition` is undefined, mic button becomes a textarea "Type your English answer" (same Submit, same grading). A banner reads "Speech input isn't available in this browser — try Chrome or Edge for the full experience."

## 3. Frontend Architecture

### Route

`app/modes/verbal-mapping/page.tsx` — client component. Auth-guarded; redirects to `/auth?return=/modes/verbal-mapping` when no token.

### File layout

```
app/modes/verbal-mapping/
  page.tsx                     # Route entry. Owns top-level state machine.
  components/
    SetupPanel.tsx             # Word source + length + difficulty form.
    WordSourcePicker.tsx       # Tabbed saved-list / textarea control.
    PlayPanel.tsx              # Round screen: prompt + mic + transcript + submit.
    MicButton.tsx              # Encapsulates Web Speech API + recording UX.
    ResultPanel.tsx            # Verdict + score + feedback + Next.
    SummaryPanel.tsx           # End-of-session breakdown.
  hooks/
    useSpeechRecognition.ts    # Wraps SpeechRecognition.
    useSpeechSynthesis.ts      # Wraps SpeechSynthesis.
    useVerbalMappingSession.ts # Session state machine + API calls.

services/verbalMappingApi.ts   # New, alongside wordListApi.ts etc.
```

### State machine (`useReducer` in `useVerbalMappingSession`)

```
idle           → user filling setup
generating     → upfront LLM call in flight
playing(n)     → round n, sub-states: prompt | recording | submitted | graded
finished       → summary visible
error          → recoverable; shows retry
```

Transitions are explicit. Per-round attempt data accumulates in a session-local array (no refetch).

### Hook contracts

- **`useSpeechRecognition`** — `{ supported, status: 'idle'|'recording'|'done'|'error', transcript, error?, start(), stop(), reset() }`. Handles Chrome's `webkitSpeechRecognition` alias. Idempotent across rounds.
- **`useSpeechSynthesis`** — `{ supported, speak(text, lang='vi-VN'), cancel() }`. Prefers `vi-*` voices via `getVoices()`; falls back to default voice. Silent no-op when unsupported.
- **`useVerbalMappingSession`** — exposes the state machine + actions (`startSession(config)`, `submitAttempt(transcript)`, `nextRound()`, `endEarly()`). Components consume via React context; never call API or browser globals directly.

### State management decision

`useReducer` + a single route-scoped React context — no Zustand/Redux. The data is per-session, doesn't survive route change, and the state machine is small enough that a library would be over-engineering.

## 4. Backend Architecture

### Module shape

```
src/verbal-mapping/
  dto/
    start-session.dto.ts
    start-session.response.dto.ts
    submit-attempt.dto.ts
    submit-attempt.response.dto.ts
    finish-session.response.dto.ts
  entities/
    verbal-mapping-session.entity.ts
    verbal-mapping-attempt.entity.ts
  verbal-mapping.module.ts
  verbal-mapping.controller.ts
  verbal-mapping.service.ts
```

`VerbalMappingModule` imports `LlmModule`, `WordListModule`, and TypeORM `forFeature([VerbalMappingSession, VerbalMappingAttempt])`. Controller uses the existing `JwtAuthGuard`.

### Endpoints (all `/verbal-mapping`, JWT-protected)

| Method & path | Purpose | Request | Response |
|---|---|---|---|
| `POST /sessions` | Start a session. Validate words, generate all N Vietnamese sentences upfront, persist session row, return sentences. | `{ words: string[], wordListId?: string, numSentences: 5\|10\|15\|20, difficulty: 'beginner'\|'intermediate'\|'advanced' }` | `{ sessionId, sentences: [{ index, vi, words: string[] }] }` |
| `POST /sessions/:id/attempts` | Submit one round's transcript, grade it via LLM, persist (upsert by `sentence_index`). | `{ sentenceIndex: number, transcript: string }` | `{ verdict, score, feedback, suggestedAnswer }` |
| `POST /sessions/:id/finish` | Mark session complete; compute & return summary. | empty | `{ totalScore, rounds, perWord: [{ word, attempts, avgScore }] }` |
| `GET /sessions/:id/summary` | Re-fetch a past session's summary (used by Play again & future history). | — | same as `/finish` |

The user owns sessions (`userId` from JWT). Cross-user access returns 404 (not 403) — don't leak existence.

### LLM methods (added to `LlmService` — keeps it the only AI caller)

**`generateVietnameseSentences(words, numSentences, difficulty)`**
- `system`: "You are a Vietnamese teacher creating natural Vietnamese sentences for English learners."
- `user`: "Generate {N} Vietnamese sentences. Each must use the English meaning of at least one of: [words]. Match difficulty {difficulty}. Return JSON: `{ sentences: [{ vi: '...', words: ['...'] }] }`."
- `temperature: 0.7`, `max_tokens: 80 * numSentences`, `response_format: { type: 'json_object' }`.
- Parses JSON; throws on malformed; returns `Array<{ vi: string, words: string[] }>`.

**`gradeSpokenAnswer({ vietnamese, userTranscript, words })`**
- `system`: "You are an English teacher grading a learner's spoken English translation of a Vietnamese sentence. Be encouraging but honest."
- `user`: structured prompt with Vietnamese sentence, user transcript, target words.
- Returns JSON: `{ verdict: 'correct'|'partial'|'incorrect', score: 0..100, feedback: string, suggestedAnswer: string }`.
- `temperature: 0.2` (deterministic grading), `max_tokens: 300`, `response_format: { type: 'json_object' }`.

### Service flows

**`VerbalMappingService.startSession`:**
1. Validate auth.
2. Resolve words: prefer `wordListId` (load via `WordListService`), else use `words[]` (lowercase, deduped, trimmed, max 30).
3. Call `LlmService.generateVietnameseSentences(...)`. On parse/short-response error, throw `502 "Failed to generate sentences, please try again"`.
4. Persist session row with `sentences` JSONB; `finished_at` null.
5. Return session id + sentences.

**`VerbalMappingService.submitAttempt`:**
1. Load session, assert ownership (404 otherwise), assert not finished (409 otherwise).
2. Look up Vietnamese sentence by `sentence_index` from the session's `sentences` JSONB; 404 if out of range.
3. Call `LlmService.gradeSpokenAnswer(...)`. On parse failure, return safe-fallback grade (`verdict: 'partial'`, `score: 50`, `feedback: 'Could not grade that attempt; please try again.'`, `suggestedAnswer: vietnamese`) AND log at WARN. Persist the fallback like a normal attempt.
4. Upsert `attempt` row on `UNIQUE(session_id, sentence_index)`.
5. Return grade payload.

**`VerbalMappingService.finish`:**
1. Load session, assert ownership, assert not finished.
2. Compute `total_score` = average of attempt scores; set `finished_at = now()`.
3. Return summary (see §5 for per-word query).

## 5. Data Model

### `verbal_mapping_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → `users.id` ON DELETE CASCADE | indexed |
| `word_list_id` | uuid FK → `word_lists.id` ON DELETE SET NULL, nullable | nullable; survives word-list deletion |
| `source_words` | jsonb (string[]) | denormalized snapshot of the words used |
| `num_sentences` | int | 5 / 10 / 15 / 20 |
| `difficulty` | enum('beginner','intermediate','advanced') | |
| `sentences` | jsonb | `[{ index, vi, words: string[] }]` — immutable once generated |
| `started_at` | timestamptz, default now() | |
| `finished_at` | timestamptz, nullable | null ⇒ in-progress/abandoned |
| `total_score` | numeric(5,2), nullable | computed on finish |

Indexes: `(user_id, started_at DESC)`.

**Why JSONB for `sentences`** instead of a separate `verbal_mapping_sentences` table: sentences are immutable, always loaded with the session, never queried individually. Single-row read avoids a join.

### `verbal_mapping_attempts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK → `verbal_mapping_sessions.id` ON DELETE CASCADE | indexed |
| `user_id` | uuid FK → `users.id` ON DELETE CASCADE | denormalized for fast per-user stats |
| `sentence_index` | int | 0-based round number |
| `vi_sentence` | text | denormalized snapshot of the prompt graded |
| `target_words` | jsonb (string[]) | words targeted by this sentence; used for per-word stats |
| `transcript` | text | what the user said (final, post-edit) |
| `verdict` | enum('correct','partial','incorrect') | |
| `score` | int | 0–100 |
| `feedback` | text | LLM's 1-sentence feedback |
| `suggested_answer` | text | LLM's example English sentence |
| `created_at` | timestamptz, default now() | |

Constraints: `UNIQUE(session_id, sentence_index)` for upsert. Indexes: `(user_id, created_at DESC)`; GIN index on `target_words` if/when per-word filtering becomes a perf issue.

### Per-word stats query

```sql
SELECT user_id,
       jsonb_array_elements_text(target_words) AS word,
       COUNT(*)                                AS attempts,
       AVG(score)                              AS avg_score,
       SUM(CASE WHEN verdict='correct' THEN 1 ELSE 0 END) AS corrects
FROM verbal_mapping_attempts
WHERE user_id = $1
GROUP BY user_id, word;
```

No aggregate table — avoids dual-write bugs. Materialize later if perf forces it.

### Migration strategy

TypeORM `synchronize: true` is on in dev — entity additions auto-create tables. For prod-style migration, generate a migration file under `database/migrations/` when needed; outside scope of this spec.

## 6. Browser Compatibility & Error Handling

### Browser compatibility

- **`SpeechRecognition`** — Chrome/Edge/Opera (full), Safari 14.1+ (partial, less reliable on iOS), Firefox (none). On mount, `useSpeechRecognition` probes `window.SpeechRecognition ?? window.webkitSpeechRecognition`.
- **Unsupported fallback** — mic button replaced by textarea "Type your English answer"; same Submit + grading. Top banner explains.
- **`SpeechSynthesis`** — wide support, but Vietnamese voice availability varies. Prefer `vi-*` voices; fall back to default voice. No error UI for missing voice.
- **Mic permission denial** — `useSpeechRecognition` returns `status: 'error', error: 'permission-denied'`. UI shows a small dialog: "Re-enable mic access in your browser's site settings, then refresh." Typed fallback remains usable.

### Frontend error handling

- Sentence generation fails → stay on setup screen; toast + "Try again" button.
- Submit attempt fails → stay on round; show "Couldn't grade that attempt — try Submit again." Don't auto-advance.
- Auth token expired mid-session → API service catches 401 globally (existing pattern) and redirects to `/auth?return=...`.
- Mic device disappears mid-session → swap in typed fallback for that round onward.

### Backend error handling

- `generateVietnameseSentences` parse failure → `502 "Failed to generate sentences, please try again"`.
- `gradeSpokenAnswer` parse failure → safe-fallback grade (above), logged WARN. Session stays playable.
- Cross-user session id access → `404` (not 403; don't leak existence).
- Submit after `finished_at` set → `409 "Session already finished."`
- Existing `LlmService.chat()` error mapping (503/429/500) applies unchanged.

## 7. Testing

### Backend unit tests (Jest)

- `VerbalMappingService.startSession`: resolves word list via mocked `WordListService`, calls mocked `LlmService.generateVietnameseSentences`, persists session, returns sentences.
- `startSession` with empty `words[]` and no `wordListId` → 400.
- `submitAttempt`: 404 when session belongs to another user.
- `submitAttempt`: 409 when session is finished.
- `submitAttempt`: upserts on conflict — second submission for same `(session, index)` updates, doesn't duplicate.
- `submitAttempt`: when `LlmService.gradeSpokenAnswer` throws, returns the safe fallback grade and persists it.
- `finish`: computes `total_score` as average; sets `finished_at`.

### `LlmService` prompt tests (mocks `openai.chat.completions.create`)

- `generateVietnameseSentences`: builds system + user messages, sets `response_format: json_object`, parses N sentences out, throws on malformed JSON.
- `gradeSpokenAnswer`: same shape; returns verdict/score/feedback/suggestedAnswer from mocked LLM JSON.

### Frontend unit tests

The Next.js app has no test infra today; we add Jest (the same pattern as the backend) for these focused tests only:

- `useSpeechRecognition`: probes window globals; returns `supported: false` cleanly when both undefined.
- `useVerbalMappingSession`: state machine transitions (`idle → generating → playing(0) → ... → finished`) with a mocked API service.

Component snapshot/render tests are skipped (low value; covered by manual verification).

### Manual verification checklist

- Logged-in user can start a session with a saved word list AND a typed list.
- Mic flow works end-to-end in Chrome.
- Typed-fallback flow works in Firefox.
- Vietnamese TTS plays on round load; replay button replays.
- Re-submitting the same round updates the verdict; doesn't create a duplicate.
- Refreshing the page mid-session abandons it (no resume); summary endpoint still returns the partial result.
- `/games` shows the new card and routes correctly.
- Permission denied on first mic prompt → typed-fallback path is reachable.
