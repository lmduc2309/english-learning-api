# DSD similarity policy (v1)

## What this is for

DSD claims its corpus is independently authored. The similarity audit is the
evidence for that claim: it measures every DSD definition and English example
against the legacy corpus and records how close the nearest match came.

It is a compliance control, not a quality control. A high score does not mean
the writing is bad. It means nobody can yet say the writing is original, and
publication waits until someone can.

## What is compared, and what is not

| | Compared |
|---|---|
| DSD English definitions | yes |
| DSD English examples | yes |
| DSD Vietnamese translations | no |
| DSD Vietnamese examples | no |
| Legacy English | read through `dsd_compliance.english_similarity_input` |
| Legacy Vietnamese | never read |

The `tudien` Vietnamese has no licence. It is not compared, not digested, not
read. Vietnamese DSD content has no counterpart to be measured against, so
there is nothing for the audit to do there; its originality rests on the
clean-room declaration and the authorship record instead.

## What is stored

A result records that a comparison happened and how close it was:

- the DSD entity, its content hash, and the record type
- normalization, algorithm and policy versions, plus the policy digest
- the component scores
- the match class
- a sha256 digest of the matched legacy text

It does not record the matched wording or any legacy row identifier. The digest
proves a match without keeping it. `AddDsdSimilarityAudit` has no column that
could hold either, and its tests assert as much.

There is no free-text rationale column, which is a deliberate departure from
the original plan. The compliance reviewer writing a rationale has just been
reading legacy wording, and a text box in DSD is exactly where that wording
would end up. `decision_evidence_id` points at the compliance record instead.

## Metrics

All deterministic. No embeddings in v1: a verdict that cannot be reproduced
across model versions is not a verdict.

| Metric | Catches |
|---|---|
| exact normalized match | copies through casing, punctuation, markup and entity changes |
| token Jaccard | wholesale reuse of vocabulary |
| word 3-gram Jaccard | reuse of phrasing rather than words |
| character 4-gram Jaccard | reuse that survives small edits inside words |
| term-frequency cosine | reuse weighted by repetition |
| longest shared run + content words | a verbatim clause dropped into otherwise original writing |

The last one earns its place. A long verbatim clause barely moves Jaccard — it
is a small fraction of the vocabulary — but it is the clearest evidence of
copying there is. It is measured in content words rather than tokens, because
`a unit of measurement` and `there is a` are how English works, not what
somebody wrote. Without that correction the audit accuses ordinary writing:
during calibration it flagged two independently written definitions purely for
sharing `a unit of measurement`.

Normalization for comparison is deliberately more aggressive than the content
hash. Near-copies differ by casing, punctuation and markup, and a comparison
that treated `A person who teaches.` and `person who teaches` as different
would miss the copy it exists to find.

## Classification

One metric crossing its threshold is enough. A copy only has to be detectable
one way.

| Class | Meaning | Publication |
|---|---|---|
| `exact` | identical after normalization | blocked, always |
| `high` | crosses the high band | blocked until cleared |
| `medium` | crosses the medium band | blocked until cleared |
| `low` | crosses neither | permitted |

High and medium block identically. The difference is triage: high says look at
this first.

## Decisions

| Decision | Set by | Effect |
|---|---|---|
| `clear` | the measurement, for `low` only | publication permitted |
| `manual_review` | the measurement, for `high` and `medium` | blocked, awaiting a reviewer |
| `rewrite_required` | a compliance reviewer | blocked; the author rewrites |
| `independently_authored_cleared` | a compliance reviewer | publication permitted |

`independently_authored_cleared` is never available for an exact match in v1.
The remedy for an exact match is a rewrite, which produces new text, a new
content hash, and a new audit. The database refuses the combination outright.

A manual decision requires a named compliance reviewer, a timestamp, a reason
code and an evidence ID. A verdict nobody signed is not a clearance.

## Who sees what

| | Match class | Scores | Matched legacy wording |
|---|---|---|---|
| Author | as one of three words | no | no |
| Linguistic reviewer | as one of three words | no | no |
| Compliance reviewer | yes | yes | yes |

Authors see `clear`, `manual_review` or `rewrite_required` and nothing else.
An author who has been shown the matched wording can no longer testify that
their rewrite was reached independently, so the rewrite instruction is written
in DSD's own terms. A compliance reviewer who has seen the wording may clear or
reject the current hash but may not rewrite the record.

## How the thresholds were chosen

Each medium threshold sits one grid step above the strongest independent
control in the calibration set. Every metric is therefore as sensitive as it
can be without accusing writing that was demonstrably independent, and recall
against the near-copy controls is measured rather than fitted — which keeps the
thresholds describing the problem instead of the fixture set.

The obvious alternative, raising each threshold as far as the recall target
allows, was tried and rejected: it produces a degenerate policy where whichever
metric happens to carry recall is pushed to the floor and every other metric is
pushed to the ceiling, leaving one live signal.

High is the 25th percentile of near-copy scores, so the strongest three
quarters of matches surface first.

### Targets

| Target | Value | v1 result |
|---|---|---|
| exact controls classified `exact` | 100% | 100% |
| near-copy controls flagged | ≥ 95% | 100% |
| independent controls sent to manual review | ≤ 10% | 0% |

`dsd:similarity:calibrate` exits non-zero if any target is missed. When that
happens the answer is a better algorithm or a narrower supported record class.
It is never a lower target.

### The calibration set

`data/dsd/similarity/v1-calibration.jsonl` — 52 labelled pairs, entirely
synthetic. Positive controls cover identical text, casing, punctuation, markup,
entities, wiki templates, single-word swaps, small insertions and deletions,
reordered clauses, synonym swaps, tense and number changes, and a verbatim
clause embedded in different framing. Negative controls cover independent
writing that shares a headword, a formulaic opening, a common frame, a subject
area, or a short factual phrase English gives no way to avoid.

No real legacy text is committed here, and none ever will be. Legacy text is
read at calibration time only through the restricted view, and only its
aggregate effect on the manual-review rate leaves the process.

## Status: candidate, not frozen

**This policy is not approved and publication is blocked.** Two things are
outstanding.

**Approvals.** `approvers` is empty. The product owner, the linguistic reviewer
and the legal/compliance reviewer must be recorded before `validatePolicy`
passes. Until then `dsd:publish` reports the similarity gate as `not_run` and
refuses.

**Sampling against the real corpus.** The example band is anchored on eleven
negative controls. That is enough to demonstrate the method and not enough to
set a production threshold: several example thresholds land below the sanity
floor the calibration tool reports, and at corpus scale they would flood manual
review. Run

```
npm run dsd:similarity:calibrate -- --sample-legacy 2000
```

with `LEGACY_AUDIT_DATABASE_URL` set to the `dsd_similarity_reader` account
before freezing. The tool reports the resulting rates and retains no wording.

The floors are reported, never applied. Silently raising a calibrated threshold
would be the same quiet weakening the targets forbid, only in the other
direction.

## Changing the policy

A change creates a new immutable version. It never edits an existing one.

Because every stored result carries the policy digest, a new policy leaves no
result matching the current content-and-policy pair, and the publication gate
reads that absence as "nobody has checked this". Every affected approved or
published record must be re-audited before the next release.

The same applies in the other direction: change one character of cleared DSD
text and its content hash moves, the stored result no longer matches, and
publication fails until it is re-audited.
