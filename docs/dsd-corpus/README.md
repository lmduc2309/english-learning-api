# DSD Corpus

The DSD corpus is a newly generated English–Vietnamese learner dictionary built
without importing or adapting a third-party dictionary corpus. Textual v1 data
uses an explicit AI-generated, human-owner-approved provenance model.

It is **not** a cleanup of the legacy dictionary in `english_learning_db`. It
shares no rows, no identifiers, and no expressive content with it.

## Why a rebuild rather than a cleanup

The legacy corpus cannot be sold. Its Vietnamese comes from the `tudien`
archive, which states no reusable licence and aggregates third-party
dictionaries, and 100% of its rows carry no per-row provenance — so cleared and
uncleared content cannot be separated after the fact. Its English is
Wiktionary-derived and share-alike, which would propagate to any translation
made from it.

Re-translating does not help: a translation is a derivative of its source, so
obligations follow the English, not the translator.

## Why not OEWN

Open English WordNet 2025 is CC BY 4.0 and commercially usable, and this
project had already pinned and checksummed it. It is still excluded, by product
decision on 2026-08-02, because attribution propagates: every downstream
licensee of a DSD dataset would inherit the obligation, so DSD could not offer
clean terms to a buyer or partner. Attribution is cheap when you ship an app
and expensive when you license data.

The accepted cost is roughly double the authoring effort. That trade is
recorded in the implementation plan.

## The documents here

| File | Purpose |
| --- | --- |
| `AUTHORING-POLICY.md` | What an author may look at, and what they may not |
| `CLEAN-ROOM-DECLARATION.md` | The per-batch declaration every author signs |
| `REVIEW-RUBRIC.md` | What a reviewer checks, and what they may not rely on |
| `IP-ASSIGNMENT-CHECKLIST.md` | What must be executed before anyone authors |
| `RIGHTS-MATRIX.md` | The seven independent rights questions per asset |
| `COMMERCIAL-RELEASE-CHECKLIST.md` | The gates a release must pass |
| `OPERATIONS.md` | Database provisioning, backup, restore (Task 2A) |

## The registries

Machine-checked, in `data/dsd/`:

- `source-registry.json` — what content may be used, and for what scope
- `tool-registry.json` — what software may run, pinned by revision
- `contributor-registry.json` — who may author and review, pseudonymously

Validate with:

```bash
npx ts-node scripts/dsd/lib/registry.ts
```

Everything is blocked by default. A source is usable only when its `status` is
`approved` **and** the intended use appears in `approvedScopes`.

## Current state

`openai-dsd-generated-v1` is approved for definitions, Vietnamese translations
and examples under the recorded output-terms and DSD AI-policy evidence. Human
authored sources remain blocked. Generated output may not be unique and DSD
does not market it as exclusively copyrightable; commercial release still
depends on human approval, quality, similarity and all other release gates.

LJSpeech and Norman are selected technical candidates but remain blocked for
public release: public-domain training recordings clear copyright, not
performer, voice or personality rights. See `RIGHTS-MATRIX.md`.

The engineering boundary is implemented fail-closed: commercial requests use
only DSD serving views, signed releases record exact membership for every
record and audio asset, startup verifies the canonical manifest and Ed25519
signature, and release audit requires a current exact-version off-host restore
proof for both databases. This does **not** turn the current registries or
corpus into a commercial release. With blocked sources, no contributor-rights
evidence, no trusted release key, and no production restore proof, the correct
current result is `NO-GO`.
