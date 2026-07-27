# Bilingual Dictionary Data Quality Review

Date: 2026-07-20  
Scope: generated JSON corpus, active PostgreSQL dictionary, import/enrichment scripts, API response behavior, and Expo/web/React Native/Chrome-extension consumption.

## Executive conclusion

The dictionary is large and technically populated, but it is **not yet safe to present as a curated English-learning dictionary**. It is useful as a raw lexical corpus and lookup fallback. The central quality problem is not missing Vietnamese text; it is incorrect sense alignment, unclean source markup, unreliable pronunciation selection, and the absence of learning-priority metadata.

Current release recommendation: **do not publish the legacy bilingual corpus as production learner content**. Its Vietnamese layer is frequently sense-misaligned and has no confirmed reusable license; the raw English layer also lacks complete row-level attribution. An unverified badge is a necessary UX warning, not legal clearance. Internal/reference lookup may remain enabled for development and curation, while active Learn and Review flows now accept curated rows only. The reviewed learner overlay is correctly empty until independent bilingual curation begins.

## Exported tables

| File | Rows | Purpose |
| --- | ---: | --- |
| `summary.csv` | 34 metrics | Raw corpus, trust-boundary, and normalized learner-overlay indicators |
| `distributions.csv` | 44 | Raw and learner POS, level, accent, quality, and review-state distributions |
| `focus_words.csv` | 1,377 definition rows | Detailed export across 37 common/polysemous learner headwords |
| `flagged_definitions.csv` | 2,000 issues | CJK, raw markup, untranslated fallback, and duplicate samples |
| `flagged_examples.csv` | 3,000 issues | Missing/CJK/identical/oversized example samples |

The audit can be reproduced from `english-learning-api/` with `npm run audit-bilingual`.

## Dataset inventory

| Metric | Result | Assessment |
| --- | ---: | --- |
| Headwords | 475,153 | Far broader than a learner dictionary; includes obscure, obsolete, dialectal, symbolic, and malformed entries |
| English definitions | 704,121 | High coverage, but many are raw extraction fragments |
| Examples | 361,167 | Large, but many are literary, specialist, malformed, or too long |
| Pronunciations | 106,021 | Only partial coverage |
| Words with no pronunciation | 405,385 (85.3%) | Critical for a pronunciation-centered product |
| Words with no frequency rank | 475,153 (100%) | Critical: current learning order and level labels are not evidence-based |
| Missing Vietnamese definitions | 0 | Misleadingly positive: presence is not correctness |
| Missing Vietnamese examples | 380 | Small completeness gap |
| Vietnamese identical to English | 3,181 definitions; 672 examples | Likely untranslated fallbacks |
| Vietnamese containing CJK | 9,015 definitions; 13,892 examples | Definite language contamination requiring quarantine |
| Duplicate definitions | 6,371 | Repeated senses clutter results and review cards |
| Raw markup definitions | 94,197 (13.4%) | Templates such as `(AAVE|...)`, broken references, HTML, and wiki artifacts |
| English examples over 300 characters | 32,913 (9.1%) | Poor mobile and beginner-learning material |
| Non-lexical headwords | 4,878 | Requires product filtering or a separate comprehensive mode |
| Legacy definitions eligible as trusted learner content | 0 of 704,121 | Correct after the reference-only migration |
| Legacy examples eligible as trusted learner content | 0 of 361,167 | Correct after the reference-only migration |
| Published normalized learner senses | 0 | Safe but incomplete: no sense has yet passed independent bilingual review |

## Source corpus versus audited local PostgreSQL snapshot

The 269 MB `English-Vietnamese-Dictionary/data/combined/dictionary.json` is the direct structural ancestor of the audited local snapshot:

| Field | Source JSON | Audited local snapshot |
| --- | ---: | ---: |
| Words | 475,153 | 475,153 |
| Definitions | 704,121 | 704,121 |
| Examples | 361,167 | 361,167 |
| Pronunciations | 106,021 | 106,021 |
| Vietnamese definitions | 0 | 704,121 nonblank |
| Vietnamese examples | 0 | 360,787 nonblank |

The English source was bulk imported and Vietnamese was layered onto the same sense rows afterward. Quality/provenance columns have since been added to the legacy tables, but the historic rows cannot be retroactively given reliable source-sense alignment or licensing provenance. They are therefore constrained to reference-only status.

