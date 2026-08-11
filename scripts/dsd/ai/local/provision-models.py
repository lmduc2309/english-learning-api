#!/usr/bin/env python3
"""Plan or provision pinned official Hugging Face weights as local MLX 4-bit artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[4]
DEFAULT_LOCK = ROOT / "data/dsd/models/local-model-lock.json"


def sha256_file(file: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_model_home() -> pathlib.Path:
    raw = os.environ.get("DSD_LOCAL_MODEL_HOME", "").strip()
    if not raw:
        raise RuntimeError("DSD_LOCAL_MODEL_HOME must be an explicit absolute path outside the repository")
    home = pathlib.Path(raw).expanduser().resolve()
    if not home.is_absolute() or home == ROOT or ROOT in home.parents:
        raise RuntimeError("DSD_LOCAL_MODEL_HOME must be outside the repository")
    return home


def load_lock(file: pathlib.Path) -> dict[str, Any]:
    lock = json.loads(file.read_text(encoding="utf-8"))
    if lock.get("runtime", {}).get("engine") != "mlx-lm":
        raise RuntimeError("model lock does not select mlx-lm")
    if lock.get("runtime", {}).get("quantization_bits") != 4:
        raise RuntimeError("model lock does not select 4-bit quantization")
    return lock


def file_records(directory: pathlib.Path, excluded: set[str] | None = None) -> list[dict[str, Any]]:
    excluded = excluded or set()
    files = []
    for file in sorted(item for item in directory.rglob("*") if item.is_file()):
        relative = str(file.relative_to(directory))
        if relative in excluded:
            continue
        files.append({
            "path": relative,
            "bytes": file.stat().st_size,
            "sha256": sha256_file(file),
        })
    return files


def artifact_manifest(directory: pathlib.Path, source: pathlib.Path,
                      model: dict[str, Any], lock: dict[str, Any]) -> dict[str, Any]:
    return {
        "manifest_version": 1,
        "model_id": model["id"],
        "repository": model["repository"],
        "revision": model["revision"],
        "license": model["license"],
        "terms_evidence_id": model["terms_evidence_id"],
        "engine": "mlx-lm",
        "quantization_bits": lock["runtime"]["quantization_bits"],
        "quantization_group_size": lock["runtime"]["quantization_group_size"],
        "source_files": file_records(source),
        "files": file_records(directory, {"dsd-artifact-manifest.json"}),
    }


def provision(model: dict[str, Any], lock: dict[str, Any], home: pathlib.Path) -> None:
    target = home / model["id"] / model["revision"] / "mlx-4bit"
    manifest_file = target / "dsd-artifact-manifest.json"
    if manifest_file.exists():
        subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("verify-models.py")),
                        "--model", model["id"]], check=True)
        print(f"already verified: {target}")
        return

    home.mkdir(parents=True, exist_ok=True)
    temp_parent = pathlib.Path(tempfile.mkdtemp(prefix=f".{model['id']}.", dir=home))
    source = temp_parent / "official-source"
    output = temp_parent / "mlx-4bit"
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=model["repository"],
            revision=model["revision"],
            local_dir=source,
            token=os.environ.get("HF_TOKEN") or None,
        )
        command = [
            sys.executable, "-m", "mlx_lm", "convert",
            "--hf-path", str(source),
            "--mlx-path", str(output),
            "--quantize",
            "--q-bits", str(lock["runtime"]["quantization_bits"]),
            "--q-group-size", str(lock["runtime"]["quantization_group_size"]),
        ]
        env = os.environ.copy()
        env.pop("OPENAI_API_KEY", None)
        env.pop("OPENROUTER_API_KEY", None)
        env.pop("LLM_API_KEY", None)
        subprocess.run(command, check=True, env=env)
        manifest = artifact_manifest(output, source, model, lock)
        manifest_file_in_temp = output / "dsd-artifact-manifest.json"
        manifest_file_in_temp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise RuntimeError(f"refusing to replace existing incomplete target: {target}")
        output.rename(target)
    finally:
        shutil.rmtree(temp_parent, ignore_errors=True)
    print(f"provisioned: {target}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["plan", "apply"])
    parser.add_argument("--model", required=True)
    parser.add_argument("--lock", type=pathlib.Path, default=DEFAULT_LOCK)
    args = parser.parse_args()
    lock = load_lock(args.lock)
    model = next((item for item in lock["models"] if item["id"] == args.model), None)
    if model is None:
        raise RuntimeError(f"model is not present in lock: {args.model}")
    home = require_model_home()
    target = home / model["id"] / model["revision"] / "mlx-4bit"
    print(json.dumps({
        "operation": args.operation,
        "model_id": model["id"],
        "repository": model["repository"],
        "revision": model["revision"],
        "gated": model["gated"],
        "target": str(target),
        "quantization_bits": 4,
        "community_quantized_artifact": False,
    }, indent=2))
    if args.operation == "apply":
        if model["gated"]:
            from huggingface_hub import get_token
            if not (os.environ.get("HF_TOKEN", "").strip() or get_token()):
                raise RuntimeError(
                    "Hugging Face authentication is required for this gated official model; "
                    "use `hf auth login` or set HF_TOKEN"
                )
        provision(model, lock, home)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
