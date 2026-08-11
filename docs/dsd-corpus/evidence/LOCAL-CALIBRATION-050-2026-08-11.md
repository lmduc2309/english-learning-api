# DSD local-model calibration — 50 entries — 2026-08-11

Status: owner approved the original 50-entry content sample on 2026-08-11, but W1 remains blocked. Subsequent package validation exposed usage-label and lemma-contract defects, and the adapter seed strategy did not match the hash-derived sampling policy. Evidence ID: `EV-DSD-LOCAL-CALIBRATION-050-20260811` records the run and owner decision; it is not a W1 go certificate.

This calibration used the independently prepared `dsd-pilot-050.csv` inventory and the locked local MLX models. It did not read or write the legacy or production databases. No result was approved or published.

## Reconciled outcome

- English authoring: 50/50 schema- and provenance-valid.
- Critic revision 2: 49 pass, 1 repair, 0 quarantine.
- Repair revision 1: 1/1 passed a fresh isolated critic request.
- Final selected English revisions: 50 pass, 0 repair, 0 quarantine.
- TranslateGemma: 100/100 fields completed and schema-valid.
- Deterministic Vietnamese checks: 100 pass, 0 empty, 0 source-copy, 0 CJK contamination, 0 ASCII-only.
- Complete local draft entries: 50/50.

The first critic run exposed non-canonical synonymous reason codes. Its history was retained locally and not rewritten. The critic prompt and protocol were then tightened to an enumerated vocabulary, producing new prompt hashes and request IDs before revision 2 was run.

## Aggregate measurements

| Stage | Requests | Summed inference time | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| English base | 50 | 292,663 ms | 12,895 | 3,555 |
| Critic revision 2 | 50 | 54,370 ms | 15,193 | 767 |
| English repair | 1 | 6,742 ms | 307 | 68 |
| Repair critic | 1 | 1,501 ms | 300 | 15 |
| Final Vietnamese fields | 100 | 146,487 ms | 8,715 | 1,651 |

These are summed per-request model timings from one local run, not yet a capacity commitment. Peak memory, thermals, energy, duplicate/style-template analysis, deterministic rerun comparison, and owner semantic sampling remain required by Task L12 before W1.

## Hash-bound local spools

| Artifact | SHA-256 |
| --- | --- |
| English base requests | `af76ba181a766e140c8609e8baa955ad1eac35c153d98e2ca1b0776916c8f872` |
| English base results | `a794b2e9c0cfbc0e14a1f52ce79c9f695ab8d6ccfcb06449545970dc0b3de788` |
| Critic revision 2 requests | `3396aedfe68fcfdce72baa27a7c35fbd3f247a284a5fdf77c6ce36bc8886a7ab` |
| Critic revision 2 results | `b36f526f6513355a17c004d77de9f263987f85aaff7ad4e587c2c06f5b37b8d5` |
| English repair requests | `c42146aa634244e74f1a6f2fd04175b0eafc6d0212558930bfc6b8b0160d93eb` |
| English repair results | `31ae3dddde6dfddb6e04d47ec54cd89b2e488c70d5e8c600c6d7554aec67f5ce` |
| Repair critic requests | `7c1e508da597cd7b4335974690640dbd22515e4a82ed6fdd226b240ca1eff463` |
| Repair critic results | `4059a94aef26ee58106f52d77182dcf27c407bf1eff8990367173cc3c616d2c7` |
| Final translation requests | `abb34839a98b3a4eb9200ac1ad62ca05ba566573f50a729511e4b0852a43c552` |
| Final translation results | `d768cf2ad72f21f11b50c5bc0d7c9ae84eee9abb6908c8827e4098d6371377c5` |

The raw spools currently remain offline under `/private/tmp/dsd-local-cal-50`. Their hashes above are evidence identifiers, but Task L12 is not complete until an immutable durable evidence bundle is created and verified.

## Superseding findings after package validation

The earlier 50/50 machine summary covered protocol/schema checks then implemented; it did not prove compatibility with the downstream curation quality gate. Continuing Task L13 exposed:

- free-form usage labels rejected by the corpus allowlist;
- examples using undeclared irregular inflections rejected as `lemma_missing`;
- retry seeds derived from batch position instead of the policy-required entry/content hashes;
- two repeatedly rejected entries (`give`, `send`) and one later repair candidate (`choose`) that must not be forced through by repeated sampling.

The pipeline and its generated source were returned to `candidate` status. No W0 output was imported. A new W0 run using hash-derived seeds, the tightened label/lemma contract, bounded repair attempts, selection manifests, and full package validation is required before W1.

## Hash-seed W0 rerun

The replacement W0 run used entry/content-derived seeds and an empty usage-label contract. Results:

- 50 independently selected inventory entries attempted;
- 26 schema-invalid first attempts repaired as new revisions; 24 retained unchanged;
- final selected English set: 48 critic pass, 2 repair, 0 forced acceptance;
- 96/96 selected Vietnamese fields completed and protocol-valid;
- a 48-entry draft curation package assembled successfully;
- downstream curation validation reported no content-quality findings. Its 145 errors were exactly the expected closed registry gate: one unapproved pipeline tool plus three unapproved source scopes for each of 48 entries.

W0 is still incomplete because it requires 50 accepted entries. The two repair slots must be filled from independent reserve candidates and run through the complete pipeline. Tool/source status remains `candidate`, and production import remains prohibited.

## Reserve completion

A fresh foundation/general/verb/daily-life inventory request produced 10 candidates. Normalized comparison against the 50 pilot headwords removed six collisions. The four remaining candidates — `sleep`, `wash`, `chat`, and `run` — received stable DSD UUIDs and independently passed the dedicated Qwen3-8B inventory critic.

All four reserve entries then passed English schema validation and the isolated English critic. Their eight Vietnamese fields completed and validated, and the four-entry reserve curation package reported no content-quality findings. Its 13 findings were exactly the expected closed registry gate: one candidate pipeline tool plus three candidate source scopes per entry.

There are now 52 complete quality-valid drafts: 48 selected original entries and four reserves. W0 can reach exactly 50 by selecting two reserve UUIDs in release membership while leaving the other two inactive. Registry approval, durable evidence archival, owner review of the selected reserve content, and explicit W1 authorization remain outstanding. No production import occurred.
