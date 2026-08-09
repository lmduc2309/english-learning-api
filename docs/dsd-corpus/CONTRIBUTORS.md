# DSD Contributor Register

The machine-readable register is
`data/dsd/contributor-registry.json`. Despite its historical filename, it now
records both human contributors and explicitly typed AI workflow actors.

## Current state

- Active AI generators: **1** (`DSD-G-001`)
- Active human owner/reviewers: **1** (`DSD-O-001`)
- Content staffing model: **AI-GENERATED / HUMAN-OWNER-APPROVED**
- Content staffing gate: **COMMITTED 2026-08-09**

No identity is inferred from a Git author, system account, email address, or
application user. A contributor becomes eligible only through a reviewed
registry entry backed by executed external evidence.

## Required registry fields

| Field | Requirement |
| --- | --- |
| `id` | Stable pseudonym matching `DSD-<LETTER>-<sequence>` |
| `roles` | One or more roles accepted by the registry validator |
| `languages` | BCP-47-style language tags relevant to the assigned work |
| `actorType` | `human` or `ai` |
| `engagementType` | Human: `owner`, `employee`, `contractor`, `agency`, `volunteer`; AI: `automation` |
| `startDate` | Engagement start date as `YYYY-MM-DD` |
| `ipAssignmentEvidenceId` | Human rights/ownership evidence reference |
| `outputRightsEvidenceId` | AI provider output-terms evidence reference |
| `status` | `active` or `inactive` |

Names, email addresses, signatures, identity documents, payment details,
contract text, and the pseudonym-to-person mapping must remain outside Git.
The registry validator rejects known personal-data fields.

## Eligibility rules

An active human author or reviewer must:

1. have a counsel-approved agreement satisfying
   `IP-ASSIGNMENT-CHECKLIST.md`;
2. have an external evidence ID recorded in the registry;
3. be assigned only work covered by their recorded role and languages; and
4. remain active on the date of authorship or review.

An active AI actor must be typed `ai`, use `automation`, hold `generator`, carry
output-rights evidence, and hold no reviewer role.

For every publishable record, `authored_by` identifies the origin actor and
must differ from `reviewed_by`. AI-generated v1 rows use `DSD-G-001`; the human
owner uses `DSD-O-001` for review. This preserves truthful provenance without
pretending the owner wrote model output.

## Activation procedure

1. Record the applicable human ownership/assignment evidence or AI output-terms
   evidence and issue its evidence ID.
2. The authorized registry maintainer allocates a pseudonymous contributor ID.
3. Add the required fields to `data/dsd/contributor-registry.json`.
4. Run `npm run dsd:registry:validate`.
5. Product and legal update and sign the staffing-gate evidence document.
6. Only then may the contributor ID appear in a publishable batch.
