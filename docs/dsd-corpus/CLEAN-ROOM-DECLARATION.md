# Clean-Room Declaration

One declaration per authoring batch. Stored with the batch manifest and
referenced by evidence ID from `dsd_provenance_events`.

The declaration is the evidence that DSD's originality claim was made by a
named person at a specific time about specific content. Without it, the claim
rests on nobody in particular.

---

## Template

```yaml
declaration_id:      DSD-DECL-<YYYYMMDD>-<sequence>
batch_id:            <batch manifest id>
contributor_id:      DSD-A-<nnn>          # pseudonymous; never a name
role:                author | reviewer
headword_count:      <n>
content_hash:        <sha256 of the batch payload>
authored_between:    <ISO 8601 start> .. <ISO 8601 end>

# Every tool that touched this batch, from the tool registry.
tools_used:
  - id: <tool id>
    revision: <pinned revision>
    purpose: <what it was used for>

# Every reference consulted for fact-checking. Empty is a valid answer and is
# more credible than a long list.
research_consulted:
  - source: <what>
    purpose: <why>
    copied_phrasing: false

exposure_disclosure:
  seen_blocked_source_for_these_headwords: []   # list headwords, or leave empty
  details: ""

statements:
  - I authored this content from blank templates.
  - I did not view, copy, or paraphrase the legacy dictionary or any source
    marked blocked in data/dsd/source-registry.json.
  - I did not use machine output as authored content.
  - Every tool and reference I used is listed above.
  - I have disclosed any exposure to blocked content.
  - I hold or have assigned the rights in this content to DSD under evidence
    ID <EV-IP-nnn>.

signed_evidence_id:  EV-DECL-<nnn>        # signature lives in the contract store
signed_at:           <ISO 8601>
```

---

## Rules

**Sign per batch, not per project.** A declaration covers content you have
already written. A blanket declaration signed in advance asserts nothing about
work that does not yet exist.

**An empty `research_consulted` is normal.** Authoring a definition for a common
word from your own knowledge of the language is the expected case.

**`exposure_disclosure` is not a confession.** People encounter the legacy
corpus — it is in the same repository, and engineers demonstrate the product.
Recording it lets the compliance reviewer route those headwords appropriately.
An unrecorded exposure discovered later invalidates the batch and casts doubt
on every other batch by the same author.

**The signature is not stored here.** Only the evidence ID. Names, signatures
and executed agreements live in the contract store; the registry validator
rejects personal-data fields precisely so this boundary is enforced rather than
remembered.

**A batch with no valid declaration cannot be reviewed or published.** The
release audit treats a missing declaration as a blocker, not a warning.
