#!/usr/bin/env python3
"""Verify every byte of one locally provisioned DSD MLX model artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[4]
DEFAULT_LOCK = ROOT / "data/dsd/models/local-model-lock.json"


def sha256_file(file: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--lock", type=pathlib.Path, default=DEFAULT_LOCK)
    args = parser.parse_args()
    home_raw = os.environ.get("DSD_LOCAL_MODEL_HOME", "").strip()
    if not home_raw:
        raise RuntimeError("DSD_LOCAL_MODEL_HOME is required")
    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    model = next((item for item in lock["models"] if item["id"] == args.model), None)
    if model is None:
        raise RuntimeError(f"model is not present in lock: {args.model}")
    target = pathlib.Path(home_raw).expanduser().resolve() / model["id"] / model["revision"] / "mlx-4bit"
    manifest_file = target / "dsd-artifact-manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    expected_header = {
        "model_id": model["id"], "repository": model["repository"],
        "revision": model["revision"], "license": model["license"],
        "terms_evidence_id": model["terms_evidence_id"],
    }
    for key, value in expected_header.items():
        if manifest.get(key) != value:
            raise RuntimeError(f"manifest {key} does not match model lock")
    source_files = manifest.get("source_files", [])
    if not source_files:
        raise RuntimeError("manifest has no official source-file evidence")
    for record in source_files:
        if not isinstance(record.get("bytes"), int) or record["bytes"] < 0:
            raise RuntimeError("manifest has malformed source-file size")
        digest = record.get("sha256", "")
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            raise RuntimeError("manifest has malformed source-file SHA-256")
    listed = set()
    for record in manifest.get("files", []):
        relative = pathlib.Path(record["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError(f"unsafe manifest path: {relative}")
        file = target / relative
        if not file.is_file() or file.stat().st_size != record["bytes"]:
            raise RuntimeError(f"missing or size-mismatched artifact: {relative}")
        if sha256_file(file) != record["sha256"]:
            raise RuntimeError(f"SHA-256 mismatch: {relative}")
        listed.add(str(relative))
    actual = {str(item.relative_to(target)) for item in target.rglob("*")
              if item.is_file() and item.name != manifest_file.name}
    if actual != listed:
        raise RuntimeError("artifact contains unlisted or missing files")
    print(f"verified {model['id']}: {len(listed)} files")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
