# DSD Full-Corpus AI Automation Implementation Plan

> **Status:** Target and initial generation scaffolding implemented. The
> OpenAI-specific generation direction is superseded by
> `2026-08-11-dsd-local-model-full-corpus.md`.
>
> **Target:** 475,153 unique normalized English DSD entries, independently
> selected and newly generated. The old corpus supplies one scalar count only.
>
> **Current production state:** 50 independently selected DSD entries and 150
> AI-generated text records are staged as drafts in `dsd_corpus_db`. They are
> not published. The owner's 2026-08-09 approval intent must still be converted
> into hash-bound review decisions before their database status can change.

## Goal

Automate production of a new DSD English–Vietnamese learning corpus with the
same entry count as the legacy corpus, without translating, paraphrasing,
copying, or using the legacy headword list or expressive content as generation
input. Generate all records as auditable drafts; release only records that pass
the existing human approval, originality, quality, IPA, audio, backup, and
commercial-safe gates.

## Fixed decisions

1. Target size is exactly `475153` unique normalized English entries. Evidence:
   `docs/dsd-corpus/evidence/LEGACY-CORPUS-AGGREGATE-COUNT-2026-08-09.md`.
2. Legacy data is not a seed corpus. The generator receives neither legacy
   headwords nor legacy definitions, translations, examples, IPA, IDs, order,
   frequency, coverage, or similarity matches.
3. Production generation uses the approved local MLX architecture in
   `2026-08-11-dsd-local-model-full-corpus.md`: Qwen3-14B 4-bit for inventory
   and English authoring, isolated Qwen3-8B 4-bit for criticism, and
   TranslateGemma-12B-IT 4-bit for English-to-Vietnamese translation. OpenAI
   and OpenRouter are not used by the active path.
4. The previously implemented direct-OpenAI adapter remains historical and
   disabled. It must not be silently repurposed as a fallback.
5. English source content is newly authored from a blank DSD prompt and only
   then translated to Vietnamese. This is not a translation or paraphrase of
   legacy definitions.
6. AI actor `DSD-G-001` creates drafts. Human owner `DSD-O-001` may approve
   exact content hashes. AI output cannot auto-approve or auto-publish itself.
7. Milestones of 500, 5,000, and 20,000 remain release/quality gates. They are
   no longer the final corpus-size target.
8. The generator stops only when DSD has exactly 475,153 qualifying entries;
   reserve and quarantined candidates never count toward the target.

The active model, license, quantization, isolation and calibration decisions are
specified in `2026-08-11-dsd-local-model-full-corpus.md`.

## Clean-room architecture

```text
aggregate count artifact (475153)
             |
             v
DSD-owned topic/morphology planner --> independent candidate inventory
                                             |
                                             v
                                  normalize + deduplicate + validate
                                             |
                                             v
                                   local model generation
                                             |
                                             v
                              deterministic QA + AI critic pass
                                             |
                                             v
                                      DSD draft database
                                             |
                         +-------------------+-------------------+
                         |                                       |
                         v                                       v
              restricted similarity audit              human hash review
              (scores/flags only)                       (DSD-O-001)
                         |                                       |
                         +-------------------+-------------------+
                                             v
                               IPA + two-voice audio gates
                                             |
                                             v
                                signed incremental releases
```

The local generation worker has no provider key and no legacy database
credential. The compliance worker remains the only
process that can open the narrow legacy similarity view. It returns a decision
or score, never legacy wording, to the DSD workflow.

## Counting contract

Create `data/dsd/targets/legacy-parity-2026-08-09.json` containing only:

```json
{
  "target_id": "DSD-TARGET-LEGACY-PARITY-20260809",
  "language": "en",
  "unique_normalized_entries": 475153,
  "evidence_id": "LEGACY-CORPUS-AGGREGATE-COUNT-2026-08-09",
  "legacy_inventory_used": false
}
```

The progress command must report at least:

- target, active inventory, drafts, approved text-complete entries;
- IPA-complete, audio-complete, release-eligible, and published entries;
- reserve, rejected, quarantined, duplicate, retry, and terminal-failure counts;
- the exact deficit to 475,153 at each gate.

An entry counts toward inventory parity only if it has a non-empty English
headword whose DSD normalization is unique. It counts toward commercial corpus
parity only after every current release gate passes. Reports must not collapse
these two materially different numbers.

