# Audio storage policies

Three roles, each holding only what its job needs. The capabilities are asserted
by `scripts/dsd/audio-storage-permissions.spec.ts` against a live store, so the
matrix below is measured rather than described.

| | put | get | list | delete | bucket policy | lifecycle |
|---|---|---|---|---|---|---|
| generator | yes | yes | yes | **no** | **no** | **no** |
| api | **no** | yes | **no** | **no** | **no** | **no** |
| operator | **no** | yes | yes | **no** | **no** | **no** |

Three absences carry most of the weight.

**The API cannot list.** It fetches an exact key it was given by the database and
nothing else. Without listing it has no way to discover an object, so it can
never build a response from an unreviewed or rejected recording — the
restriction is structural rather than a rule in the serving code.

**Nothing can delete.** Not the generator, not the operator, not the API.
Content-addressed keys are never rewritten and superseded audio is quarantined
rather than removed, so no application role needs deletion. Retiring an object is
a deliberate administrative act by a human with separate credentials.

**Nothing can set a bucket policy or a lifecycle rule.** A lifecycle rule is the
quiet way audio disappears months later, and a bucket policy is the quiet way it
becomes public. Neither is reachable from an application credential.

`${DSD_AUDIO_BUCKET}` is substituted by `provision-audio-storage.sh`.
