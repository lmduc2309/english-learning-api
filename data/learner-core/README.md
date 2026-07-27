# Learner dictionary curation

This directory is the staging boundary between raw dictionary imports and learner-visible bilingual content. Raw `definitions` and `examples` remain source evidence. The normalized `learner_*` tables are the reviewed overlay used by the public dictionary API.

## Safety model

- A learner entry is visible only when the entry and sense are `published` and the Vietnamese translation is independently `approved`.
- Examples and pronunciations have their own review states. A published sense does not make draft child content public.
- `approved` and `published` records require an explicit reviewer and ISO-8601 review timestamp. The importer does not manufacture review metadata.
- Automated frequency, CEFR, translation, or quality output is evidence for review, never approval.
- Learner rank and learner band are source-specific learning-priority metadata, never CEFR. Preserve their source URL, source version, and license.
- Every newly curated English definition must retain `definition_source_version` and the lowercase SHA-256 of the exact source artifact. OEWN rows must match the pinned 2025 artifact, not merely contain a valid-looking digest.
- Re-running the same input updates the same entry, stable sense, Vietnamese translation, example order, and pronunciation accent/priority. It does not duplicate them.
- All rows in one `--write` import run commit or roll back together. Missing headwords abort the write.

The source policy and licenses are recorded in [source-manifest.json](./source-manifest.json). Verify the upstream license again whenever a new source version is downloaded, and retain the exact downloaded artifact and checksum in a separate ingestion manifest.

## Workflow

1. Apply the learner-schema migrations after taking a PostgreSQL backup. `1721401400000-AddLearnerDefinitionProvenance` adds exact definition-source version/checksum fields without fabricating values for existing rows. `1721401500000-AddVietnameseGlossSearch` adds a deterministic diacritic-folded search field for approved Vietnamese glosses; it changes lookup indexing, not publication state.
2. Use `ngsl-candidates.csv` as the authoritative source for NGSL priority and rank metadata. `learner_rank` is explicit and nullable; never infer it from `priority_order` or the line number. `candidate-words.txt` is only the same ordered headwords projected for the queue command.
3. Acquire and validate the licensed English sense backbone, then regenerate the first review batch without touching PostgreSQL:

   ```sh
   npm run oewn:fetch -- --write --limit 100
   npm run oewn:validate -- --limit 100
   npm run oewn:candidates -- --limit 100
   ```

   Review `oewn-ngsl-first-100-headwords.csv` before the larger sense table. A `matched` row means only that an exact spelling exists in OEWN; semantic alignment is still `unreviewed`. For example, the automatic matches for `a`, `he`, `at`, and `I` describe letters, units, or elements rather than the intended high-frequency grammar words. `it`, `or`, and `who` have uppercase acronym collisions that are correctly excluded. The `may` row deliberately exposes both `may` and `May` source evidence because NGSL merged those case variants.
4. Export legacy raw candidates without changing dictionary content when database comparison is needed:

   ```sh
   npm run curation:queue -- --words data/learner-core/candidate-words.txt --output reports/learner-curation-queue.csv
   ```

5. Copy `curation-template.json` to a dated review batch only after selecting an intended OEWN sense for review. Use one JSON row per exact sense. A `sense_key` must remain stable across later edits. The OEWN candidate JSON is not valid curation input because it intentionally contains no Vietnamese or approval metadata.
6. Validate JSON without opening PostgreSQL:

   ```sh
   npm run curation:validate -- --file data/learner-core/batch-YYYY-MM-DD.json
   ```

   Export a spreadsheet-friendly worksheet with blank semantic, translation, example, CEFR, pronunciation, and reviewer-decision columns when the batch is ready for review:

   ```sh
   npm run curation:review -- --file data/learner-core/batch-YYYY-MM-DD.json --output data/learner-core/batch-YYYY-MM-DD-review.csv
   ```

7. Match all headwords against PostgreSQL without writing:

   ```sh
   npm run curation:import -- --file data/learner-core/batch-YYYY-MM-DD.json --dry-run
   ```

8. After a bilingual reviewer approves the exact sense, set the sense to `published`, the Vietnamese translation and at least one example to `approved`, and record reviewer names plus timestamps at each review boundary. Then import deliberately:

   ```sh
   npm run curation:import -- --file data/learner-core/batch-YYYY-MM-DD.json --write
   npm run curation:stats
   ```

9. Treat any non-zero `published_missing_*` statistic as a release blocker. Test the API response after cache invalidation.

## Current 10-word pilot

`pilot-ngsl-10-draft-2026-07-20.json` contains 31 AI-assisted draft senses for `be`, `have`, `do`, `say`, `go`, `time`, `people`, `year`, `way`, and `day`. Every row is bound to an exact sense in the locked OEWN first-100 artifact, carries OEWN 2025 version/checksum provenance, uses NGSL 1.2 rank metadata, and includes an original draft Vietnamese meaning and bilingual example.

`pilot-ngsl-10-review-worksheet.csv` is the generated human-review table. Its semantic, translation, example, reviewer, timestamp, and notes columns are intentionally blank. The JSON remains entirely `draft`: it contains no CEFR, pronunciation approval, reviewer identity, review timestamp, approved translation, or published sense.

`pilot-pronunciation-review-worksheet.csv` records the unapproved GB/US IPA evidence that OEWN actually supplies for six pilot words. Missing accents and words stay missing rather than being inferred. Pronunciation decisions, reviewer names, and timestamps are blank.

## Current follow-up drafts

`study-draft-2026-07-21.json` contains eight common verb and noun senses selected from exact OEWN `study` sense IDs. `study-review-worksheet.csv` is its human review sheet. The draft deliberately excludes rarer room, artwork, music, person, mental-absorption, and field-of-knowledge senses from this first learner pass; exclusion is a priority decision, not a claim that those meanings do not exist.

`dsd-grammar-functions-1.0.0.json` is the exact project-owned English definition source for eight grammar functions that OEWN does not model: continuous/passive `be`, perfect/obligation `have`, and question/negative/emphatic/substitute `do`. Its curation batch is `grammar-functions-draft-2026-07-21.json`, and its blank decision sheet is `grammar-functions-review-worksheet.csv`. The definitions are independently worded and reference Cambridge Grammar pages for fact checking; Cambridge text is not copied into the dataset.

All three batches have passed DB-free validation and PostgreSQL `--dry-run`. They remain drafts. Do not combine the lexical pilot and grammar batch into a `--write` import until the reviewer has resolved sense-order decisions and completed the required approval metadata.

CEFR columns in each generated worksheet stay blank unless the reviewer can cite a redistributable, versioned, sense-level source and record the evidence basis. English Vocabulary Profile is useful for manual comparison, but access to its searchable resource is not permission to scrape or redistribute its level data. NGSL rank must never be converted into CEFR.

## Review checklist for each sense

- The stable sense key identifies the same part of speech and meaning as the English definition.
- The English definition is short, grammatical, learner-friendly, and contains no source markup.
- The Vietnamese is a natural meaning for this exact sense, not a translation of another sense and not Chinese text.
- Each example demonstrates only this sense and has a natural Vietnamese translation.
- CEFR is attached to the exact sense, records its source, version, license, confidence, and evidence basis, and has been reviewed rather than inferred from frequency rank.
- Pronunciation accent and IPA were checked against the cited source.
- Every reused source has a license compatible with storage and redistribution; reference-only sources were not copied.
