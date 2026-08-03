# DSD audio storage

Where generated pronunciation audio lives, who can touch it, and how it is
recovered when something goes wrong.

## The shape

One dedicated, versioned, encrypted prefix. Keys are content-addressed:

```
dsd/audio/<public-voice-id>/<audio-sha256>.<format>
```

The hash in the key is the hash of the bytes at that key. A database `CHECK`
enforces the same shape from the other side, so a key and its row cannot
disagree without a constraint violation.

Content addressing gives three things for free. The same audio can never be
stored twice. A rewrite is impossible without changing the key, so an overwrite
is always a detectable anomaly rather than a silent substitution. And verifying
an object needs nothing but the object: hash it and compare to its own name.

## Configuration

| Variable | Purpose |
|---|---|
| `DSD_AUDIO_S3_URI` | `s3://bucket/prefix` |
| `DSD_AUDIO_S3_REGION` | region |
| `DSD_AUDIO_KMS_KEY_ID` | KMS key for encryption at rest |
| `DSD_AUDIO_PUBLIC_BASE_URL` | https base the API/CDN serves through |
| `DSD_AUDIO_S3_ENDPOINT` | development only, for MinIO |

The audit refuses to run without the first four. A missing KMS key is not a
warning: an unencrypted prefix is a finding that fails the release gate.

## Who can do what

Measured against a live store by
`scripts/dsd/audio-storage-permissions.spec.ts`, not merely described here.

| | put | get | list | delete | bucket policy | lifecycle |
|---|---|---|---|---|---|---|
| generator | yes | yes | yes | **no** | **no** | **no** |
| api | **no** | yes | **no** | **no** | **no** | **no** |
| operator | **no** | yes | yes | **no** | **no** | **no** |

Three absences do most of the work.

**The API cannot list.** It fetches an exact key the database gave it. With no
listing it has no way to discover an object at all, so it cannot serve an
unreviewed, rejected or quarantined recording even if the serving code were
wrong. That is a structural guarantee rather than a rule someone has to remember.

**Nothing can delete.** Content-addressed keys are never rewritten and
superseded audio is quarantined rather than removed, so no application role has
a legitimate need. Retiring an object is a deliberate act by a human with
separate credentials.

**Nothing can set a bucket policy or lifecycle rule.** A lifecycle rule is how
audio quietly disappears months later; a bucket policy is how it quietly becomes
public. Neither is reachable from an application credential.

Provision with:

```
DSD_AUDIO_S3_BUCKET=dsd-audio zsh scripts/dsd/provision-audio-storage.sh plan
DSD_AUDIO_S3_BUCKET=dsd-audio zsh scripts/dsd/provision-audio-storage.sh apply
```

Against AWS the script prints the rendered policies rather than creating IAM
identities. Creating principals in a cloud account belongs to whoever owns that
account, not to a corpus tool.

## The audit

```
npm run dsd:audio:storage:audit
npm run dsd:audio:storage:audit -- --verify-bytes
```

It reconciles in both directions and reports. **It never deletes.** An
unexpected object may be the only surviving copy of something, and an audit that
can delete is an audit that can cause the incident it was written to find.

| Finding | Severity | Means |
|---|---|---|
| `missing_object` | critical once reviewable | a row exists, the bytes do not |
| `size_mismatch` | critical | metadata and bytes disagree |
| `key_hash_mismatch` | critical | the key names a different hash than the row |
| `byte_hash_mismatch` | critical | the bytes are not what they claim (`--verify-bytes` only) |
| `version_drift` | critical | a content-addressed key was rewritten |
| `blocked_voice_asset` | critical | generated with Amy or Ryan |
| `blocked_voice_prefix` | critical | an object under a blocked voice prefix |
| `unexpected_object` | critical | not a DSD audio key at all |
| `versioning_disabled` | critical | an overwrite would be unrecoverable |
| `encryption_disabled` | critical | no encryption at rest |
| `public_listing_enabled` | critical | anonymous listing is possible |
| `orphan_object` | warning | no row claims it; may still be wanted |

`--verify-bytes` downloads and re-hashes everything. It is the only check that
trusts nothing, and the only one that catches silent corruption — so it belongs
in the scheduled run, not just the fast one.

## Recovery

Three independent layers, in the order you would reach for them.

**Object versioning.** An overwrite or delete leaves the previous version in
place. Fastest path, and enough for an accident.

```
aws s3api list-object-versions --bucket <bucket> --prefix <key>
aws s3api get-object --bucket <bucket> --key <key> --version-id <id> restored.wav
shasum -a 256 restored.wav    # must equal the hash in the key
```

**The signed release package.** Task 18's package contains the canonical audio
bytes and is the independent recovery source — independent because it does not
live in the same bucket, so a bucket-level mistake cannot take both. Restoring
into an empty prefix:

```
# 1. verify the package signature and manifest first; a corrupt package is not
#    a recovery source.
npm run dsd:release:verify -- --package <path>

# 2. re-upload each object under its content-addressed key. The key comes from
#    the hash of the bytes, so a mismatched file cannot be uploaded to the right
#    place.
npm run dsd:audio:restore -- --package <path> --write

# 3. reconcile. A clean audit is the definition of a successful restore.
npm run dsd:audio:storage:audit -- --verify-bytes
```

**Regeneration.** The last resort, and only for audio whose logical asset key is
reproducible: same text, voice, engine, model and release runtime. It produces
bytes that should hash identically, and if they do not, that is a
`version_drift`-shaped finding about the stack rather than the storage. Note that
regenerated audio needs a fresh listening decision if the hash differs, because
the old decision was bound to the old bytes.

## What production must not depend on

**The local Docker `uploads` volume.** It is unbacked, unversioned, unencrypted
and host-local. It is fine for development and it is not a release dependency.
No public release may serve audio from it, and the audit's `unexpected_object`
rule will flag anything found outside the content-addressed prefix.

**A developer's MinIO.** Plain MinIO has no KMS, so `encryption_disabled` is
reported locally and that is correct — encryption at rest is not verifiable
there. It means the local store can never pass the release gate, which is the
intended outcome: release audio comes from the provisioned production prefix or
it does not exist.
