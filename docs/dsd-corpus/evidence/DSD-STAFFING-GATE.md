# DSD Staffing and Contributor-Rights Gate

## Decision

- Gate status: **COMMITTED — AI-GENERATED / HUMAN-OWNER-APPROVED**
- Assessment date: **2026-08-09**
- Active AI generator count: **1**
- Eligible human owner-reviewer count: **1**
- Contributor registry: `data/dsd/contributor-registry.json`

On 2026-08-09 the product owner replaced the human-authored/two-person model
with an AI-generated/human-owner-approved model. The AI actor `DSD-G-001`
originates drafts and cannot review. The human owner `DSD-O-001` reviews the
exact output hashes. The system does not claim that the owner authored the
text, that output is unique, or that AI output is exclusively copyrightable.

## Work allowed by this staffing decision

- Tasks 19–20 inventory, generation, validation and human review.
- Engineering, infrastructure, quality, similarity and release-drill work.

## Still prohibited

- Attribution of AI output to the human owner as human-authored work.
- AI approval or automatic bulk approval.
- Supplying legacy or blocked dictionary text to the generator.
- Public/commercial release until infrastructure, quality, similarity, IPA,
  audio-rights and release-signature gates separately pass.

## Evidence for this decision

- [x] OpenAI Services Agreement effective 2026-01-01:
      `EV-OPENAI-OUTPUT-TERMS-20260101`.
- [x] DSD AI content policy and owner instruction:
      `EV-DSD-AI-POLICY-20260809-001`.
- [x] AI generator and human owner-reviewer registry entries.
- [x] Registry validation passes.
- [ ] Record-by-record human review of generated pilot content.

## Sign-off

| Role | Evidence ID | Date |
| --- | --- | --- |
| Product owner | `EV-DSD-AI-POLICY-20260809-001` | 2026-08-09 |
| Provider output terms | `EV-OPENAI-OUTPUT-TERMS-20260101` | 2026-08-09 |

This is a product/process decision, not a legal opinion. Provider terms assign
OpenAI's interest in output to the customer to the extent permitted by law,
while warning that output may not be unique and remains the customer's
responsibility to evaluate.