A separate normalized learner schema now stores entry rank provenance, stable sense keys, English-definition provenance, sense-level CEFR evidence, independently reviewed Vietnamese, bilingual examples, and reviewed pronunciations. Only published entries/senses with approved Vietnamese can produce `data_source: curated`; a curated response exposes only approved learner pronunciations and does not mix in legacy forms or synonyms.

## Detailed linguistic findings

### 1. Vietnamese senses are frequently attached to the wrong English sense

This is the highest-severity content issue. The historic tudien import grouped senses by part of speech and assigned them by array position. Two dictionaries rarely use the same sense inventory or ordering. Once either source inserts, combines, or omits a sense, all subsequent Vietnamese meanings shift.

Examples from `focus_words.csv`:

| Word / English sense | Current Vietnamese | Assessment |
| --- | --- | --- |
| `be` — “To exist” | `kinh sợ`, `rét thấu xương`, `rộng`, `tức` across duplicate rows | Completely unrelated |
| `have` — “to include as a part or feature” | `ăn; uống; hút` | Wrong sense |
| `have` — perfect auxiliary | `tóm, nắm, nắm chặt` | Wrong sense |
| `love` — “deep liking or enthusiasm” | religious sense about God’s love | Wrong sense |
| `right` — body direction | `thẳng` | Wrong; should center on `bên phải/phải` |
| `set` — “start a fire” | table-setting meaning | Wrong sense |
| `record` — programming data structure | vinyl-record meaning | Wrong sense |

This also explains why some rows contain good Vietnamese words but are still pedagogically false.

Mitigation implemented: positional definition updates are disabled by default, the importer is dry-run by default, and any legacy write requires explicit write and unlicensed-source-risk acknowledgement flags. Existing shifted translations remain reference-only. Curated senses require stable keys, source provenance, and independent Vietnamese approval; unmatched senses must remain unpublished.

### 2. Core learner words expose too many rare senses before basic senses are curated

The entry for `be` contains 31 rows, including AAVE, dialectal, Cyrillic-letter, paraphilia, and medical fragments. A learner dictionary instead prioritizes the core A1 functions: description/identity, existence, location, continuous forms, and passive forms. Cambridge’s learner entry follows exactly that type of function-first organization and provides grammatical forms and usage examples.

The raw database still has this ordering problem. The public presenter now removes malformed/markup definitions and labels the remainder `raw_fallback` with `is_learner_visible: false`, but it can still show too many syntactically clean rare senses in comprehensive lookup mode. The normalized learner overlay provides explicit rank, learner band, sense order, usage labels, and publication state; it currently contains no reviewed content.

Remaining change: curate 3–8 core senses per priority headword for the default learner view, then move raw specialist/obsolete senses behind an explicit comprehensive/reference section.

### 3. Current levels are heuristic labels, not CEFR levels

All 475,153 frequency ranks are null. The generation code falls back to word length: short words become beginner, medium words intermediate, and long words advanced. This labels every sense of `be`, including obscure dialect and specialist senses, as beginner.

CEFR vocabulary levels are sense- and usage-dependent, not simply word-length-dependent. Council of Europe Reference Level Descriptions map words, grammar, functions, and other forms to proficiency levels; Cambridge’s English Profile work is corpus-informed and assigns levels to learner-relevant vocabulary and senses.

Schema mitigation implemented: curated `cefr_level`, source URL/version/license, evidence basis, and confidence now live at exact sense level. The historic word-length `level` remains only in the legacy database and audit exports; raw API responses omit it. Curated responses expose the compatibility label only when backed by reviewed sense-level CEFR.

### 4. Pronunciation accent assignment is unreliable

The Wiktionary parser defaults every unrecognized IPA pronunciation to `US`. The audited snapshot includes multiple conflicting “US” values for common words—for example `language` has `/ˈlæŋɡwɪd͡ʒ/`, `/æ/`, and `/laŋɡˈweːd͡ʒ/`. `right` has nine values marked US. Raw fallback still selects the first US and first UK rows without a deterministic quality rank.

The normalized pronunciation table now stores accent, priority, source/license, and independent review state, but it contains no reviewed rows yet. Curated responses no longer inherit raw pronunciation rows. Remaining work:

- Preserve Wiktionary region labels instead of defaulting unknown accents to US.
- Store pronunciation source, region, phonemic/phonetic type, and priority.
- Deduplicate normalized IPA.
- Curate one General American and one standard British pronunciation for learner mode.
- Never infer accent from an unlabeled value.

