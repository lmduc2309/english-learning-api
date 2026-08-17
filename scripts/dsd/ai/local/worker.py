#!/usr/bin/env python3
"""Single-model, append-only MLX worker for checksum-bound DSD JSONL requests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[4]
DEFAULT_LOCK = ROOT / "data/dsd/models/local-model-lock.json"
PROMPT_DIR = ROOT / "data/dsd/prompts/local-v1"
STAGE_ROLES = {
    "inventory": "inventory",
    "inventory_critic": "candidate_critic",
    "common_classifier": "candidate_critic",
    "english": "english_authoring",
    "english_batch": "english_authoring",
    "critic": "english_critic",
    "critic_batch": "english_critic",
    "translate": "en_vi_translation",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_jsonl(file: pathlib.Path) -> list[dict[str, Any]]:
    records = []
    if not file.exists():
        return records
    for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{file}:{number}: invalid JSON: {error}") from error
    return records


def model_for_stage(lock: dict[str, Any], stage: str) -> dict[str, Any]:
    role = STAGE_ROLES[stage]
    matches = [model for model in lock["models"] if role in model["roles"]]
    if len(matches) != 1:
        raise RuntimeError(f"stage {stage} does not resolve to exactly one locked model")
    return matches[0]


def model_path(home: pathlib.Path, model: dict[str, Any]) -> pathlib.Path:
    return home / model["id"] / model["revision"] / "mlx-4bit"


def qwen_prompt(tokenizer: Any, stage: str, payload: dict[str, Any]) -> str:
    prompt_name = {"inventory": "inventory-system.txt", "inventory_critic": "inventory-critic-system.txt",
                   "common_classifier": "common-classifier-system.txt", "english": "english-system.txt",
                   "english_batch": "english-batch-system.txt", "critic": "critic-system.txt",
                   "critic_batch": "critic-batch-system.txt"}[stage]
    system = (PROMPT_DIR / prompt_name).read_text(encoding="utf-8").strip()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": canonical_json(payload)},
    ]
    return tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
        enable_thinking=False,
    )


def translate_prompt(tokenizer: Any, payload: dict[str, Any]) -> str:
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("translation payload requires non-empty text")
    messages = [{
        "role": "user",
        "content": [{
            "type": "text", "source_lang_code": "en", "target_lang_code": "vi",
            "text": text.strip(), "image": None,
        }],
    }]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def strict_output(stage: str, text: str) -> Any:
    value = text.strip()
    if stage == "translate":
        if not value or value.startswith("{") or "```" in value or "\n\n" in value:
            raise RuntimeError("translation output contains wrapper or commentary")
        return {"translation_vi": value}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"model output is not one strict JSON value: {error}") from error
    if not isinstance(parsed, (dict, list)):
        raise RuntimeError("model JSON output must be an object or array")
    return parsed


def result_base(request: dict[str, Any], model_id: str, elapsed_ms: int,
                input_tokens: int, output_tokens: int) -> dict[str, Any]:
    return {
        "protocol_version": 1,
        "request_id": request["request_id"],
        "model_id": model_id,
        "model_lock_sha256": request["model_lock_sha256"],
        "prompt_sha256": request["prompt_sha256"],
        "schema_sha256": request["schema_sha256"],
        "input_sha256": request["input_sha256"],
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "elapsed_ms": elapsed_ms,
    }


def append_result(file: pathlib.Path, result: dict[str, Any]) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("a", encoding="utf-8") as handle:
        handle.write(canonical_json(result) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=sorted(STAGE_ROLES), required=True)
    parser.add_argument("--input", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--lock", type=pathlib.Path, default=DEFAULT_LOCK)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    home_raw = os.environ.get("DSD_LOCAL_MODEL_HOME", "").strip()
    if not home_raw:
        raise RuntimeError("DSD_LOCAL_MODEL_HOME is required")
    if args.input.resolve() == args.output.resolve():
        raise RuntimeError("input and output JSONL paths must differ")
    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    model_record = model_for_stage(lock, args.stage)
    requests = load_jsonl(args.input)
    if args.limit > 0:
        requests = requests[:args.limit]
    completed = {item["request_id"] for item in load_jsonl(args.output)}
    pending = [item for item in requests if item["request_id"] not in completed]
    if not pending:
        print("No pending requests.")
        return
    for request in pending:
        if request.get("stage") != args.stage or request.get("model_id") != model_record["id"]:
            raise RuntimeError("request stage/model does not match locked worker stage")

    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("OPENROUTER_API_KEY", None)
    os.environ.pop("LLM_API_KEY", None)
    from mlx_lm import generate, load
    from mlx_lm.sample_utils import make_sampler
    import mlx.core as mx

    model, tokenizer = load(str(model_path(pathlib.Path(home_raw).resolve(), model_record)))
    for request in pending:
        started = time.monotonic()
        input_tokens = output_tokens = 0
        try:
            prompt = (translate_prompt(tokenizer, request["payload"])
                      if args.stage == "translate"
                      else qwen_prompt(tokenizer, args.stage, request["payload"]))
            input_tokens = len(tokenizer.encode(prompt))
            mx.random.seed(int(request["seed"]))
            parameters = request["parameters"]
            sampler = make_sampler(temp=parameters["temperature_milli"] / 1000)
            raw = generate(
                model, tokenizer, prompt=prompt, verbose=False,
                max_tokens=int(parameters["max_tokens"]), sampler=sampler,
            )
            output_tokens = len(tokenizer.encode(raw))
            output = strict_output(args.stage, raw)
            result = result_base(
                request, model_record["id"], int((time.monotonic() - started) * 1000),
                input_tokens, output_tokens,
            )
            result.update({
                "state": "completed", "output": output,
                "output_sha256": sha256(canonical_json(output)),
            })
        except Exception as error:
            result = result_base(
                request, model_record["id"], int((time.monotonic() - started) * 1000),
                input_tokens, output_tokens,
            )
            result.update({"state": "schema_invalid", "error_code": type(error).__name__})
        append_result(args.output, result)
        print(f"{result['request_id']} {result['state']}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
