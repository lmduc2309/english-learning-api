# DSD local-model calibration — 50 entries — 2026-08-11

Status: machine gates passed; owner content sample and explicit W1 go decision pending.

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