### 5. English definitions still contain extraction artifacts

94,197 definitions contain likely raw markup. Common patterns include `(transitive|obsolete)`, incomplete strings such as `(with To exist.`, empty glosses like `(medicine) .`, `thumb|...`, HTML entities such as `&emsp;`, and broken references.

Runtime mitigation implemented: markup/empty definitions are omitted from dictionary and category responses. The contaminated rows remain in the reference database for traceability. Longer term, reparse a structured source and preserve register/domain labels as arrays rather than definition prose.

### 6. Examples are not consistently suitable for learning

Problems include:

- 32,913 English examples over 300 characters.
- Literary quotations and dense specialist paragraphs.
- Broken entities and source markup.
- Examples whose Vietnamese translation contains Chinese.
- Semantically incorrect translation, such as `locust swarms` translated as ant swarms.
- Awkward or potentially harmful examples without register/content warnings.
- Example translations attached to the right English row but written in unnatural Vietnamese.

Runtime mitigation implemented: raw examples with unsafe Vietnamese, raw markup, empty English, or more than 300 English characters are omitted from presentation. Approved normalized examples have their own review/provenance gate. Reviewers should still select one short, self-contained, exact-sense example and validate natural Vietnamese before approval.

### 7. Vietnamese direction is translation, not a real reverse dictionary

`resolve()` detects Vietnamese mainly by diacritics and sends VI→EN to the general translation service. Vietnamese without diacritics can be misclassified as English. Results are sentence translations rather than ranked English equivalents connected to dictionary senses.

Required change: build a Vietnamese normalized-gloss index, including diacritic folding and tokenized equivalents. Return ranked English lemmas/senses first, with translation fallback clearly labeled.

### 8. Data licensing and provenance need product treatment

Wiktionary text is CC BY-SA/GFDL and requires attribution/share-alike compliance. Open English WordNet is actively maintained and available under CC BY 4.0. NGSL 1.2 is CC BY-SA 4.0 and now has immutable source bytes, hashes, attribution, and a tracked lock/notice.

The historic tudien archive is a release blocker: its repository provides no explicit reusable license and its own design notes say it aggregates Lạc Việt, TFlat, DictBox, Babylon, and Laban content. Do not publish that legacy Vietnamese without legal review or direct permission. The raw English corpus also requires verified source attribution before public redistribution. Both remain internal/reference material, and the tudien importer requires explicit risk acknowledgement.

## Licensed OEWN first-100 evidence review

The core Open English WordNet 2025 WN-LMF artifact is now acquired from its official `2025-edition` release, checksum-locked, streamed through a strict parser, and joined offline to the first 100 NGSL priority rows. The raw 11,363,503-byte gzip is not committed; its SHA-256, 89,237,271-byte expanded size, WN-LMF 1.3 declaration, full release commit, exact licenses, structural counts, and derived-file hashes are pinned in `data/learner-core/oewn-source-lock.json`.

The parser validated 135,969 lexical entries, 185,129 stable source senses, 107,519 synsets, 107,524 definitions, 49,596 examples, 43,534 pronunciations, 4,473 explicit forms, and 355,064 resolved sense/synset relations. It rejects checksum, byte-size, metadata, DOCTYPE, source-count, duplicate-ID, dangling-reference, missing-definition, and derived-output drift. It never fetches the external DTD.

### First-100 table results

| Metric | Result | Interpretation |
| --- | ---: | --- |
| Requested NGSL headwords | 100 | Priority rows 1–100, with original source casing retained |
| Headwords with exact case-sensitive OEWN entries | 72 | Spelling coverage only; semantic alignment remains unreviewed |
| Headwords without an exact entry | 28 | Mostly function words absent from WordNet's lexical scope |
| Exact OEWN lexical entries | 152 | Multiple parts of speech can share one spelling |
| Exported OEWN source senses | 863 | All preserved; no automatic “first sense” selection |
| Exact-entry rows with multiple source-sense candidates | 64 | 63 ordinary matches plus merged `may`/`May`; human selection is the normal case |
| Headwords with case-fold-only diagnostics | 13 | Diagnostics are never promoted unless casing exactly matches NGSL source evidence |
| Senses with one or more OEWN examples | 807 | Examples remain unreviewed and may illustrate another synset member |
| Senses without an OEWN example | 56 | Requires later learner-example authoring or selection |
| Headwords with any pronunciation evidence | 46 | Only 46 of 72 exact-match headwords; source varieties include AU, GB, IE, NZ, US, and unspecified |

