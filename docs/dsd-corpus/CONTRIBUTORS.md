# DSD Contributor Register

The machine-readable register is
`data/dsd/contributor-registry.json`. This document defines who may enter that
register and records the current staffing state without putting personal data
in Git.

## Current state

- Eligible authors: **0**
- Eligible independent reviewers: **0**
- Staffing gate: **BLOCKED / UNCOMMITTED**
- Consequence: inventory planning may continue after its measurement protocol
  is approved, but Tasks 20–22 and every commercial release remain blocked.

No identity is inferred from a Git author, system account, email address, or
application user. A contributor becomes eligible only through a reviewed
registry entry backed by executed external evidence.

## Required registry fields

| Field | Requirement |
| --- | --- |
| `id` | Stable pseudonym matching `DSD-<LETTER>-<sequence>` |
| `roles` | One or more roles accepted by the registry validator |
| `languages` | BCP-47-style language tags relevant to the assigned work |
| `engagementType` | `employee`, `contractor`, `agency`, or `volunteer` |
| `startDate` | Engagement start date as `YYYY-MM-DD` |
| `ipAssignmentEvidenceId` | Reference to the executed agreement in the external evidence store |
| `status` | `active` or `inactive` |

Names, email addresses, signatures, identity documents, payment details,
contract text, and the pseudonym-to-person mapping must remain outside Git.
The registry validator rejects known personal-data fields.

## Eligibility rules

An active author or reviewer must:

1. have a counsel-approved agreement satisfying
   `IP-ASSIGNMENT-CHECKLIST.md`;
2. have an external evidence ID recorded in the registry;
3. be assigned only work covered by their recorded role and languages; and
4. remain active on the date of authorship or review.

For every publishable record, `authored_by` and `reviewed_by` must resolve to
different active contributor IDs. One person may hold multiple roles, but may
not review their own record under another pseudonym.

## Activation procedure

1. Legal stores the executed agreement and issues its evidence ID.
2. The authorized registry maintainer allocates a pseudonymous contributor ID.
3. Add the required fields to `data/dsd/contributor-registry.json`.
4. Run `npm run dsd:registry:validate`.
5. Product and legal update and sign the staffing-gate evidence document.
6. Only then may the contributor ID appear in a publishable batch.