---

# Phase A — Lock target, provider, and spend controls

## Task 25: Implement and verify the scalar target contract

**Files:**

- Create `data/dsd/targets/legacy-parity-2026-08-09.json`
- Create `data/dsd/schemas/corpus-target.schema.json`
- Create `scripts/dsd/target.ts` and tests
- Modify `package.json`

**Commands:**

```text
dsd:target:validate --file <target.json>
dsd:target:status --target <target-id>
```

**Acceptance:**

- Schema rejects every field capable of carrying legacy words, IDs, order,
  ranks, coverage, or content.
- Target is exactly 475,153 and is bound to the aggregate evidence.
- Status counts distinct DSD-normalized English headwords, not raw rows.
- An over-target database is a hard failure; the tool never deletes to repair it.

## Task 26: Calibrate the direct OpenAI model

> **Superseded:** Do not implement or execute this task. Use Tasks L1–L12 in
> `2026-08-11-dsd-local-model-full-corpus.md`. The text below is retained only
> to explain the already-implemented historical OpenAI scaffolding.

**Files:**

- Create `scripts/dsd/ai/model-calibration.ts` and tests
- Create `data/dsd/schemas/ai-run-manifest.schema.json`
- Create `docs/dsd-corpus/evidence/AI-MODEL-CALIBRATION-<date>.md`
- Update source/tool registries with the direct API tool and accepted model
  evidence; remove any OpenRouter default from the DSD path.

**Process:**

1. Keep the existing owner-accepted 50-item Codex draft batch as the baseline;
   database approval remains pending its 150 hash-bound decisions.
2. Generate a new 50-item comparison batch with direct OpenAI Structured
   Outputs, using no legacy input.
3. Measure schema pass rate, English correctness, Vietnamese naturalness,
   example alignment, exact/near-duplicate rate, latency, input/output tokens,
   retry rate, and cost per accepted entry.
4. Record the requested model ID, response model ID, SDK version, prompt-policy
   hash, JSON Schema hash, parameters, timestamps, provider request IDs, and
   provider terms evidence.
5. The owner reviews the 50 comparison entries and explicitly selects or rejects
   the candidate configuration.

**Acceptance:**

- The runner uses `api.openai.com` through the official `openai` SDK; tests fail
  if an OpenRouter base URL or `openai/...` router-style model ID is supplied.
- API keys never enter packages, logs, prompts, manifests, or provenance rows.
- Full-run cost ceiling, per-day token ceiling, concurrency, and a kill switch
  are configured before any batch larger than 50.
- No mutable or unrecorded model configuration can enter production. If the
  provider exposes no immutable snapshot for the chosen model, the evidence
  must state that limitation and obtain an explicit owner decision before scale.

---

# Phase B — Build an independent 475,153-headword inventory

## Task 27: Create the DSD candidate planner

**Files:**

- Create `scripts/dsd/ai/inventory-planner.ts` and tests
- Create `data/dsd/schemas/inventory-plan.schema.json`
- Create versioned DSD topic, grammatical, morphological, phrase, and register
  taxonomies that contain categories/rules but no imported word list.

**Process:**

- Divide the target into DSD-owned coverage cells: learner level, part of
  speech, topic, register, single/multiword form, productive morphology, and
  domain.
- Ask the model for candidates cell by cell with a stable cell ID and bounded
  output count. Do not ask it to reproduce a dictionary or match an external
  corpus.
- Generate at least 15% reserve capacity. The initial planning target is
  550,000 valid unique candidates, adjusted upward only from measured rejection
  rates.
- Assign UUIDs, DSD priority, band, rationale, generation batch, clean-room
  declaration, and evidence IDs. Do not assign legacy identity or ranking.

**Acceptance:**

- Planner process has no legacy credential and its network/file access test
  proves that it cannot open legacy exports.
- Every candidate traces to a DSD coverage cell and prompt hash.
- Re-running a completed cell is idempotent and cannot create a second active
  normalized headword.

## Task 28: Validate and freeze the inventory

Run deterministic normalization, allowed-script checks, token/length bounds,
character checks, duplicate detection, offensive/unsafe-term routing, proper
name/abbreviation routing, and an independent lexical-validity critic pass.
Quarantine doubtful or malformed candidates; never fill a deficit by relaxing
validation.