The POS distribution is 434 verb senses, 162 noun senses, 132 adverbs, 99 adjective satellites, and 36 other adjectives. High-frequency verbs are extremely ambiguous: `make` exposes 51 raw senses, `take` and `give` 44 each, `get` and `right` 37 each, `go` 35, and `work` 34. OEWN order is retained for traceability but explicitly marked non-pedagogical.

The 28 rows without exact candidate senses are `the`, `and`, `of`, `to`, `it`, `you`, `for`, `they`, `that`, `we`, `with`, `this`, `she`, `from`, `or`, `if`, `would`, `which`, `who`, `when`, `what`, `because`, `could`, `than`, `into`, `where`, `should`, and `how`. `it`, `or`, and `who` have uppercase acronym collisions (`IT`, `OR`, `WHO`) that are recorded only as diagnostics.

Most importantly, an exact lemma match is not proof of the intended NGSL meaning:

| NGSL row | Exact OEWN evidence | Quality decision |
| --- | --- | --- |
| `a` | Roman-alphabet letter | Reject for the intended article sense |
| `he` | Fifth Hebrew letter | Reject for the intended pronoun sense |
| `at` | Lao monetary subunit | Reject for the intended preposition sense |
| `I` | Iodine, number one, Roman-alphabet letter | Reject for the intended pronoun sense |
| `may` + `May` | A flowering plant and the month | Neither represents the intended modal verb; retain only as source evidence |
| `be` | 12 verb senses | Plausible lexical coverage, but a reviewer must select and rewrite the learner functions |

The intended high-frequency grammar senses are independently visible in Cambridge's learner-facing entries: [`a`](https://dictionary.cambridge.org/dictionary/learner-english/a) is taught as an A1 determiner/article, [`he`](https://dictionary.cambridge.org/us/dictionary/english/he) and [`I`](https://dictionary.cambridge.org/dictionary/english/i) as A1 pronouns, [`at`](https://dictionary.cambridge.org/dictionary/learner-english/at) as an A1 preposition, and [`may`](https://dictionary.cambridge.org/dictionary/learner-english/may) as a modal verb. These references are comparison evidence only; their proprietary text is not copied into the dataset.

This independently confirms the central audit conclusion: neither exact spelling, source order, nor a large sense count can replace semantic curation. Every headword row therefore has `semantic_alignment_status=unreviewed`; every source sense is `candidate_status=unreviewed`; the artifact deliberately omits Vietnamese, CEFR, learner order, reviewer, timestamp, and publication status. It is not accepted by the database curation importer.

Exported review artifacts:

| File | Rows | Purpose |
| --- | ---: | --- |
| `data/learner-core/oewn-ngsl-first-100-headwords.csv` | 100 | Fast coverage, collision, ambiguity, and gap review |
| `data/learner-core/oewn-ngsl-first-100-senses.csv` | 863 | Flat stable-ID/POS/definition/example/form/pronunciation evidence table |
| `data/learner-core/oewn-ngsl-first-100-candidates.json` | 100 nested headwords | Canonical source-only handoff for later human curation tooling |
| `data/learner-core/oewn-source-lock.json` | 1 lock | Source, license, validation, NGSL selection, and derived-byte provenance |

