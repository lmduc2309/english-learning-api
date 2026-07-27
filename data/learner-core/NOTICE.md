# Third-party data notice

## New General Service List 1.2

The candidate vocabulary data derived by this project includes the New General Service List (NGSL) 1.2 and its supplementary words.

Attribution requested by the official project:

> New General Service List by Browne, C., Culligan, B., and Phillips, J.

The NGSL is licensed under the [Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/). The official source and recommended citation are available at <https://www.newgeneralservicelist.com/new-general-service-list>.

This project's derived `ngsl-candidates.csv` and `candidate-words.txt` change the representation by normalizing headwords to Unicode NFC, trimming whitespace, lowercasing with the English locale, case-insensitively deduplicating curation headwords, ordering the ranked core by SFI rank, appending supplement-only words in source order, and representing the supplement's rank `0` as `null` in the ingestion model. Original source casing and merged provenance remain auditable in the ranked CSV, immutable raw files, and lock manifest. Redistributions of the derived data must retain attribution and comply with the same CC BY-SA 4.0 terms.

## Open English WordNet 2025

The English sense evidence in `oewn-ngsl-first-100-candidates.json` and the two OEWN review tables is derived from **Open English WordNet 2025**, © 2019–present The Open English WordNet Team, licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) and derived from Princeton WordNet under the WordNet License.

The project retains exact copies of the upstream [OEWN license](./licenses/oewn-2025/LICENSE.md) and [Princeton WordNet database license](./licenses/oewn-2025/WNDB_License.txt). The accepted release, artifact checksum, schema, source counts, and derived file hashes are recorded in `oewn-source-lock.json`.

This project changes representation by selecting the first 100 NGSL priority rows, matching OEWN lemmas case-sensitively against the original NGSL source spellings, normalizing extracted text to Unicode NFC and transport-safe whitespace, joining lexical entries to synsets, and exporting nested JSON plus CSV review tables. Case-fold-only entries are retained as diagnostics but not promoted to sense candidates. All OEWN sense order, definitions, examples, explicit forms, and pronunciations remain unreviewed source evidence; no Vietnamese, CEFR, learner sense order, or publication approval is derived from OEWN.

The combined review artifacts also contain NGSL-derived priority metadata. Any redistribution must retain both source attributions, both upstream license notices, the modification notice, and the applicable NGSL CC BY-SA 4.0 terms. Nothing in the artifacts implies endorsement by Princeton University or the Open English WordNet team.
