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

## TranslateGemma evidence and unresolved gate

Official model:
`google/translategemma-12b-it@d1b225e1caa17f1ddc7e62065d8637d0923f34e2`.

The repository is gated and identifies its license as Gemma. This is not MIT
or Apache-2.0. The owner selected it as a deliberate custom-license exception,
but production use remains blocked until all of the following exist:

1. the owner accepts the current Gemma Terms through the official account;
2. the accepted terms version/effective date and a retained evidence snapshot
   are recorded outside mutable web content;
3. gated official weights download successfully at the locked revision;
4. locally quantized artifact hashes and the 50-entry calibration are approved.

Evidence ID reserved for the completed record:
`EV-TRANSLATEGEMMA-GEMMA-TERMS-20260811`.

This document records a technical/product decision, not legal advice.