Official references: [OEWN 2025 release](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition), [official release digest API](https://api.github.com/repos/globalwordnet/english-wordnet/releases/tags/2025-edition), and [Global WordNet WN-LMF format](https://globalwordnet.github.io/schemas/).

## Ten-word bilingual pilot checkpoint

The first curation handoff now contains 31 draft lexical senses across `be`, `have`, `do`, `say`, `go`, `time`, `people`, `year`, `way`, and `day`. Each row uses an exact stable OEWN sense key, the pinned OEWN 2025 artifact version and SHA-256, NGSL 1.2 rank provenance, a concise learner-facing English rewrite, an AI-assisted Vietnamese draft, and one original bilingual example. A machine test resolves every selected key and part of speech back to the locked first-100 OEWN candidate artifact.

The batch is deliberately not reviewed content. Every entry, sense, translation, and example is `draft`; the 31 rows contain no CEFR, pronunciation, reviewer, review timestamp, approval, or publication metadata. The generated CSV worksheet leaves semantic, translation, example, reviewer, timestamp, and reviewer-notes columns blank for a human reviewer.

A second AI quality gate reviewed all 31 selected senses against their exact OEWN glosses. It found no invalid sense keys or part-of-speech mismatches, then tightened the `be` identity/classification boundary, separated the first two `say` examples, broadened abstract possession under `have`, added the plural grammar label for general `people`, and corrected several Vietnamese phrases. These are draft improvements, not human approval; pedagogical ordering and natural bilingual equivalence remain explicit reviewer decisions.

| Pilot artifact | Rows | Status |
| --- | ---: | --- |
| `data/learner-core/pilot-ngsl-10-draft-2026-07-20.json` | 31 senses / 10 words | Valid curation input; draft only |
| `data/learner-core/pilot-ngsl-10-review-worksheet.csv` | 31 senses | Human decisions intentionally blank |

OEWN lexical coverage is not full grammar coverage. The selected `be` senses cover description, identity, location, and existence but not progressive/passive auxiliary construction; `have` covers possession, features, experiences, and consuming but not the perfect auxiliary or `have to`; `do` covers performing an action but not its question, negative, emphatic, or substitute functions. Cambridge learner entries confirm those omitted functions are central learner uses: [`be`](https://dictionary.cambridge.org/dictionary/learner-english/be), [`have`](https://dictionary.cambridge.org/us/dictionary/learner-english/have), and [`do`](https://dictionary.cambridge.org/dictionary/learner-english/do). Cambridge was used only as comparison evidence; none of its text or examples was persisted.

The schema gap identified by the source review is now closed in code: migration `1721401400000-AddLearnerDefinitionProvenance` adds nullable source-version/checksum columns without inventing legacy values, the curation CLI requires both fields for every new row and pins OEWN rows to the official 2025 checksum, new/updated published rows are database-blocked without them, and API/Expo types carry the optional provenance fields. The database migration and dry-run import still require local execution because this sandbox was denied access to PostgreSQL.

## Comparison with authoritative learner references

This audit does not copy proprietary dictionary text into the product. It uses learner dictionaries as a validation benchmark.

| Quality dimension | Authoritative benchmark | Current result |
| --- | --- | --- |
| Sense order | Core, common meanings first; rare/register meanings marked | Normalized schema supports reviewed order; raw fallback remains noisy; 0 curated senses |
| CEFR | Sense/function-specific levels derived from learner evidence | Curated sense-level provenance supported; legacy heuristic remains unverified; 0 curated labels |
| Pronunciation | Clear standard UK/US forms and grammatical variants | Reviewed accent/priority schema exists; raw accent data remains unreliable; 0 approved learner pronunciations |
| Definitions | Short, complete, learner-readable prose | 94,197 raw rows contain markup and are filtered from API; reviewed overlay empty |
| Examples | Short examples tied to the exact sense | Unsafe/long raw examples are excluded; independently approved learner examples: 0 |
| Bilingual equivalence | Meaning aligned per sense | Positional imports disabled; all legacy meanings reference-only; approved sense translations: 0 |

References:

- [Cambridge Learner’s Dictionary: be](https://dictionary.cambridge.org/dictionary/learner-english/be)
- [Cambridge Dictionary: have](https://dictionary.cambridge.org/dictionary/english/have)
- [Council of Europe: CEFR Reference Level Descriptions](https://www.coe.int/en/web/common-european-framework-reference-languages/reference-level-descriptions)
- [Council of Europe: English Profile reference-level description](https://www.coe.int/en/web/common-european-framework-reference-languages/reference-level-descriptions-rlds-developed-so-far)
- [Princeton WordNet](https://wordnet.princeton.edu/)
- [Open English WordNet](https://en-word.net/)
- [New General Service List 1.2](https://www.newgeneralservicelist.com/new-general-service-list)
- [Wikimedia dump licensing](https://dumps.wikimedia.org/legal.html)

## Remaining correction roadmap

### P0 — complete the release boundary

1. Obtain legal clearance/direct permission for legacy Vietnamese or suppress it from any public production response.
2. Verify attribution and license obligations for the raw English corpus before public redistribution.
3. Audit every remaining lookup surface so raw/generated data is never shown without its status.
4. Rehearse migrations and cache invalidation against a production clone before deployment.
5. Keep active category/topic and review flows curated-only; never relax the gate to fill an empty UI.

### P1 — rebuild core vocabulary first

1. Choose a licensed frequency/learner vocabulary list.
2. Curate the first 3,000–5,000 lemmas and their common senses.
3. Store CEFR per sense with provenance.
4. Curate General American and British IPA for core words.
5. Generate or select short examples, then have Vietnamese reviewers validate meaning and naturalness.

### P2 — finish the normalized content model

- Convert selected OEWN source candidates into learner-curation rows only after human semantic selection; the licensed, checksum-locked source ingestion and stable-ID review export are complete.
- Apply and rehearse `1721401400000-AddLearnerDefinitionProvenance`; the entity, migration, importer, API, and client contracts are implemented, but this sandbox could not access local PostgreSQL.
- Add reviewed/provenanced word forms and synonyms instead of inheriting legacy auxiliaries.
- Add pronunciation region/type plus an independently licensed audio source where available.
- Add register, domain, region, content-rating, and sense-frequency fields.
- Build a Vietnamese normalized-gloss index for ranked VI→EN equivalents, including diacritic folding.

### P3 — automated quality gates

Block publication when:

- Vietnamese contains CJK or is equal to English.
- Definition/example has unresolved templates or HTML entities.
- Sense alignment confidence is below threshold.
- A beginner item lacks a short example or standard pronunciation.
- A duplicate normalized sense already exists.
- The chosen example does not semantically represent its parent definition.

## Acceptance target for learner-safe release

- 100% of published A1–B1 senses have reviewed Vietnamese equivalents.
- 100% have a provenance record and valid license attribution.
- At least one curated pronunciation for all published headwords; UK/US where materially different.
- Zero CJK contamination, raw markup, or identical EN/VI fallbacks in published data.
- Core senses appear before specialist, obsolete, dialectal, vulgar, or figurative senses.
- Examples are concise, natural, sense-aligned, and reviewed in both languages.
- CEFR and frequency fields are source-backed and sense-aware.

## Final decision

The architecture and learning/review trust boundary have now been corrected, but the learner content itself has not. Cleaning the roughly 23,000 CJK-contaminated rows is necessary but insufficient; those and all other legacy rows are now reference-only. The 475k-word corpus remains useful for internal audit and curation, but public redistribution is blocked until its English provenance and Vietnamese rights are resolved. Learn and Review must remain empty or limited to independently approved normalized senses until the smaller core is deliberately curated.

## P0 implementation status

Implemented after the audit:

- Added partial legacy provenance fields, translation confidence, review status, quality flags, and learner-visibility fields through `1721401000000-AddDictionaryQuality.ts`; normalized learner tables carry the complete publication provenance model.
- Added runtime detection for missing Vietnamese, CJK contamination, identical EN/VI fallback, raw markup, and oversized examples.
- Raw dictionary responses preserve syntactically usable English but suppress unsafe Vietnamese, omit unsafe/markup/empty examples and definitions, omit the legacy word-length `level`, and expose `data_source`, `data_status`, `quality_flags`, and `is_learner_visible`.
- Web, Expo, React Native CLI, saved-word detail screens, and the Chrome lookup extension display reviewed/unverified/generated notices.
- Active web/Expo/React Native category clients request `learnerOnly=true`; raw category membership can no longer populate their learning packs.
- Backend review due/rating endpoints and Expo guest/authenticated review sessions reject reference-only entries. Invalid rating values also return `400` instead of advancing a word.
- Curated responses expose only approved learner pronunciations and do not inherit legacy forms or synonyms.
- Disabled tudien definition matching by POS + array position by default. The importer is dry-run by default; every legacy write, including exact-example updates, requires `--write --acknowledge-unlicensed-source-risk`. The legacy definition algorithm additionally requires `--unsafe-positional-definitions`.
- Removed the unauthenticated dictionary HTTP import endpoint.
- Added `1721401300000-MarkLegacyDictionaryReferenceOnly.ts`, which sets every legacy definition/example to reference-only and enforces that invariant for future writes.
- Added focused quality and merge-safety tests.
- Cleared local dictionary/category caches and verified live lookup/category fallback behavior.

The developer database backup was confirmed and all five migrations are applied. `legacy_definitions_learner_visible=0` and `legacy_examples_learner_visible=0`. Production still needs its own backup, migration rehearsal, maintenance window, and cache invalidation.

Final local live check after deleting four exact Redis entries:

- `/serious/dictionary/word/study` returned `raw_fallback` with 16 sanitized definitions, zero serialized `level` fields, zero detected markup definitions, and `is_learner_visible=false` on every row. Its repeated Vietnamese still demonstrates why “present” does not mean sense-correct.
- Learner-only topics, root categories, and category 5 words returned HTTP 200 with zero items, matching the empty curated overlay.
- The backward-compatible category endpoint still returned raw reference rows, while all active category clients now request `learnerOnly=true`.

## P1 implementation status

Implemented foundation:

- Added normalized `learner_entries`, `learner_senses`, `learner_sense_translations`, `learner_examples`, and `learner_pronunciations` tables with source, license, stable-key, review, CEFR, ordering, and publication constraints.
- Dictionary/category presenters prefer only published learner senses that have independently approved Vietnamese. Draft or unapproved Vietnamese cannot leak through the API.
- Search maintains a separate published-learner index and prioritizes reviewed entries.
- Added a transactional, idempotent curation CLI with file validation, database dry-run, explicit write, queue export, conflict guards, and publication-integrity statistics.
- Acquired and checksum-locked official NGSL 1.2 data: 2,809 ranked core rows plus 52 supplement rows produce 2,859 normalized candidate headwords. `March/march` and `May/may` retain both source memberships; supplement rank `0` is normalized to `null`, never CEFR or highest priority.
- Added machine-readable source policy and third-party attribution notices. Open English WordNet 2025 is selected as the licensed stable-sense backbone; CEFR-Annotated WordNet may provide provisional review hints only. Cambridge/English Profile and Oxford remain reference-only benchmarks.
- Added the strict OEWN 2025 acquisition/parser/validation pipeline, exact tagged license copies, and byte-stable source lock. The first 100 NGSL rows now export 100 headword records and 863 unreviewed source senses across 72 exact spelling matches; 28 rows have no exact OEWN entry.
- Added separate JSON and CSV review contracts that preserve sense/synset IDs, POS, definitions, examples, forms, pronunciation metadata, source order, case collisions, and missing rows without creating database curation records or review metadata.
- Added the exact-definition-provenance migration and end-to-end fields, plus a 31-sense/10-word AI-assisted draft and generated human-review worksheet. All pilot decisions remain draft and unapproved.
- Disabled automatic TypeORM schema synchronization by default; migrations are now the schema source of truth.

Not yet complete:

- `learner_entries_total=0`, `learner_senses_published=0`, approved Vietnamese translations `=0`, approved learner examples `=0`, and approved learner pronunciations `=0`.
- No human-approved bilingual review batch has been imported. The 10-word pilot is an AI-assisted draft only, which is why current searches still show `raw_fallback`, not `curated`.
- Human semantic selection for the first-100 OEWN queue is not complete. Exact matches such as `a`, `he`, `at`, `I`, and `may/May` prove that the queue cannot be bulk-promoted.
- Vietnamese normalized-gloss reverse search, especially diacritic-free queries, is not implemented yet.
- Curated UK/US pronunciation selection, learner-safe examples, and exact-sense CEFR validation still require review work.
- NGSL-GR remains deferred until its downloadable schema/version are manually verified; its bands must not be guessed or called CEFR.

## Current release gate

| Capability | Status | Decision |
| --- | --- | --- |
| Raw English lookup | Available internally with sanitization; attribution incomplete | Public release blocked until source/license obligations are verified |
| Legacy Vietnamese meanings | Present internally but often misaligned and licensing-unverified | Public release blocked pending permission/legal clearance |
| Reviewed bilingual learner dictionary | 0 published senses | Not ready |
| Structured vocabulary/review packs | Curated-only gates active; no approved learner content | Safely empty, not content-ready |
| Frequency-prioritized review queue | 2,859 NGSL candidates plus a locked first-100 OEWN evidence batch (72 exact lemma matches, 863 source senses) | Ready for human sense selection; not import-ready |
| Database trust boundary | Five migrations last verified locally; sixth provenance migration implemented but not applied from this sandbox | Run `migration:show`, apply/rehearse migration 140, then dry-run the pilot |

The next safe content milestone is human semantic triage of `oewn-ngsl-first-100-headwords.csv`: mark lexical gaps, reject false function-word matches, and select only common learner senses from the 863-row sense table. A bilingual reviewer must then author natural Vietnamese and one concise bilingual example and verify pronunciation. Convert only those reviewed selections to the curation-import schema, import them first as draft, run the database dry-run and review statistics, then publish only individually approved senses.
