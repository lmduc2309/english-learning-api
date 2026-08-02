#!/usr/bin/env python3
"""Generate IPA candidates for DSD headwords.

Everything this produces is a suggestion. The published pronunciation is
written by one person and approved by another; nothing here can approve
anything, and the table it writes to has no status meaning approved.

The script refuses to run in three situations, and all three are the point:

  * A tool lock has no ``artifactSha256``. A pinned revision fixes what the
    code says; the artifact digest fixes what was executed. A candidate that
    cannot name the artifact behind it is not reproducible, and the database
    CHECK rejects it anyway.
  * A tool is not approved in the registry. Candidate status is not
    permission.
  * eSpeak is importable. Misaki falls back to eSpeak when its lexicon misses,
    and eSpeak's data has provenance DSD has not cleared. ``fallback=None``
    asks Misaki not to; refusing to run in an environment where eSpeak exists
    at all means a future default cannot quietly turn it back on.

USAGE:
    python3 scripts/dsd/ipa-candidates.py --batch B-001
    python3 scripts/dsd/ipa-candidates.py --batch B-001 --write
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import sys
import unicodedata

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL_LOCKS = {
    "misaki": REPO_ROOT / "data" / "dsd" / "tools" / "misaki.lock.json",
    "microsoft-phonetic-matching": REPO_ROOT / "data" / "dsd" / "tools" / "phonetic-matching.lock.json",
}
TOOL_REGISTRY = REPO_ROOT / "data" / "dsd" / "tool-registry.json"

# Never install or enable these in the candidate environment.
FORBIDDEN_MODULES = ("espeakng", "espeak", "phonemizer")

ACCENT = "en-US"


def headword_digest(headword: str) -> str:
    """Digest the exact input the tool was given, so a run is reproducible."""
    normalized = unicodedata.normalize("NFC", headword).strip().lower()
    return hashlib.sha256(f"dsd.ipa.input.v1 {normalized}".encode("utf-8")).hexdigest()


def load_lock(tool_id: str) -> dict:
    path = TOOL_LOCKS[tool_id]
    if not path.exists():
        raise SystemExit(f"No tool lock at {path.relative_to(REPO_ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


def approved_tools() -> set[str]:
    registry = json.loads(TOOL_REGISTRY.read_text(encoding="utf-8"))
    return {t["id"] for t in registry.get("tools", []) if t.get("status") == "approved"}


def check_environment() -> list[str]:
    """Reasons this environment must not generate candidates."""
    problems: list[str] = []

    for module in FORBIDDEN_MODULES:
        if importlib.util.find_spec(module) is not None:
            problems.append(
                f"{module} is importable; the candidate environment must not be able to "
                "reach an unapproved phonemiser even by fallback"
            )

    if os.environ.get("PHONEMIZER_ESPEAK_LIBRARY") or os.environ.get("ESPEAK_DATA_PATH"):
        problems.append("an eSpeak environment variable is set")

    approved = approved_tools()
    for tool_id in TOOL_LOCKS:
        lock = load_lock(tool_id)
        if not lock.get("artifactSha256"):
            problems.append(
                f"{tool_id} lock has no artifactSha256; pin the installed artifact before "
                "generating anything from it"
            )
        if tool_id not in approved:
            problems.append(
                f"{tool_id} is not approved in the tool registry; candidate status is not permission"
            )
    return problems


def generate(headwords: list[str], lock: dict) -> list[dict]:
    """Run Misaki offline over the headwords.

    Imported here rather than at module scope so the refusals above run first,
    in an environment where the package may not be installed at all.
    """
    from misaki import en  # type: ignore

    # fallback=None: when the lexicon misses, Misaki must say so rather than
    # reach for eSpeak. A missing candidate is a fact a reviewer can act on.
    g2p = en.G2P(trf=False, british=False, fallback=None)

    rows = []
    for headword in headwords:
        phonemes, _ = g2p(headword)
        if not phonemes:
            continue
        rows.append(
            {
                "headword": headword,
                "accent": ACCENT,
                "candidate_ipa": phonemes,
                "input_headword_hash": headword_digest(headword),
                "tool_id": lock["toolId"],
                "tool_revision": lock["revision"],
                "artifact_sha256": lock["artifactSha256"],
                "configuration": lock.get("configuration", {}),
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    problems = check_environment()
    if problems:
        print("Refusing to generate IPA candidates:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\nSee data/dsd/tools/*.lock.json and docs/dsd-corpus/RIGHTS-MATRIX.md.",
            file=sys.stderr,
        )
        return 1

    # Reached only once the locks are complete and the tools are approved.
    print(f"Environment checks passed for batch {args.batch}.", file=sys.stderr)
    rows = generate([], load_lock("misaki"))
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    if not args.write:
        print("\nDRY RUN — nothing written.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
