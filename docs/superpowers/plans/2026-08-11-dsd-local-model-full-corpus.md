# DSD Local-Model Full-Corpus Implementation Plan

> **Status:** Implementation active; headword-only commercial lookup pivot approved 2026-08-11.
>
> **Supersedes:** The OpenAI-specific provider and generation sections of
> `2026-08-09-dsd-full-corpus-ai-automation.md`. The target, clean-room,
> review, similarity, IPA/audio, backup, release, and exact-parity gates remain
> unchanged.
>
> **Target:** Exactly 475,153 normalized English lookup entries. The legacy
> database contributes headword strings only. All POS, definitions,
> translations, examples, IPA, audio, ranks, identifiers, order and metadata
> are discarded and recreated under the DSD workflow.
>
> **Execution host:** Apple M5, 24 GB unified memory. Production remains the
> authoritative PostgreSQL ledger; model inference runs locally and transfers
> only checksum-bound DSD packages.

## 1. Approved model architecture

| Stage | Official model | License | Approved role |
| --- | --- | --- | --- |
| Generator | `Qwen/Qwen3-14B` | Apache-2.0 | Candidate inventory, POS, usage labels, English definition and English example |
| Independent critic | `Qwen/Qwen3-8B` | Apache-2.0 | Lexical validity and English quality criticism only |
| Translator | `google/translategemma-12b-it` | Gemma Terms | `definition_en -> translation_vi` and `example_en -> example_vi` only |

Initial upstream revisions to pin during provisioning:

- Qwen3-14B: `40c069824f4251a91eefaf281ebe4c544efd3e18`
- Qwen3-8B: `b968826d9c46dd6066d109eabc6255188de91218`
- TranslateGemma-12B-IT: `d1b225e1caa17f1ddc7e62065d8637d0923f34e2`

These revisions are inputs to the reproducibility record, not permission to
silently download newer files. Any revision change requires a new calibration,
tool-registry revision, and owner approval.

### Fixed decisions

1. All three models run locally. No OpenAI or OpenRouter key, endpoint, SDK, or
   provider fallback is permitted on this path.
2. Official upstream weights are downloaded and locally quantized to 4-bit
   MLX artifacts. Community quantized repositories are not accepted as the
   production source.
3. Qwen3-14B runs with thinking disabled for deterministic structured
   generation. Hidden reasoning is neither requested nor stored.
4. Qwen3-8B is context-isolated. It receives the final candidate or final
   English fields plus the critic rubric, never generator reasoning, prior
   attempts, legacy data, or similarity matches.
5. TranslateGemma receives one English field at a time with explicit `en -> vi`
   language codes. It never generates English source content or inventory.
6. Model output is always untrusted. JSON extraction, schema validation,
   normalization, deterministic QA, critic approval, translation QA, and
   database constraints remain fail-closed.
7. AI actor `DSD-G-001` authors drafts. No model may approve, publish, sign a
   release, or populate a human reviewer field.
8. TranslateGemma's custom Gemma Terms are an explicitly accepted third-party
   model dependency. A timestamped terms snapshot and acceptance evidence are
   required before its first production translation. If the product requires
   a model stack containing only MIT/Apache-2.0 dependencies, translation must
   stop until an approved replacement is selected.
9. The free dictionary may reuse legacy-origin headword strings. This is not
   described as an independently selected or fully clean-room inventory. DSD
   claims rights only in newly generated expressive content, new software and
   any independently created arrangement—not exclusive rights in words.
10. A least-privilege `dsd_headword_reader` role exposes exactly one `headword`
    column. Generation never receives legacy POS, definitions, translations,
    examples, ranks, IDs, ordering, IPA, audio or source metadata.

## 2. Pipeline

```text
legacy `headword` strings only
        |
        v
normalize / deduplicate / fresh DSD UUID and ordering
        |
        v
Qwen3-14B inferred POS + new definition_en + new example_en
        |
        v
deterministic English QA -> Qwen3-8B isolated English critic
        |
        v
TranslateGemma definition_en -> translation_vi
TranslateGemma example_en    -> example_vi
        |
        v
Vietnamese deterministic QA -> repair or quarantine
        |
        v
checksum-bound curation package -> production draft import
        |
        v
restricted legacy similarity screen -> human hash review
        |
        v
IPA + LJSpeech/Norman audio -> signed release gates
```

The inference process reads only the sanitized inventory CSV. It must not
contain a legacy database URL, legacy dump, legacy mount, similarity reader
credential, legacy IDs or legacy expressive content. Tests prove this narrower
boundary before every production wave.

---

# Phase L0 — Legal evidence and reproducible model provisioning

## Task L1: Register the approved local models

**Files:**

