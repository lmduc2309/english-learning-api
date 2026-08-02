# Provenance and Licensing Rules

Last updated 2026-08-02.

These rules govern what may be published as learner content. They exist because
the legacy corpus demonstrates the failure mode: **100% of its 660,484
definitions and 343,220 examples carry no `source`, no `translation_method` and
no `translation_confidence`.** Per-row origin cannot be reconstructed, which is
why none of it can be cleared for public release even where the content is
fine.

A policy document alone did not prevent that. Where a rule can be enforced by a
database constraint, it is — see *Enforcement* below.

## The layers, and what each may claim

| Layer | Tables | May claim |
| --- | --- | --- |
| Legacy / reference | `words`, `definitions`, `examples`, `pronunciations` | Nothing. Reference-only, `is_learner_visible = false`, surfaced only as an explicitly labelled `raw_fallback`. |
| Learner overlay | `learner_entries`, `learner_senses`, `learner_sense_translations`, `learner_examples`, `learner_pronunciations` | Reviewed bilingual accuracy — but only once published, and publication has hard preconditions. |
| Generated | none (runtime only) | Nothing. Must surface as `generated_fallback`, never stored as learner content. |

`data_source` in API responses is `curated | raw_fallback | generated_fallback`
and must fail closed to `raw_fallback` whenever trust metadata is missing.

## Source licences

| Source | Licence | Obligation | Status |
| --- | --- | --- | --- |
| Open English WordNet 2025 | CC BY 4.0 | Attribution with a resolvable URL | Cleared for use. Version `2025-edition`, artifact SHA-256 pinned in `data/learner-core/oewn-source-lock.json`. |
| NGSL 1.2 | CC BY-SA 4.0 | Attribution; share-alike on derivatives | Cleared for use as *ranking*, not as content. Locked in `ngsl-source-lock.json`. |
| Wiktionary (English side of the legacy corpus) | CC BY-SA 3.0 / GFDL | Attribution and share-alike | Attribution not currently recorded per row. **Needs verified attribution before public release.** |
| `tudien` archive (legacy Vietnamese) | **None established** | Unknown | **Blocked.** Aggregates third-party dictionaries with no reusable grant. Reference-only pending permission or legal clearance. Never publish. |
| Machine translation output | n/a | n/a | A review hint only. Never a source, never publishable as curated. |

An unverified UI label does not grant redistribution rights.

## Rules for publishing a learner sense

A sense may move to `status = 'published'` only when all of the following hold.
Every one is enforced in the database.

1. `definition_source`, `definition_source_license` — non-empty.
2. `definition_source_url` — non-empty and resolvable.
3. `definition_source_version` and `definition_source_artifact_sha256` — the
   version string and 64-hex digest of the exact artifact the definition came
   from. For OEWN this must match the pinned `2025-edition` checksum.
4. `reviewed_by` and `reviewed_at` — a named human, with a timestamp.
5. **An approved Vietnamese translation exists**: a `learner_sense_translations`
   row with `locale = 'vi'` and `review_status = 'approved'`, itself carrying
   `reviewed_by` and `reviewed_at`.

CEFR is optional, but if `cefr_level` is set then `cefr_source`,
`cefr_source_url`, `cefr_source_version`, `cefr_source_license` and
`cefr_basis` are all required. NGSL rank is *learning priority*, never CEFR.

Examples and pronunciations carry independent review gates: `review_status`
must reach `approved` on its own evidence, and approval requires reviewer
metadata.

## Rules that cannot be relaxed

- **Never manufacture reviewer metadata.** A generated CEFR label or
  translation is a review hint. Writing a name into `reviewed_by` to satisfy a
  constraint defeats the entire mechanism.
- **Never infer CEFR from frequency.** They measure different things.
- **Never publish Vietnamese by part-of-speech plus array position.** The
  legacy corpus contains 891 example groups where one English sentence carries
  multiple unrelated Vietnamese translations, which is exactly what positional
  matching produces. See `cleanup_review_example_vi_conflicts`.
- **Never make a legacy row learner-visible.** The trust boundary between
  reference and reviewed content is the product.
- Cambridge/English Profile and Oxford learner lists are reference benchmarks
  for fact-checking, not sources to scrape or bundle.

## Third-party data transfer

Sending corpus text to an external API is a publication event. Before any run:

- Only English leaves the machine. `scripts/ai-translate/prompts.ts` transmits
  `{id, word, pos, en}` for definitions and `{id, word, en}` for examples. The
  unlicensed `tudien` Vietnamese is never sent — the model is asked to produce
  Vietnamese, not shown the existing text.
- Record the model and its data policy here before use. Free-tier routes
  typically permit prompt retention and training; that is acceptable for
  public Wiktionary English and not acceptable for anything else.
- Each run needs explicit approval from the data owner.

**Model in use for re-translation:** _not yet set — record it here when Phase C
begins, together with its price and data-retention policy._

## Enforcement

Rules 1–4 above are `CHECK` constraints on `learner_senses`
(`CHK_learner_sense_source`, `CHK_learner_sense_license`,
`CHK_learner_sense_published_source_url`,
`CHK_learner_sense_published_definition_provenance`,
`CHK_learner_sense_published_review`).

Rule 5 spans two tables, which a `CHECK` cannot express, so it is a deferrable
constraint trigger —
`TRG_learner_sense_publish_requires_approved_translation` — evaluated at
`COMMIT` so a transaction may insert the sense and its translation in either
order.

What is deliberately *not* enforced: draft rows are unconstrained beyond basic
non-emptiness, so curation can proceed freely. The gate is publication, not
authorship.

## Known open item

Legacy provenance backfill remains deferred by decision. The constraints above
govern new published rows; they do not invent history for the 660,484 legacy
definitions, and no mechanism exists to recover it.
