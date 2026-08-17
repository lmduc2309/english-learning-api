#!/usr/bin/env python3
"""Deterministically rank DSD headwords by local-model language likelihood."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import pathlib
import re
import time
import fcntl
from collections import defaultdict
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[4]
MODEL_ID = "qwen3-8b-mlx-dsd-critic"
REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
PREFIX = "The common contemporary English word is"
WORD_RE = re.compile(r"^[a-z][a-z' -]{2,39}$")
SHORT_COMMON = {"a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "on", "or", "so", "to", "up", "us", "we"}


def eligible(word: str) -> bool:
    return bool(WORD_RE.fullmatch(word) or word in SHORT_COMMON)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def append_rows(file: pathlib.Path, rows: list[dict[str, Any]]) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical(row) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def existing_ids(file: pathlib.Path) -> set[str]:
    if not file.exists():
        return set()
    ids = set()
    for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
        try:
            ids.add(json.loads(line)["dsd_entry_id"])
        except Exception as error:
            raise RuntimeError(f"{file}:{number}: invalid score row") from error
    return ids


def score(args: argparse.Namespace) -> None:
    home = os.environ.get("DSD_LOCAL_MODEL_HOME", "").strip()
    if not home:
        raise RuntimeError("DSD_LOCAL_MODEL_HOME is required")
    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("OPENROUTER_API_KEY", None)
    from mlx_lm import load
    import mlx.core as mx

    args.output.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = (args.output.parent / "scores.lock").open("a+")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise RuntimeError("another ranking worker already owns this run") from error
    model_path = pathlib.Path(home).resolve() / MODEL_ID / REVISION / "mlx-4bit"
    model, tokenizer = load(str(model_path))
    prefix_ids = tokenizer.encode(PREFIX, add_special_tokens=False)
    completed = existing_ids(args.output)
    groups: dict[int, list[tuple[dict[str, str], list[int]]]] = defaultdict(list)
    with args.inventory.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = row["headword"]
            if row["dsd_entry_id"] in completed or not eligible(word):
                continue
            tokens = tokenizer.encode(" " + word, add_special_tokens=False)
            if 1 <= len(tokens) <= args.max_word_tokens:
                groups[len(tokens)].append((row, tokens))
    processed = 0
    for token_count in sorted(groups):
        values = groups[token_count]
        for offset in range(0, len(values), args.batch_size):
            batch = values[offset:offset + args.batch_size]
            inputs = mx.array([prefix_ids + tokens for _, tokens in batch])
            started = time.monotonic()
            logits = model(inputs)[:, len(prefix_ids) - 1:len(prefix_ids) + token_count - 1, :]
            targets = mx.array([tokens for _, tokens in batch])
            chosen = mx.take_along_axis(logits, targets[..., None], axis=-1).squeeze(-1)
            log_probs = chosen - mx.logsumexp(logits, axis=-1)
            totals = mx.sum(log_probs, axis=-1)
            mx.eval(totals)
            elapsed_ms = int((time.monotonic() - started) * 1000)
            rows = []
            for (source, tokens), total in zip(batch, totals.tolist()):
                rows.append({"version": 1, "dsd_entry_id": source["dsd_entry_id"], "headword": source["headword"],
                    "token_count": len(tokens), "log_probability": round(float(total), 6),
                    "model_id": MODEL_ID, "model_revision": REVISION, "prompt_sha256": sha256(PREFIX.encode()),
                    "batch_elapsed_ms": elapsed_ms})
            append_rows(args.output, rows)
            processed += len(rows)
            print(f"ranked {processed} new headwords; token_count={token_count}; batch={len(rows)}; {elapsed_ms}ms", flush=True)
            if args.limit and processed >= args.limit:
                return


def materialize(args: argparse.Namespace) -> None:
    source_rows: dict[str, dict[str, str]] = {}
    with args.inventory.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle); columns = reader.fieldnames
        if not columns:
            raise RuntimeError("inventory has no header")
        for row in reader:
            source_rows[row["dsd_entry_id"]] = row
    scores_by_id: dict[str, dict[str, Any]] = {}
    for line in args.scores.read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = json.loads(line)
            if eligible(item["headword"]):
                previous = scores_by_id.get(item["dsd_entry_id"])
                if previous is None or item["log_probability"] > previous["log_probability"]:
                    scores_by_id[item["dsd_entry_id"]] = item
    scores = list(scores_by_id.values())
    scores.sort(key=lambda row: (-row["log_probability"], row["token_count"], row["headword"], row["dsd_entry_id"]))
    selected = scores[:args.target]
    if len(selected) < args.target:
        raise RuntimeError(f"only {len(selected)} scored headwords; need {args.target}")
    if args.output.exists() or args.manifest.exists():
        raise RuntimeError("refusing to overwrite common inventory or manifest")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with args.output.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns); writer.writeheader()
        for priority, item in enumerate(selected, 1):
            row = dict(source_rows[item["dsd_entry_id"]]); row["dsd_priority"] = str(priority); row["dsd_band"] = "common-phase1"
            row["product_rationale"] = "Prioritized by a checksum-bound DSD local-model likelihood ranking; all expressive content remains newly authored."
            writer.writerow(row)
    content = args.output.read_bytes(); digest.update(content)
    manifest = {"version": 1, "method": "local_model_headword_likelihood", "model_id": MODEL_ID,
        "model_revision": REVISION, "prompt": PREFIX, "prompt_sha256": sha256(PREFIX.encode()),
        "score_rows": sum(1 for line in args.scores.read_text(encoding="utf-8").splitlines() if line.strip()),
        "scored_unique": len(scores), "selected": len(selected), "inventory_sha256": digest.hexdigest(),
        "score_file_sha256": sha256(args.scores.read_bytes()), "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    scorer = sub.add_parser("score"); scorer.add_argument("--inventory", type=pathlib.Path, required=True)
    scorer.add_argument("--output", type=pathlib.Path, required=True); scorer.add_argument("--batch-size", type=int, default=128)
    scorer.add_argument("--max-word-tokens", type=int, default=6); scorer.add_argument("--limit", type=int, default=0)
    build = sub.add_parser("materialize"); build.add_argument("--inventory", type=pathlib.Path, required=True)
    build.add_argument("--scores", type=pathlib.Path, required=True); build.add_argument("--output", type=pathlib.Path, required=True)
    build.add_argument("--manifest", type=pathlib.Path, required=True); build.add_argument("--target", type=int, default=20_000)
    args = parser.parse_args()
    if getattr(args, "batch_size", 1) < 1 or getattr(args, "batch_size", 1) > 512:
        raise RuntimeError("--batch-size must be 1..512")
    if args.command == "score": score(args)
    else: materialize(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=os.sys.stderr)
        raise SystemExit(1)
