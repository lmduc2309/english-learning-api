# DSD Rights Matrix

Seven independent questions per asset. **A clear answer to one does not answer
any other.** This document exists because the most common licensing mistake is
treating "the training data is public domain" as though it settled everything.

| # | Question | Why it is separate |
| --- | --- | --- |
| 1 | **Corpus copyright** — who owns the text DSD publishes? | Authorship sits with the author until assigned. |
| 2 | **Software licence** — what governs the tools that produced it? | GPL, MIT and Apache impose different obligations on distribution, not on output. |
| 3 | **Model licence** — what governs the model artifact itself? | A model may be licensed differently from its training data. |
| 4 | **Training-recording copyright** — who owned the audio the model learned from? | Public domain here is common and is only column 4. |
| 5 | **Performer / voice / personality rights** — may DSD synthesize *this person's voice* commercially? | Distinct from copyright, survives it, and varies by territory. |
| 6 | **Release territory** — where is DSD selling? | Voice and personality rights are jurisdictional. |
| 7 | **Binary distribution** — is DSD shipping the software, or only its output? | Self-hosting is not distribution; bundling into a client is. |

---

## Why column 5 is the trap

A public-domain recording means the *recording's copyright* has expired or was
waived. It does not mean the speaker consented to having their voice cloned and
sold. Many jurisdictions recognise rights of publicity, personality or
performer's rights that are separate from copyright, that the speaker never
waived by the recording entering the public domain, and that in some territories
survive death and pass to an estate.

LJSpeech and Norman both have clean column 4 evidence — public-domain datasets,
trained from scratch, documented on their model cards. Column 5 is unanswered
for both, which is why both are `blocked` in the source registry despite being
the selected technical candidates.

**This is not a technicality.** Synthesizing an identifiable person's voice for
a commercial product, at scale, in territories where personality rights attach,
is the kind of exposure that does not show up until the product is successful.

---

## Per-asset status

### LJSpeech (`en_US-ljspeech-medium`)

| Column | Status |
| --- | --- |
| 1 Corpus copyright | n/a (audio, not text) |
| 2 Software licence | Piper / eSpeak NG — GPL in the phonemization path. Output not covered; distribution out of scope. |
| 3 Model licence | Per model card. Pin and snapshot at Task 11. |
| 4 Training-recording copyright | **Clear** — public-domain dataset, trained from scratch. |
| 5 Performer / voice rights | **UNRESOLVED** |
| 6 Release territory | **UNRESOLVED** — pending the territory list |
| 7 Binary distribution | **Not applicable** — server-side only, never bundled |

### Norman (`en_US-norman-medium`)

Identical position: column 4 clear (public-domain LibriVox, trained from
scratch), columns 5 and 6 unresolved.

### Amy — BLOCKED

Fine-tuned from Lessac. The upstream Blizzard agreement restricts the material
to research and excludes commercial TTS. Column 3 and 4 both fail. No territory
analysis needed.

### Ryan — BLOCKED

Model card records CC BY-NC-SA 4.0. Non-commercial, full stop.

---

## Resolution paths for columns 5 and 6

Two ways forward, to be decided at Gate D:

1. **Counsel approves the existing voices** for the specific intended
   territories and uses, with the analysis recorded as an evidence ID. Note that
   this approval is territory-bound: expanding to a new market reopens it.

2. **Replace the voices** with models trained from a speaker under explicit
   DSD contract, covering synthesis, commercial use, the intended territories,
   and transfer to a purchaser of the corpus. This costs more up front and
   removes the question permanently — which matters if the corpus is meant to be
   sold, since a buyer inherits the voice-rights problem along with the assets.

Option 2 is the more consistent choice with the reasoning that excluded OEWN: if
DSD is avoiding an attribution chain in order to offer clean terms, carrying an
unresolved voice-rights question achieves the opposite.

---

## Rule

An asset ships only when **all seven columns** are answered for the intended
release territory, with an evidence ID for each. The release audit (Task 17)
treats any unresolved column as a blocker.
