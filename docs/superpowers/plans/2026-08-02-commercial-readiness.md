# Commercial Readiness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Take the product from "cannot legally be sold" to "shippable commercially", by replacing the unlicensed corpus with a licensed one, closing the security backlog, and making attribution real.

**Architecture:** Four gates. G1 stops the current legal exposure in a day. G2 builds the only content that can actually be sold. G3 clears the security backlog. G4 covers the operational work a paid product needs. G1 and G3 can run in parallel; G2 is the long pole and gates launch.

**Tech Stack:** NestJS 10→11, PostgreSQL 15, TypeORM, OEWN 2025, NGSL 1.2, OpenRouter (paid).

## The finding that drives this plan

| | |
| --- | --- |
| Definitions the API will serve today | **650,400** |
| Examples the API will serve today | **300,824** |
| Published curated senses | **0** |
| Licence covering the Vietnamese in all of it | **none** |

Every servable row carries `tudien` Vietnamese. The importer's own header states the archive *"does not state an explicit reusable license and aggregates third-party dictionary content."* There is no per-row provenance — `source`, `translation_method` and `translation_confidence` are empty on 100% of rows — so cleared and uncleared content cannot be separated after the fact.

**This is not fixable by re-translating.** A translation is a derivative of its source, so obligations follow the English, not the translator:

- Wiktionary English (the legacy corpus) → CC BY-SA 3.0 → **share-alike infects the Vietnamese output**.
- OEWN English → CC BY 4.0 → **attribution only, commercially clean**.

Re-translating the legacy corpus therefore spends money improving content that still cannot be sold. Phase C of the enhancement plan is suspended.

## Licence position per source

| Source | Licence | Commercial | Action |
| --- | --- | --- | --- |
| OEWN 2025 | CC BY 4.0 | Yes, attribution | **Adopt as the English backbone** |
| Princeton WordNet | WordNet License | Yes, attribution | Attribution alongside OEWN |
| NGSL 1.2 | CC BY-SA 4.0 | Yes, attribution + share-alike on the list | Use for **ordering only**; do not redistribute the list |
| Wiktionary (legacy English) | CC BY-SA 3.0 / GFDL | Yes, but share-alike | Internal reference only |
| `tudien` (legacy Vietnamese) | **None** | **No** | **Never serve. Remove from production.** |
| AI output from OEWN English | derivative of CC BY 4.0 | Yes | Owned by you, subject to model ToS |

## Global Constraints

- Run everything under Node 24 (`/opt/homebrew/opt/node@24/bin`); default shell Node 22 breaks `better-sqlite3`.
- Migrations registered in **both** `src/migrations/runner.ts` and `scripts/migrations.ts`.
- Any migration rewriting `example_en`/`example_vi` must drop `UQ_examples_definition_digest` first.
- `String.raw` for every SQL-embedded regex.
- No task may publish a learner row without human bilingual approval — enforced by `TRG_learner_sense_publish_requires_approved_translation`.
- **Nothing in G2 may take English from the legacy corpus.** OEWN only, or the share-alike problem returns.

---

# Gate 1 — Stop the exposure (do first, ~1 day)

### G1.1 Gate `raw_fallback` behind config, default off

**Files:** `src/dictionary/dictionary.service.ts`, `src/dictionary/dictionary.service.spec.ts`, `.env.example`

`findWordInDatabase` returns `LookupWordResponseDto | null`, and `lookupWord` already treats `null` as "not in database" — falling through to LLM generation or a 404. That is the correct gate point: no new error paths, no client changes.

Add `DICTIONARY_SERVE_RAW_FALLBACK`, defaulting to **false**. When false and no published learner entry exists, return `null` instead of the `raw_fallback` payload.

Effect: the API can no longer serve unlicensed Vietnamese. Coverage drops to whatever is curated — currently zero — so this is deployed together with G2 content, or with `LLM_FALLBACK_ENABLED=true` so lookups degrade to clearly-labelled `generated_fallback` rather than 404.

### G1.2 Remove `tudien` Vietnamese from the production database

**Files:** new migration `1721404000000-QuarantineUnlicensedVietnamese.ts`

Gating the API stops serving it; it still sits in the production database, which is itself a distribution risk if the database is ever handed to a partner or restored elsewhere.

Null `definition_vi` and `example_vi` across the legacy corpus in production, backed up to `cleanup_backup_tudien_vietnamese`. Keep the full data in a separate internal database restored from `word-data-export-2026-08-01/`. The English stays — it is CC BY-SA, usable internally, and needed as OEWN-matching evidence.

Do **not** run this until G2 content exists, or the product has nothing at all.

### G1.3 Attribution surfaces in every client

**Files:** web, Expo, React Native, Chrome extension, macOS app

A credits screen naming OEWN 2025 (CC BY 4.0), Princeton WordNet, and NGSL 1.2 (CC BY-SA 4.0), each with a resolvable URL. CC BY 4.0 requires attribution "in any reasonable manner" — a reachable credits screen plus a line in the app store description satisfies it.

Also surface per-entry attribution where a curated sense is shown, driven by the `definition_source` / `definition_source_url` columns the constraints now guarantee.

### G1.4 Independent legal review

Not an engineering task, but the gate does not close without it. Give counsel: this document, `docs/provenance-and-licensing.md`, and the four licence files under `data/learner-core/licenses/`. The specific questions are whether CC BY 4.0 attribution as designed is sufficient, whether NGSL share-alike reaches a rank column, and whether retaining Wiktionary English internally creates any obligation.

---

# Gate 2 — Build sellable content (the long pole)

### G2.1 NGSL frequency rank

