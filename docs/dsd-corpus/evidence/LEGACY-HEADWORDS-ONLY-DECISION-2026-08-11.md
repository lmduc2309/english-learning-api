# Legacy headword-only commercial lookup decision — 2026-08-11

## Product decision

The owner approved using the existing 475,153 normalized English headword
strings to provide a free dictionary lookup feature. Subscription revenue is
earned from learning features such as flashcards, not from licensing or
selling the legacy database.

This does not make the product non-commercial and does not erase source
license or database-right concerns. DSD therefore does not claim that the
inventory is independently selected, fully clean-room, or exclusively owned.

## Enforced boundary

The legacy database exposes a dedicated one-column view to a dedicated reader:

- permitted: `headword` string;
- prohibited: every legacy ID, POS, definition, translation, example, rank,
  ordering signal, relation, IPA, pronunciation, audio and source field.

The export normalizes and deduplicates strings, assigns fresh deterministic DSD
UUIDs, establishes a new normalized ordering, and records
`legacy_inventory_used: true`. Qwen infers POS and writes English definitions
and examples from scratch. TranslateGemma writes Vietnamese text from the new
English text. The isolated critic receives no legacy expressive content.

## Release representation

DSD may claim rights in its new expressive text, software and independently
created arrangement. It must not claim exclusive ownership of individual
English words or represent the headword inventory as independently authored.
The public API must not offer a bulk corpus dump. A commercial/database-right
review remains a release gate, especially for EU distribution.