- Modify `data/dsd/tool-registry.json`
- Create `data/dsd/models/local-model-lock.json`
- Create `data/dsd/schemas/local-model-lock.schema.json`
- Create `docs/dsd-corpus/evidence/LOCAL-MODEL-TERMS-2026-08-11.md`
- Create tests under `scripts/dsd/ai/local/`

The lock records, for every model: official repository, upstream commit,
license identifier, license URL, terms-evidence ID, expected architecture,
parameter count, source-file hashes, quantizer and version, quantization
settings, output artifact hashes, creation host, and creation timestamp. It
must contain no access token or local username.

**Acceptance:**

- Qwen entries resolve to Apache-2.0 license evidence.
- TranslateGemma cannot become `approved` until Gemma Terms have been accepted
  by the owner and a timestamped evidence snapshot is recorded.
- Registry validation fails on mutable `main` references, missing hashes,
  community quant repositories, or an unapproved model revision.
- Existing OpenAI tool entry becomes historical/inactive; provenance for the
  existing 50 records is not rewritten.

## Task L2: Add an idempotent MLX provisioning command

**Files:**

- Create `scripts/dsd/ai/local/provision-models.py`
- Create `scripts/dsd/ai/local/verify-models.py`
- Create `requirements-dsd-local-models.lock`
- Modify `.gitignore` and `package.json`

**Commands:**

```text
dsd:local:models:provision --model <model-id>
dsd:local:models:verify
```

Provisioning downloads official weights at the locked revision into an
external cache, verifies upstream hashes, converts to MLX 4-bit, writes an
immutable manifest, and verifies a minimal inference. Model weights and Hugging
Face tokens must never enter Git, Docker build context, logs, backups, or DSD
packages.

**Acceptance:**

- Re-running a verified conversion is a no-op.
- A partial download/conversion cannot be promoted to the active model path.
- Peak memory stays below a benchmarked safe ceiling on the 24 GB host.
- The verifier detects any changed shard, tokenizer, template, config, MLX
  artifact, or quantization parameter.

---

# Phase L1 — Provider-neutral local inference adapter

## Task L3: Define the local inference protocol

**Files:**

- Create `scripts/dsd/ai/local/protocol.ts` and tests
- Create schemas:
  - `local-candidate-output.schema.json`
  - `local-english-entry-output.schema.json`
  - `local-critic-output.schema.json`
  - `local-translation-output.schema.json`

Use a JSONL request/result spool with stable request IDs, model-lock hash,
prompt hash, schema hash, input hash, seed, sampling parameters, timestamps,
output hash, token counts, elapsed time, and terminal state. Input content is
stored separately from operational metadata so logs can remain content-free.

**Acceptance:**

- Strict schemas reject unknown properties and malformed enums.
- Request identity is deterministic and idempotent.
- Results cannot claim a different model, prompt, schema, or input hash.
- No schema includes legacy identity, wording, rank, source membership, model
  reasoning, review, approval, publication, or similarity fields.

## Task L4: Implement the MLX worker

**Files:**

- Create `scripts/dsd/ai/local/worker.py` and tests
- Create `scripts/dsd/ai/local/runner.ts` and tests
- Modify `package.json`

**Commands:**

```text
dsd:local:run --stage inventory --input <jsonl> --output <jsonl>
dsd:local:run --stage english   --input <jsonl> --output <jsonl>
dsd:local:run --stage critic    --input <jsonl> --output <jsonl>
dsd:local:run --stage translate --input <jsonl> --output <jsonl>
```

The runner uses one active model at a time, bounded batches, atomic checkpoint
files, interrupt-safe shutdown, explicit thermal/disk/memory guards, and a
kill-switch file. It validates JSON after generation and never invents a
successful result when parsing fails.

**Acceptance:**

- Resume never repeats a completed request.
- SIGINT leaves a valid checkpoint and no promoted partial result.
- Retry is limited to parsing/transient runtime failures; semantic failures go
  to repair or quarantine.
- The laptop sleeping, losing power, or running out of disk leaves the wave
  resumable without duplicate database rows.

## Task L5: Add prompt and sampling policy

**Files:**

- Create versioned prompts under `data/dsd/prompts/local-v1/`
- Create `data/dsd/ai/local-sampling-policy.json`
- Add prompt-policy validation tests

Initial policy to calibrate, not silently assume:

- inventory: bounded diversity sampling with deterministic per-cell seeds;
- English authoring: low temperature, thinking disabled, one sense only;
- critic: deterministic pass/fail/reason codes;
- translation: TranslateGemma official chat template, one field/request,
  deterministic decoding.

Prompts explicitly forbid reproducing dictionaries/corpora, emitting sources,
inventing reviews, and returning text outside the requested JSON or translation.

---

# Phase L2 — Independent inventory

## Task L6: Connect Qwen3-14B to the existing coverage planner