Freeze inventory in waves of 500, 5,000, 20,000, 100,000, 250,000, and
475,153. Selection within a wave uses only DSD priority and a deterministic
hash tie-breaker. It never uses legacy membership or order.

**Acceptance:**

- Exactly 475,153 active unique normalized inventory entries.
- At least the measured replacement reserve remains outside the active set.
- Zero empty, duplicate, untraceable, or legacy-derived entries.
- The owner approves coverage distributions and a random sample before text
  generation proceeds beyond each milestone.

---

# Phase C — Resumable AI text generation

## Task 29: Add generation runs and job checkpoints

**Files:**

- Add a DSD migration for `dsd_generation_runs`, `dsd_generation_jobs`, and
  append-only request/result evidence.
- Create `scripts/dsd/ai/run.ts`, `scripts/dsd/ai/progress.ts`, and tests.

Each job contains a DSD entry UUID, state, attempt count, input hash, prompt
hash, schema hash, provider/model evidence, request ID, output hash, token
usage, cost, timestamps, and quarantine reason. It contains no legacy field.

Required state flow:

```text
queued -> submitted -> received -> schema_valid -> quality_valid
       -> imported_draft -> review_ready
       -> retry_wait | quarantined | terminal_failure
```

Use leases and idempotency keys so a crashed runner can resume without duplicate
charges or duplicate database records. Retry only transient failures with
bounded exponential backoff; semantic/schema failures go to repair or
quarantine after the configured attempt limit.

## Task 30: Generate definition, Vietnamese, and example packages

> **Superseded:** The active implementation is Tasks L8–L11 in
> `2026-08-11-dsd-local-model-full-corpus.md`. Direct OpenAI Batch is not an
> authorized production fallback.

For each inventory item, request strict JSON containing one initial learner
sense, part of speech, original English definition, natural Vietnamese
explanation, one aligned English example, its Vietnamese rendering, usage
labels, and confidence/uncertainty flags. Generate additional senses only in a
later versioned pass; entry parity is not achieved by inflating sense counts.

Submit bounded jobs through the direct OpenAI Batch endpoint where calibration
shows it is appropriate. Use synchronous Responses requests only for repair and
small calibration runs. Parse with Structured Outputs, then run the existing
offline curation validator before any database write.

**Acceptance:**

- Every imported text row is `draft`, authored by `DSD-G-001`, and has exact
  generation/provenance hashes.
- The generator cannot set review, approval, publication, or similarity fields.
- Re-running a completed job is a no-op.
- Stop automatically when a spend/token limit, anomaly threshold, kill switch,
  or unresolved provider/model drift is detected.

## Task 31: Add automated critic and repair passes

Run deterministic DSD quality checks first, then a context-isolated critic pass
that checks English accuracy, circularity, Vietnamese fidelity/naturalness,
example grammar, definition/example agreement, harmful content, and suspected
fabrication. The critic receives only DSD candidate/output, not legacy content.

Failures may be repaired from the blank DSD context. Each repair creates a new
revision and invalidates earlier review/similarity results. Never ask the model
to paraphrase a similarity hit or show it the matched wording.

---

# Phase D — Originality, review, IPA, and audio

## Task 32: Run fail-closed similarity screening

The existing restricted compliance process scores English DSD text against the
legacy reference after generation. It writes only score, policy hash, content
hash, state, and evidence. Exact/high-similarity findings are quarantined.
Replacement generation is told only that a slot is vacant, never which legacy
record matched or what it said.

After every rejection, activate an independent reserve candidate and generate
it through the full pipeline. Continue until the active qualifying count is
again exactly 475,153.

## Task 33: Automate owner review queues without auto-approval

Generate review queues in batches of at most 50 with exact content hashes.
Provide fast approve/reject navigation, Vietnamese/English rendering, reason
codes, sampling dashboards, and stale-hash protection. `DSD-O-001` remains the
decision actor; the automation may prepare decisions but may never invent a
human approval.

The owner's approval of the current 50-item package must first be materialized
as 150 hash-bound decisions and applied on production. Approval still does not
publish.

## Task 34: Generate and gate IPA/audio

After text approval, generate en-US IPA candidates and both approved server-side
voice assets (LJSpeech and Norman), with hashes and rights evidence. Automated
QA runs on every asset. Human IPA/audio approval requirements remain those in
the master commercial corpus plan; this automation plan does not silently
weaken them to reach the target faster.