Migration `1721403400000` adds `words.ngsl_rank` plus a partial index; `scripts/import-ngsl-rank.ts` checksum-verifies `ngsl-candidates.csv` and populates ~2,809 ranks. Leaves `frequency_rank` untouched — its provenance is unknown and it is null on all 475,153 rows.

### G2.2 OEWN sense import as drafts

Extend `scripts/oewn-source.ts` beyond the current 100-word limit to the full NGSL set. Import into `learner_entries` + `learner_senses` as `status = 'draft'`, carrying `definition_source = 'oewn'`, the pinned `2025-edition` version, and the artifact SHA-256 the constraints require.

**Sense selection is the hard part.** OEWN averages **8.6 senses per NGSL word**; a learner dictionary wants 1–3. Import all as draft, then rank by OEWN sense order and let review select. Never auto-publish.

### G2.3 AI-drafted Vietnamese from OEWN English

Reuse `scripts/ai-translate/` with a new `--target oewn-draft`. Critically, the English input is **OEWN**, not the legacy corpus, so the output is a derivative of CC BY 4.0.

Every row lands as `learner_sense_translations` with `review_status = 'draft'`, `method = 'ai'`, and the model recorded. `validateTranslation` already blocks CJK, echoes and commentary. Use a **paid** model: the free tier permits training on prompts and is the suspected origin of the existing contamination.

### G2.4 Human bilingual review

Worksheets from `scripts/learner-overlay/build-worksheets.ts`. Reviewer supplies: which senses to include, the approved Vietnamese, CEFR, and an example pair. Approval sets `reviewed_by` / `reviewed_at`; the trigger blocks publication otherwise.

**Sizing:** 3,000 headwords × ~2 selected senses ≈ 6,000 senses. At ~300/day with AI drafts to verify, roughly **20–30 working days for one reviewer**.

**Start with 300 words, not 3,000.** Validate the worksheet format before a reviewer invests weeks; a format change afterwards means redoing their work.

### G2.5 Publish and verify

`learner_senses.status = 'published'` only for reviewed rows. Then `data_source: 'curated'` starts appearing, and G1.1 stops costing coverage.

---

# Gate 3 — Security (parallel with G2)

### G3.1 The six clean fixes

`axios` (SSRF via NO_PROXY bypass), `brace-expansion` (ReDoS), `form-data` (CRLF injection), `minimatch` (ReDoS) all resolve without breaking changes:

```bash
npm audit fix
npm test && npm run build
```

### G3.2 The four majors

`@nestjs/platform-express` → 11 (pulls `express`, `path-to-regexp`), `@nestjs/swagger` → 11 (pulls `js-yaml`, `lodash`), `multer` → 2. This is effectively a NestJS 10 → 11 upgrade: do it on its own branch with the full suite green before and after.

### G3.3 Web client audit

`KNOWLEDGE.md` records 10 high and 1 critical in `english-learning-games`. Re-run and clear; a critical in the browser bundle is a launch blocker.

### G3.4 Secrets and configuration

Confirm no `.env` is committed in any of the three deployed repos; rotate `JWT_SECRET` for production and verify the development fallback cannot be reached when `NODE_ENV=production`; confirm `OPENROUTER_API_KEY` is not in any client bundle. CORS is already correct — production restricts to configured origins, so the `KNOWLEDGE.md` note calling it "open" is stale.

---

# Gate 4 — Operational

### G4.1 Drop the cleanup scaffolding before production

`cleanup_backup_*` and `cleanup_*_stage` tables are rollback artifacts and must not ship. Drop them by explicit name in a reviewed migration, only after a verified encrypted dump exists. **Keep `cleanup_review_example_vi_conflicts` and `cleanup_review_vi_echoes`** — those are retained findings, not scaffolding.

### G4.2 Backup and restore rehearsal

Prove a restore, not just a dump. The `cleanup_backup_*` tables are currently the only copy of a lot of deleted text.

### G4.3 Terms, privacy, and data handling

The product stores Google tokens (`moodtune` pattern), user word lists, and lookup history. A paid product needs a privacy policy covering retention, and a statement that lookups are sent to a third-party model when `generated_fallback` is enabled.

---

## Launch checklist

```sql
-- must be 0: no unlicensed Vietnamese reachable
select count(*) from definitions where definition_vi is not null;
-- must be > 0: there is something to sell
select count(*) from learner_senses where status = 'published';
-- must be 0: nothing published without an approved Vietnamese translation
select count(*) from learner_senses s where s.status='published'
  and not exists (select 1 from learner_sense_translations t
                   where t.learner_sense_id = s.id and t.locale='vi' and t.review_status='approved');
```

```bash
npm audit --omit=dev          # 0 high, 0 critical
npm test && npm run build     # green
```

Plus: attribution reachable in all five clients, legal sign-off recorded, restore rehearsed.

## Recommended order

1. **G3.1** — six vulns, one command, no downside.
2. **G1.1** — the gate, defaulting off. Deploy with `LLM_FALLBACK_ENABLED=true`.
3. **G2.1 → G2.4** — the long pole. Start the 300-word pilot immediately; reviewer time is the critical path.
4. **G3.2, G3.3** — the majors, in parallel with review.
5. **G2.5, G1.2, G1.3** — publish, purge, attribute.
6. **G1.4, G4** — sign-off and operational readiness.

## Known Non-Goals

- Re-translating the legacy corpus (Phase C) — improves content that cannot be sold.
- Re-parsing Wiktionary for the 35,953 lost definitions — same reason, plus share-alike.
- Repopulating legacy `word_forms` / `synonyms` — sources gone, and OEWN relations need schema that does not exist.
- Broadening frequency beyond NGSL — needs a licensed corpus first.
