# DSD Authoring Policy

Binding on every author and reviewer of DSD content.

## The clean-room boundary

DSD's commercial position rests on its content being independently authored. If
that is not true, the OEWN exclusion bought nothing and the corpus inherits
whatever obligations attach to whatever was actually copied. This policy is what
makes the claim defensible.

### You may use

- Blank DSD templates.
- Your own knowledge of English and Vietnamese.
- Sources explicitly `approved` in `data/dsd/source-registry.json` for the scope
  you are authoring, and only for that scope.
- Approved tools from `data/dsd/tool-registry.json`, understanding that tool
  output is always a **candidate** and never publishable as authored.
- General reference works for *fact-checking* — confirming a spelling, checking
  whether a sense exists — provided you disclose them in the batch declaration
  and do not copy phrasing.

### You may not use

- The legacy dictionary, in any form: a database window, an export, a CSV, a
  screenshot, a search result, or a colleague's recollection of it.
- OEWN, NGSL, Wiktionary, the `tudien` archive, or any source marked `blocked`.
- Another bilingual dictionary's phrasing, whether copied or paraphrased.
- An LLM asked to produce a definition, translation, or example for publication.
  Machine output cannot satisfy a human authorship field, and pasting it in
  while recording yourself as author is falsifying the provenance ledger.
- Anything in your clipboard from any of the above.

**Paraphrasing a blocked source is still using it.** Rewording someone else's
definition produces a derivative work, not an original one. If you have read a
blocked definition for the word you are authoring, say so in the declaration and
let the compliance reviewer decide; do not attempt to launder it.

## Working method

1. Take a headword from the approved inventory.
2. Author from a blank template: definition, then Vietnamese, then a bilingual
   example that shows the sense in use.
3. Write for a learner. Short, concrete, and demonstrating the sense rather than
   restating it.
4. Submit the batch with a signed clean-room declaration.
5. A **different** person reviews. You cannot review your own work, and you
   cannot review under a second contributor ID.

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
