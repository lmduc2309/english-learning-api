# DSD local-model terms and selection evidence — 2026-08-11

## Decision

The DSD owner selected a local three-model architecture on 2026-08-11:

- Qwen3-14B for independent candidate inventory and original English content;
- Qwen3-8B as a context-isolated candidate/English critic;
- TranslateGemma-12B-IT for English-to-Vietnamese field translation only.

No model receives legacy headwords or expressive legacy content. The active
path uses no OpenAI/OpenRouter endpoint or fallback.

## Qwen evidence

Both Qwen models identify their license as Apache-2.0 in their official model
metadata and repositories. Production provisioning is restricted to these
official repositories and exact revisions:

- `Qwen/Qwen3-14B@40c069824f4251a91eefaf281ebe4c544efd3e18`
- `Qwen/Qwen3-8B@b968826d9c46dd6066d109eabc6255188de91218`

Evidence IDs:

- `EV-QWEN3-14B-APACHE-2.0-20260811`
- `EV-QWEN3-8B-APACHE-2.0-20260811`

## TranslateGemma evidence and calibration gate

Official model:
`google/translategemma-12b-it@d1b225e1caa17f1ddc7e62065d8637d0923f34e2`.

The repository is gated and identifies its license as Gemma. This is not MIT
or Apache-2.0. The owner selected it as a deliberate custom-license exception.
On 2026-08-11 the owner confirmed acceptance, authenticated through the
official Hugging Face CLI, and the locked official revision was downloaded,
locally quantized, hash-manifested and verified. No account identity or token
is stored in Git.

Terms evidence is locked in
`data/dsd/tools/translategemma-terms.lock.json`. Production translation remains
blocked until the remaining calibration gates pass:

1. structured official chat-template integration passes automated tests;
2. the 50-entry translation calibration passes Vietnamese quality thresholds;
3. the owner approves the exact hash-bound calibration output.

Evidence ID reserved for the completed record:
`EV-TRANSLATEGEMMA-GEMMA-TERMS-20260811`.

This document records a technical/product decision, not legal advice.