Expected full-parity capacity before rejection reserve:

- 475,153 en-US IPA records;
- 475,153 LJSpeech audio assets;
- 475,153 Norman audio assets;
- 950,306 audio objects plus manifests/backups.

Storage, generation time, listening throughput, and restore time must be
measured at the 500 and 5,000 milestones before authorizing the next wave.

---

# Phase E — Production waves and exact parity

## Task 35: Add a production orchestrator

Create a single resumable command with explicit scopes:

```text
dsd:full-run plan --target DSD-TARGET-LEGACY-PARITY-20260809
dsd:full-run generate --wave <wave-id>
dsd:full-run validate --wave <wave-id>
dsd:full-run stage --wave <wave-id>
dsd:full-run status
dsd:full-run pause
```

There is deliberately no `approve-all`, `publish-all`, destructive reset, or
legacy-import command.

Production writes require, in order: verified pre-wave DSD dump, off-host copy,
restore proof within policy age, dry-run manifest, count guard, explicit wave
authorization, transactional import, post-import audit, and verified post-wave
dump. Failure leaves the wave resumable and the public channel unchanged.

## Task 36: Execute milestone waves

| Wave | Cumulative active entries | Purpose |
| --- | ---: | --- |
| W0 | 50 | Existing AI draft pilot and owner-review workflow |
| W1 | 500 | Schema, content, review, IPA/audio, and cost calibration |
| W2 | 5,000 | First complete commercial release candidate |
| W3 | 20,000 | Extended corpus and operational scale proof |
| W4 | 100,000 | Long-tail quality and storage proof |
| W5 | 250,000 | Recovery, throughput, and cost proof |
| W6 | 475,153 | Exact independent parity target |

Each wave is additive and signed. It may start only after the prior wave's
metrics and anomaly report are reviewed. Rejection/quarantine backfill occurs
before a wave is considered complete.

## Task 37: Prove final parity and prepare release

Final audit must prove:

- exactly 475,153 active English normalized headwords;
- exactly 475,153 text-complete entries and zero missing required children;
- no active duplicates, empty headwords, legacy IDs, blocked sources, unresolved
  similarity findings, stale reviews, or provenance mismatches;
- exact IPA and two-voice audio membership for every released entry;
- no automatic approvals and no AI actor in a reviewer field;
- all generation runs reconcile submitted, received, imported, rejected,
  quarantined, reserve, retry, token, and cost totals;
- signed deterministic export, verified on-host/off-host backups, and a clean
  scratch restore;
- commercial-safe API serves the selected signed DSD release and still never
  falls back to legacy data.

## Stop/go rules

Stop the automation immediately on any of these conditions:

- provider/model identity differs from the calibrated run;
- legacy credential or forbidden field is visible to a generation process;
- spend/token/day or cumulative budget is reached;
- invalid, duplicate, quarantine, similarity, or Vietnamese-quality rate crosses
  its calibrated threshold;
- provenance cannot reconcile a request/result/import;
- backup, off-host copy, or restore verification fails;
- target logic would exceed 475,153 active entries;
- release code would approve, publish, or fall back automatically.

Resume only from the last verified checkpoint with a new evidence record. Do
not delete or rewrite failed history to make counters balance.

## Required implementation order

> **Superseded for generation:** Follow the required implementation order in
> `2026-08-11-dsd-local-model-full-corpus.md`. This list is archival.

1. Tasks 25–26: target and direct-model calibration.
2. Tasks 27–28: independent inventory planner and 500-entry inventory gate.
3. Tasks 29–31: resumable generation, validation, critic, repair.
4. Task 33 for the existing 50 records, then complete the 500-record review.
5. Tasks 32 and 34: similarity, IPA, and audio gates.
6. Task 35: production orchestrator and backup/restore integration.
7. Task 36 wave-by-wave execution; never jump directly from 50 to 475,153.
8. Task 37 exact final audit and signed release decision.

## Definition of done

“Generated all data” means the job ledger contains a terminal, reconciled result
for the full target and production has exactly 475,153 qualifying DSD entries.
“Commercially released all data” is stricter: all 475,153 also have current
human approvals, similarity clearance, IPA, both audio assets, provenance,
rights evidence, signed release membership, and verified recovery evidence.
The two statements must never be reported as equivalent.
