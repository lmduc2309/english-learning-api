# DSD Commercial Release Checklist

Gate F. Nothing in this list is advisory; the Task 17 release audit must print
`GO` and every signature must exist before a release channel changes state.

## Channel states

| State | Meaning |
| --- | --- |
| `off` | DSD serves nothing |
| `internal` | DSD serves to internal builds only — the pilot lives here |
| `public` | DSD serves paying customers |

`public` cannot activate before the 5,000-entry v1 passes every gate. **A pilot
is never a public dictionary** (product decision, 2026-08-02). The 500-headword
package is a release *drill*: it exercises the machinery, and its artifact is
not shippable.

---

## 1. Content completeness

- [ ] Every published entry has at least one approved sense.
- [ ] Every published sense has an approved Vietnamese translation.
- [ ] Every published sense has at least one approved bilingual example.
- [ ] Every released entry has approved en-US IPA.
- [ ] Every released entry has approved audio from **both** approved voices.
- [ ] Incomplete entries are non-serving rather than partially served.

## 2. Authorship and review

- [ ] Every publishable record has `authored_by` and `reviewed_by`, and they
      differ.
- [ ] Both IDs resolve to active entries in the contributor registry.
- [ ] Every contributor has executed IP-assignment evidence.
- [ ] Every batch has a signed clean-room declaration.
- [ ] No approval is attached to a stale content hash.

## 3. Source and tool compliance

- [ ] The release audit reports zero unknown, blocked, non-commercial,
      share-alike, legacy, or unreviewed sources.
- [ ] Every tool that touched released content is registry-pinned by revision.
- [ ] No OEWN, NGSL, Wiktionary, `tudien`, Amy, Ryan, Lessac, or legacy content
      is present in serving or exported data.

## 4. Rights

- [ ] All seven `RIGHTS-MATRIX.md` columns are answered for every released
      asset, for the intended territory.
- [ ] Voice and personality rights have counsel approval for each release
      territory, or the voices have been replaced under explicit speaker
      contract.
- [ ] The release-territory list is current and signed.
- [ ] No part of the TTS stack is bundled into any customer-distributed client.

## 5. Similarity clearance

- [ ] Zero unresolved `rewrite_required` results.
- [ ] Every `manual_review` has a hash-bound, reasoned, recorded decision.
- [ ] The Task 8A similarity policy is frozen, and its version is recorded in
      the release manifest.

## 6. Technical

- [ ] Release audit prints `GO`.
- [ ] Export is deterministic: two builds from the same inputs produce identical
      checksums.
- [ ] Export did not overwrite an existing directory.
- [ ] Commercial-safe dictionary tests pass with every legacy repository
      configured to throw on access.
- [ ] A restore of `dsd_corpus_db` has been proven within the current rehearsal
      window, with matching row counts and ordered digests.
- [ ] `npm audit --omit=dev` reports zero high and zero critical.

## 7. Signatures

- [ ] Product owner
- [ ] Legal reviewer — sources, rights matrix, territories
- [ ] Linguistic reviewer — content quality
- [ ] Data/platform owner — backup, restore, reproducibility

Each recorded as an evidence ID against the release build.

---

## Rule

**Do not weaken a gate to make a date.** If a gate cannot be met, the release
does not happen. Every item here exists because failing it creates an exposure
that surfaces after launch, when it is most expensive and least reversible —
and several of them are the specific reasons the legacy corpus cannot be sold
at all.
