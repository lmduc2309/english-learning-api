# DSD Authoring Policy

Binding on every human or AI origin actor and every reviewer of DSD content.

## The clean-room boundary

DSD's commercial position rests on its content being newly generated from blank
prompts without legacy or blocked dictionary wording. DSD no longer claims that
all textual content was written by a human. AI-generated records are labelled as
such and require a human owner to approve the exact content hash.

### You may use

- Blank DSD templates.
- Your own knowledge of English and Vietnamese.
- Sources explicitly `approved` in `data/dsd/source-registry.json` for the scope
  you are authoring, and only for that scope.
- Approved generation tools from `data/dsd/tool-registry.json`. Their output is
  a draft until a human review decision approves the exact content hash.
- General reference works for *fact-checking* — confirming a spelling, checking
  whether a sense exists — provided you disclose them in the batch declaration
  and do not copy phrasing.

### You may not use

- The legacy dictionary, in any form: a database window, an export, a CSV, a
  screenshot, a search result, or a colleague's recollection of it.
- OEWN, NGSL, Wiktionary, the `tudien` archive, or any source marked `blocked`.
- Another bilingual dictionary's phrasing, whether copied or paraphrased.
- Any prompt containing legacy/blocked dictionary text, even if the model is
  asked to paraphrase, translate or improve it.
- AI output whose provider, tool revision, prompt-policy ID, run date, origin
  actor, terms evidence and output hash are not recorded.
- Anything in your clipboard from any of the above.

**Paraphrasing a blocked source is still using it.** Rewording someone else's
definition produces a derivative work, not an original one. If you have read a
blocked definition for the word you are authoring, say so in the declaration and
let the compliance reviewer decide; do not attempt to launder it.

## Working method

1. Take a headword from the DSD-owned inventory.
2. Generate from a blank prompt containing only the headword, expected part of
   speech, product rationale and DSD writing rules. Never provide legacy text.
3. Produce a short learner definition, its natural Vietnamese rendering and a
   bilingual example that demonstrates the same sense.
4. Store the AI origin actor and batch-generation declaration; never attribute
   the wording to the human reviewer.
5. The human owner reads every record and approves or rejects the exact hash.
   The AI actor cannot approve its own output.

## Similarity results

The compliance audit compares your work against the legacy corpus and reports
one of three outcomes. It deliberately **does not show you the legacy wording**
— seeing it would compromise the independence of anything you author next.

| Result | What it means | What you do |
| --- | --- | --- |
| `clear` | No material overlap | Continue |
| `manual_review` | Enough overlap to check | Compliance reviewer decides; you may be asked how you arrived at it |
| `rewrite_required` | Overlap inconsistent with independent authorship | Re-author from scratch |

A `manual_review` result is not an accusation. Short definitions collide
because there are only so many ways to define a common word, and the legacy
corpus contains the obvious phrasing for almost everything. The process exists
to record the judgement, not to assign blame.

## If you have seen blocked content

Say so. There is a documented path: disclose it, the compliance reviewer records
it, and the affected headwords are either reassigned to another author or
subjected to a higher similarity bar.

Concealing it is the one failure this whole structure cannot recover from,
because it makes every downstream assurance false — including the ones given to
a purchaser.
