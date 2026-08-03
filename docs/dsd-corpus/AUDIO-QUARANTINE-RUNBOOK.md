# Audio quarantine runbook

For retiring audio and models produced by voices DSD does not approve.

## Why this exists

Old artifacts outlive the decision to stop using them. Amy and Ryan were the
default English voices for months. Their model files sat on disk after the
switch, and so did audio generated from them. Any of it could be picked up by a
cache, a fixture, or a hand-run script and reach a customer — which is exactly
the licensing exposure the voice change was meant to remove.

## Two rules

**It moves, it never deletes.** A quarantined file goes to a non-serving prefix
and stays there. Some of it is the record of what was generated with what, and a
tool that could destroy evidence during a licensing review is a tool nobody
should run. Reclaiming the disk is a separate, deliberate act by a person.

**It will not break a serving key without a replacement.** Quarantining audio
something is still serving turns a licensing problem into an outage. Those
artifacts are reported as `blocked_needs_replacement` until an approved
replacement exists.

## Classifications

| Classification | Meaning | Action |
|---|---|---|
| `approved` | the voice is in the TTS voice lock | `keep` |
| `blocked` | Amy or Ryan | `quarantine` |
| `unapproved` | a real voice, absent from the lock | `quarantine` |
| `unknown` | no voice identifiable from the name | `review` |

`unapproved` matters as much as `blocked`. A voice nobody wrote down has no
recorded provenance, which is the same problem in a less obvious form. The first
real run found Lessac and LibriTTS-R output in `out_piper/` that nobody had
decided about.

`unknown` never auto-quarantines. A WAV carries no voice metadata, and moving
something nobody can identify is how the only copy of an artifact disappears.

## Running it

```bash
# 1. Inventory. Writes a manifest, moves nothing.
npm run dsd:audio:quarantine

# 2. Read the manifest. Check the blocked_needs_replacement list is empty and
#    that nothing you care about is under 'review'.
cat data/dsd/audio/quarantine-<timestamp>.json

# 3. Move. Only entries whose action is 'quarantine'.
npm run dsd:audio:quarantine -- --write
```

Set `DSD_QUARANTINE_HMAC_KEY` to attribute the manifest. Without it the manifest
carries a content digest only, and the report says so rather than implying a
signature exists.

Scanned by default: `../tts-service/.piper-models`, `../tts-service/out_piper`,
`../tts-service/out`, and `./uploads`. Override with `--root`.

## If something is still being served

Regenerate before retiring. The order matters — reversing it causes an outage.

```bash
# 1. Generate the approved replacement.
npm run dsd:audio:generate -- --entry <uuid> --write

# 2. It arrives 'awaiting_review'. A human must listen and decide; nothing
#    downstream will serve it until they have.
npm run dsd:audio:review -- queue --batch <id> --output data/dsd/audio
npm run dsd:audio:review -- apply --file <decisions> --write

# 3. Confirm the replacement is servable.
npm run dsd:audio:audit

# 4. Now retire the old artifact.
npm run dsd:audio:quarantine -- --write
```

## Restoring from quarantine

Quarantined files keep their names under
`<original-directory>/quarantine/<timestamp>/`. A run is grouped under one
timestamp so it can be undone as a unit.

```bash
# What was moved, and when.
ls ../tts-service/.piper-models/quarantine/

# Restore one file.
mv ../tts-service/.piper-models/quarantine/20260803172937/en_US-amy-medium.onnx \
   ../tts-service/.piper-models/

# Confirm it is the file the manifest recorded.
shasum -a 256 ../tts-service/.piper-models/en_US-amy-medium.onnx
```

Compare that hash against the manifest entry. If they differ, the file changed
after quarantine and the manifest is the authority on what was moved.

Restoring a blocked voice does not make it usable. `install_piper.sh` will not
fetch it, the engine refuses it by name at startup, a database `CHECK` refuses
any asset generated with it, and the storage audit reports
`blocked_voice_asset`. Restoration is for inspection and evidence, not for
serving.

## Reclaiming disk

Deliberately not automated. Quarantined artifacts are evidence during a
licensing review, and 121 MB of recovered disk is not worth a tool that can
destroy it.

Before deleting anything, confirm all three:

1. The licensing review that motivated the quarantine is closed.
2. The manifest is retained somewhere outside the directory being deleted.
3. No release package references the hashes being removed.

Then delete by hand, and record what was deleted and by whom.

## What the first real run found

Run on 2026-08-03 against the local development tree:

| | Count | Size |
|---|---|---|
| `keep` (approved) | 4 | 121.2 MB |
| `quarantine` | 12 | 121.6 MB |
| `review` (unidentifiable) | 20 | 5.6 MB |

The 12 quarantined were both Amy and Ryan model files and their configs, the
generated WAVs from both, and four files from Lessac and LibriTTS-R. The 20 under
review are Vietnamese VieNeu outputs whose filenames carry a speaker label but no
model identifier — they need a person, which is the correct outcome.