**Files:**

- Modify `scripts/dsd/ai/inventory-planner.ts`
- Create `scripts/dsd/ai/local/inventory.ts` and tests
- Modify the generation-run/job ledger only if provider-neutral fields are
  missing; use a new migration rather than editing an applied migration.

Generate at least 550,000 raw candidates across the existing 5,500 coverage
cells. Each cell is independently resumable and supplies level, POS, topic,
register, form/domain rules, and requested count—never a legacy word.

**Acceptance:**

- Every candidate traces to one cell, request, prompt, model-lock and output
  hash.
- Normalization and UUID assignment remain deterministic.
- No duplicate normalized active headword can be created.
- The worker has no legacy credential or readable legacy path.

## Task L7: Add deterministic and isolated candidate criticism

Run cheap deterministic gates before Qwen3-8B: allowed script, token/length,
normalization, duplicates, malformed inflections, abbreviations/proper names,
unsafe terms, and required POS compatibility. The critic receives only
surviving candidate fields and returns stable reason codes.

Freeze cumulative inventory milestones at 500, 5,000, 20,000, 100,000,
250,000, and 475,153, retaining enough reserve to replace later quarantines.

**Acceptance:**

- Exactly 475,153 final active normalized headwords; reserve is excluded.
- Zero empty, duplicate, untraceable, or legacy-derived entries.
- Candidate rejection and reserve rates reconcile to the run ledger.
- Owner sample approval is recorded at every milestone; it does not constitute
  content publication approval.

---

# Phase L3 — English authoring and independent critic

## Task L8: Generate English entry packages with Qwen3-14B

For each frozen inventory row, generate exactly one initial learner sense with
headword echo, POS, concise original English definition, one aligned English
example, and bounded usage labels. Validate headword/POS echo and strict JSON
before any later stage.

**Acceptance:**

- English fields pass the existing length, script, circularity, example-use,
  and content rules.
- Every accepted field has exact input/output/model/prompt/schema hashes.
- Re-running an accepted job is a no-op.
- The generator cannot write directly to production or set human state.

## Task L9: Critic and repair with Qwen3-8B

The critic checks lexical correctness, POS, circularity, learner clarity,
example grammar, sense/example agreement, fabrication, and harmful content. It
sees final English fields only. Failed jobs receive at most the configured
number of blank-context Qwen3-14B repair attempts; the generator receives
reason codes, never critic prose, legacy wording, or similarity matches.

**Acceptance:**

- Critic model/process is distinct and model-lock evidence proves it.
- Every repair creates a new immutable revision and invalidates downstream
  translation/review/similarity evidence.
- Attempt exhaustion produces quarantine, not relaxed validation.

---

# Phase L4 — Vietnamese translation

## Task L10: Translate accepted English fields with TranslateGemma

Translate `definition_en` and `example_en` as separate `en -> vi` requests
using the official TranslateGemma template. Join results only by the stable DSD
entry/revision/request identity. The translation worker does not see legacy
Vietnamese, dictionaries, previous translations, or similarity results.

**Acceptance:**

- Output contains only the Vietnamese translation for the requested English
  field; extra commentary is rejected.
- CJK, missing Vietnamese, untranslated equality, length, control-character,
  and language-shape checks run before package assembly.
- A changed English content hash makes both translations stale.
- Terms evidence and model-lock hash accompany every translated revision.

## Task L11: Vietnamese critic/repair policy

Use deterministic checks first. Initial human sampling at 50 and 500 determines
whether TranslateGemma alone meets the Vietnamese threshold. If an AI semantic
critic is added, it must be a separately approved model/configuration and may
not be the same TranslateGemma request that created the translation.

Translation repair receives only the current English source and a stable
failure reason. It never receives legacy Vietnamese or rejected source text.

---

# Phase L5 — Calibration and production integration

## Task L12: Run the mandatory 50-entry local calibration

Benchmark the complete four-stage path on a clean-room 50-entry package. Record:

- wall time and entries/hour per stage;
- prompt and output tokens, parse/retry/quarantine rates;
- peak unified memory, disk, temperature/throttling observations and energy;
- candidate validity, English correctness, critic rejection/repair;
- Vietnamese fidelity/naturalness and example alignment;
- duplicate/style-template rates and deterministic rerun behavior.

The owner reviews the exact hash-bound 50 outputs. The evidence document
projects runtime, storage, operator attention, and expected reserve for 500,
5,000 and 475,153. No full-run date or throughput promise is accepted before
this measurement.

**Go gate:** zero critical provenance/schema/isolation defects, acceptable
owner sample, and explicit approval of model locks, prompts, sampling settings,
quality thresholds, and projected runtime.

## Task L13: Convert local results to existing curation packages

**Files:**

