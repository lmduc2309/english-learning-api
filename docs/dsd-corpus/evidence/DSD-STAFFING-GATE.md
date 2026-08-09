# DSD Staffing and Contributor-Rights Gate

## Decision

- Gate status: **BLOCKED / UNCOMMITTED**
- Assessment date: **2026-08-09**
- Eligible author count: **0**
- Eligible independent reviewer count: **0**
- Contributor registry: `data/dsd/contributor-registry.json`

The repository contains no active contributor backed by IP-assignment evidence.
No person has therefore been authorized to author or review publishable DSD
content. This is an explicit release block, not an administrative warning.

## Work allowed while blocked

- Tasks 1–18 engineering, tests, schemas, and fail-closed release tooling.
- Task 19 inventory preparation after the pilot measurement protocol is
  approved, because a bare headword inventory contains no publishable wording.
- Legal review, infrastructure provisioning, tool evaluation, and signing-key
  ceremony preparation.

## Work prohibited while blocked

- Task 20 publishable definitions, translations, or examples.
- Task 21 final IPA approval or audio listening approval.
- Task 22 pilot release drill claiming `GO`.
- Any public or commercial DSD release.
- Any workaround that assigns two contributor IDs to the same person for
  authorship and review of one record.

## Evidence required to change this decision

- [ ] Counsel-approved contributor agreement template: `<evidence-id>`
- [ ] At least one active author with executed assignment evidence.
- [ ] At least one different active reviewer with executed assignment evidence.
- [ ] Registry validation passes after both entries are added.
- [ ] Product owner confirms committed capacity for the 500-entry pilot.
- [ ] Legal reviewer confirms the agreements cover commercial licensing and
      resale of the resulting corpus in the intended territories.
- [ ] Pilot measurement protocol approved.

## Sign-off

These fields deliberately remain empty until real external approvals exist.

| Role | Evidence ID | Date |
| --- | --- | --- |
| Product owner | — | — |
| Legal reviewer | — | — |

The gate changes to `COMMITTED` only in a reviewed edit that supplies every
item above. A repository commit or verbal instruction alone is not rights
evidence.