- Create `scripts/dsd/ai/local/assemble.ts` and tests
- Create `scripts/dsd/ai/local/progress.ts` and tests
- Extend the production ledger with append-only local request/result evidence
  if Task L6 did not already do so.

Assembly is offline and fail-closed. It produces the existing validated DSD
curation format with local model provenance and `draft` status. Production
import remains transactional and idempotent.

**Acceptance:**

- Submitted, completed, rejected, repaired, quarantined and imported totals
  reconcile exactly.
- Package hashes bind every child field to its English revision and translation
  requests.
- No OpenAI-specific provider assertion remains in the provider-neutral path.
- The existing OpenAI implementation remains historical and disabled, not
  silently repurposed.

## Task L14: Extend the production orchestrator

**Commands:**

```text
dsd:full-run prepare  --wave <wave-id>
dsd:full-run infer    --wave <wave-id> --stage <stage>
dsd:full-run validate --wave <wave-id>
dsd:full-run package  --wave <wave-id>
dsd:full-run stage    --wave <wave-id>
dsd:full-run status
dsd:full-run pause
```

Before each production import require: verified fresh on-host dump, verified
off-host copy, restore proof within policy age, exact dry-run manifest, disk
headroom, count guard, wave authorization, transactional import, quality audit,
and verified post-wave dump. Local inference itself may continue while the
production import gate is closed, but produced packages remain offline drafts.

There is no `approve-all`, `publish-all`, destructive reset, legacy import, or
provider fallback command.

---

# Phase L6 — Milestone execution and final parity

## Task L15: Execute resumable waves

| Wave | Cumulative active entries | Mandatory evidence before next wave |
| --- | ---: | --- |
| W0 | 50 | Local end-to-end calibration and owner sample |
| W1 | 500 | Quality, memory, throughput and repair rates |
| W2 | 5,000 | Restore, storage, review, IPA/audio scale proof |
| W3 | 20,000 | Long-run stability and Vietnamese audit |
| W4 | 100,000 | Long-tail quality and reserve projection |
| W5 | 250,000 | Recovery rehearsal and final capacity proof |
| W6 | 475,153 | Exact parity and complete reconciliation |

Each wave is additive and signed. Rejections activate independent reserve
candidates through the entire pipeline. Do not skip milestone gates even when
local inference has already prepared later offline packages.

## Task L16: Complete commercial release gates

After text staging, run the unchanged restricted similarity screening, owner
hash review, IPA generation/review, LJSpeech and Norman audio generation/QA,
signed release, backup and scratch-restore gates. Final release must prove:

- exactly 475,153 active unique normalized English entries;
- exactly 475,153 complete English/Vietnamese text packages;
- exactly 475,153 approved en-US IPA records;
- exactly 475,153 approved LJSpeech and 475,153 approved Norman audio assets;
- zero unresolved duplicate, quarantine, similarity, stale-review, provenance,
  rights, backup, restore, or release findings;
- no model actor in a human reviewer field and no automatic publication;
- the commercial API serves only the selected signed DSD release and cannot
  fall back to legacy content.

## 3. Stop conditions

Pause immediately when any of the following occurs:

- active model/tokenizer/template/artifact hash differs from the lock;
- a generation process can read a legacy credential/path/content field;
- memory, disk, temperature, error, retry, invalid, duplicate, quarantine,
  critic-rejection or Vietnamese-quality threshold is crossed;
- output cannot reconcile to its request and input/model/prompt/schema hashes;
- malformed JSON is being repaired by lossy guessing;
- a wave could exceed 475,153 active entries;
- production backup/off-host/restore/import/audit proof is missing;
- any code path would approve, publish, sign, or use a provider fallback.

Resume only from the last verified checkpoint with a new evidence event. Failed
history is append-only and must not be deleted to make counters reconcile.

## 4. Required implementation order

1. L1–L2: legal evidence, model locks and reproducible MLX provisioning.
2. L3–L5: provider-neutral protocol, worker and prompt policy.
3. L6–L7: candidate generation, validation, criticism and inventory freeze.
4. L8–L11: English authoring/critic and TranslateGemma translation/QA.
5. L12: mandatory 50-entry calibration and explicit owner go decision.
6. L13–L14: package assembly, production ledger and orchestrator.
7. L15: W1 through W6 without skipping milestone gates.
8. L16: similarity, human review, IPA/audio, release and exact final audit.

## 5. Definition of done

“Local generation complete” means the production ledger contains terminal,
reconciled evidence for all required stages and production has exactly 475,153
qualifying DSD text entries. It does not mean commercially released.

“Commercial release complete” additionally requires current human approvals,
similarity clearance, IPA, two approved audio assets per entry, rights evidence,
signed release membership, off-host recovery evidence and clean scratch
restore for all 475,153 entries.
